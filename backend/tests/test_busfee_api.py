"""Comprehensive backend tests for Bus Fee Management API (Phase 1)."""
import os
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "BASE_URL is required"

ADMIN_EMAIL = "kharwaramog02@gmail.com"
ADMIN_PASSWORD = "12345678"
OLD_ADMIN_EMAIL = "admin@busfee.com"
OLD_ADMIN_PASSWORD = "Admin@123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------- Health ----------
class TestHealth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------- Auth ----------
class TestAuth:
    def test_login_new_admin(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL
        assert isinstance(d.get("token"), str) and len(d["token"]) > 20

    def test_old_admin_removed(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": OLD_ADMIN_EMAIL, "password": OLD_ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 401, f"Old admin should be removed, got {r.status_code}"

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_token(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_forgot_password_otp_cycle(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": ADMIN_EMAIL}, timeout=15)
        assert r.status_code == 200
        time.sleep(1)
        out = ""
        for log in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
            try:
                out += subprocess.check_output(["tail", "-n", "500", log], text=True)
            except Exception:
                pass
        m = re.findall(r"letter-spacing:6px[^>]*>(\d{6})<", out)
        assert m, "OTP not found in logs"
        otp = m[-1]
        new_pwd = "TempPass@1"
        r = requests.post(f"{BASE_URL}/api/auth/verify-reset",
                          json={"email": ADMIN_EMAIL, "otp": otp, "new_password": new_pwd}, timeout=15)
        assert r.status_code == 200, r.text
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": new_pwd}, timeout=15)
        assert r.status_code == 200

        # Reset back to original
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": ADMIN_EMAIL}, timeout=15)
        assert r.status_code == 200
        time.sleep(1)
        out = ""
        for log in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
            try:
                out += subprocess.check_output(["tail", "-n", "500", log], text=True)
            except Exception:
                pass
        m = re.findall(r"letter-spacing:6px[^>]*>(\d{6})<", out)
        assert m, "second OTP missing"
        otp2 = m[-1]
        r = requests.post(f"{BASE_URL}/api/auth/verify-reset",
                          json={"email": ADMIN_EMAIL, "otp": otp2, "new_password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        # Confirm original works again
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200


# ---------- Financial Years ----------
class TestFinancialYears:
    def test_fy_list(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/financial-years", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "current" in d and "years" in d
        assert isinstance(d["years"], list)
        assert len(d["years"]) >= 3, f"Expected >=3 FY entries, got {d['years']}"
        # Current FY for Jan/Feb/Mar 2026 = 2025-2026; for Apr 2026+ = 2026-2027
        now = datetime.now(timezone.utc)
        expected = f"{now.year}-{now.year + 1}" if now.month >= 4 else f"{now.year - 1}-{now.year}"
        assert d["current"] == expected


# ---------- Schools ----------
class TestSchools:
    def test_list(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/schools", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_crud_school(self, auth_headers):
        payload = {"name": "TEST_School_X", "address": "Addr 1", "contact_person": "PJ", "contact_phone": "9990001111"}
        r = requests.post(f"{BASE_URL}/api/schools", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        r = requests.get(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == payload["name"]
        r = requests.put(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers,
                         json={**payload, "name": "TEST_School_X_2"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_School_X_2"
        r = requests.delete(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 404


# ---------- Students + Payments + Pending ----------
@pytest.fixture(scope="class")
def test_school(auth_headers):
    payload = {"name": "TEST_SchoolForStudents", "address": "X", "contact_person": "Y", "contact_phone": "9990000000"}
    r = requests.post(f"{BASE_URL}/api/schools", headers=auth_headers, json=payload, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    yield sid
    requests.delete(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class TestStudentsPaymentsPending:
    def test_full_workflow(self, auth_headers, test_school):
        now = datetime.now(timezone.utc)
        past = now - timedelta(days=30)
        future = now + timedelta(days=30)

        # Student 1: overdue (due in past, no payment)
        body1 = {
            "name": "TEST_Overdue_Student", "parent_name": "TEST_P1", "parent_mobile": "919998887777",
            "school_id": test_school, "standard": "5", "pickup_location": "Stop A",
            "yearly_fee": 12000, "admission_date": _iso(now), "due_date": _iso(past),
        }
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body1, timeout=15)
        assert r.status_code == 200, r.text
        s1 = r.json()
        assert s1["status"] == "pending"
        assert s1["pending_amount"] == 12000
        assert s1["overdue_days"] >= 29, f"expected overdue, got {s1['overdue_days']}"
        sid1 = s1["id"]

        # Student 2: not overdue (due future)
        body2 = {**body1, "name": "TEST_NotOverdue", "due_date": _iso(future)}
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body2, timeout=15)
        assert r.status_code == 200
        sid2 = r.json()["id"]

        # Add partial payment with next_due_date in past for student1
        pay = {
            "amount": 5000, "payment_date": _iso(now), "mode": "cash",
            "note": "first", "next_due_date": _iso(past + timedelta(days=5)),
        }
        r = requests.post(f"{BASE_URL}/api/students/{sid1}/payments", headers=auth_headers, json=pay, timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{BASE_URL}/api/students/{sid1}", headers=auth_headers, timeout=15)
        s = r.json()
        assert s["status"] == "partial"
        assert s["paid_amount"] == 5000
        assert s["last_payment_date"] is not None
        assert s["next_due_date"] is not None
        # next_due_date should reflect the payment's next_due_date
        assert "next_due_date" in s and s["overdue_days"] > 0

        # Pending-fees endpoint should include sid1 but not sid2
        r = requests.get(f"{BASE_URL}/api/pending-fees", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert sid1 in ids
        assert sid2 not in ids
        # row shape
        row = [x for x in r.json() if x["id"] == sid1][0]
        for k in ("overdue_days", "last_payment_date", "next_due_date", "pending_amount", "school_name"):
            assert k in row

        # Complete payment
        r = requests.post(f"{BASE_URL}/api/students/{sid1}/payments", headers=auth_headers,
                         json={"amount": 7000, "payment_date": _iso(now), "mode": "upi"}, timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/students/{sid1}", headers=auth_headers, timeout=15)
        assert r.json()["status"] == "completed"

        # Now pending-fees should not include sid1
        r = requests.get(f"{BASE_URL}/api/pending-fees", headers=auth_headers, timeout=15)
        assert sid1 not in [x["id"] for x in r.json()]

        # Invalid amount
        r = requests.post(f"{BASE_URL}/api/students/{sid1}/payments", headers=auth_headers,
                         json={"amount": 0, "payment_date": _iso(now), "mode": "cash"}, timeout=15)
        assert r.status_code == 400

        # Cleanup
        requests.delete(f"{BASE_URL}/api/students/{sid1}", headers=auth_headers, timeout=15)
        requests.delete(f"{BASE_URL}/api/students/{sid2}", headers=auth_headers, timeout=15)

    def test_invalid_school_id(self, auth_headers):
        body = {
            "name": "TEST_X", "parent_name": "P", "parent_mobile": "9", "school_id": "non-existent",
            "standard": "1", "yearly_fee": 100,
            "admission_date": _iso(datetime.now(timezone.utc)),
            "due_date": _iso(datetime.now(timezone.utc)),
        }
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body, timeout=15)
        assert r.status_code == 400


# ---------- FY filter on dashboard + students ----------
class TestFYFilter:
    def test_dashboard_fy(self, auth_headers, test_school):
        now = datetime.now(timezone.utc)
        fy_current = f"{now.year}-{now.year + 1}" if now.month >= 4 else f"{now.year - 1}-{now.year}"
        fy_other = "2020-2021"

        # Create a student admitted in current FY
        body = {
            "name": "TEST_FYStudent", "parent_name": "P", "parent_mobile": "9",
            "school_id": test_school, "standard": "1", "yearly_fee": 5000,
            "admission_date": _iso(now), "due_date": _iso(now),
        }
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body, timeout=15)
        assert r.status_code == 200
        sid = r.json()["id"]

        # Current FY summary should include student
        r = requests.get(f"{BASE_URL}/api/dashboard/summary?fy={fy_current}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        cur = r.json()
        # Other FY summary should exclude student
        r = requests.get(f"{BASE_URL}/api/dashboard/summary?fy={fy_other}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        other = r.json()
        assert cur["total_students"] > other["total_students"]

        # /api/students fy filter
        r = requests.get(f"{BASE_URL}/api/students?fy={fy_current}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert sid in [s["id"] for s in r.json()]
        r = requests.get(f"{BASE_URL}/api/students?fy={fy_other}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert sid not in [s["id"] for s in r.json()]

        # by-school fy
        r = requests.get(f"{BASE_URL}/api/dashboard/by-school?fy={fy_current}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

        requests.delete(f"{BASE_URL}/api/students/{sid}", headers=auth_headers, timeout=15)


# ---------- Reports: PDF + Excel ----------
class TestReports:
    def test_pdf_header_auth(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/pdf", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", f"Not a PDF: {r.content[:10]!r}"

    def test_pdf_token_query(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/reports/pdf?token={admin_token}", timeout=30)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_pdf_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/reports/pdf", timeout=15)
        assert r.status_code == 401

    def test_excel_header_auth(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/excel", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct, f"Wrong CT: {ct}"
        assert r.content[:2] == b"PK", "xlsx must start with PK zip magic"

    def test_excel_token_query(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/reports/excel?token={admin_token}", timeout=30)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"

    def test_pdf_with_filters(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/pdf?status=pending&fy=2026-2027",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_csv_still_works(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/csv", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.text.splitlines()[0].startswith("Student,School")


# ---------- Dashboard basic ----------
class TestDashboard:
    def test_summary(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/summary", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_schools", "total_students", "total_yearly", "total_collected",
                  "total_pending", "total_completed"):
            assert k in d

    def test_by_school(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/by-school", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
