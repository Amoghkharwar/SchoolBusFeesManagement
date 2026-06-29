"""Comprehensive backend tests for School Bus Fee Management API."""
import os
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fall back to reading frontend/.env directly
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "BASE_URL is required"

ADMIN_EMAIL = "admin@busfee.com"
ADMIN_PASSWORD = "Admin@123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def created_ids():
    # Track for cleanup
    return {"schools": [], "students": [], "payments": []}


# ---------- Health ----------
class TestHealth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL
        assert isinstance(d.get("token"), str) and len(d["token"]) > 20

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_token(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_forgot_password_and_verify_reset(self):
        # request OTP
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Extract OTP from backend log
        time.sleep(1)
        otp = None
        try:
            out = subprocess.check_output(["tail", "-n", "400", "/var/log/supervisor/backend.err.log"], text=True)
        except Exception:
            out = ""
        if not otp:
            try:
                out2 = subprocess.check_output(["tail", "-n", "400", "/var/log/supervisor/backend.out.log"], text=True)
                out = out + "\n" + out2
            except Exception:
                pass
        # Find most recent OTP in the email body (large bold div with 6 digits)
        matches = re.findall(r"letter-spacing:6px[^>]*>(\d{6})<", out)
        if not matches:
            # try generic 6-digit code near 'one-time approval code'
            matches = re.findall(r"(\d{6})", out)
        assert matches, "OTP not found in backend logs"
        otp = matches[-1]

        # verify reset to a new password and back to original
        new_pwd = "TempPass@1"
        r = requests.post(
            f"{BASE_URL}/api/auth/verify-reset",
            json={"email": ADMIN_EMAIL, "otp": otp, "new_password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # Login with new password
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": new_pwd}, timeout=15)
        assert r.status_code == 200

        # Reset back to original via a new OTP cycle
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL}, timeout=15)
        assert r.status_code == 200
        time.sleep(1)
        try:
            out = subprocess.check_output(["tail", "-n", "400", "/var/log/supervisor/backend.err.log"], text=True)
        except Exception:
            out = ""
        matches = re.findall(r"letter-spacing:6px[^>]*>(\d{6})<", out)
        assert matches, "OTP not found for second cycle"
        otp2 = matches[-1]
        r = requests.post(
            f"{BASE_URL}/api/auth/verify-reset",
            json={"email": ADMIN_EMAIL, "otp": otp2, "new_password": ADMIN_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200

        # Confirm original works
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200


# ---------- Schools ----------
class TestSchools:
    def test_list(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/schools", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "id" in data[0] and "name" in data[0]

    def test_crud_school(self, auth_headers, created_ids):
        payload = {"name": "TEST_School_X", "address": "Addr 1", "contact_person": "PJ", "contact_phone": "9990001111"}
        r = requests.post(f"{BASE_URL}/api/schools", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        created_ids["schools"].append(sid)

        # GET
        r = requests.get(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == payload["name"]

        # PUT
        payload2 = {**payload, "name": "TEST_School_X_2"}
        r = requests.put(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, json=payload2, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_School_X_2"

        # DELETE
        r = requests.delete(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        created_ids["schools"].remove(sid)
        # verify gone
        r = requests.get(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 404


# ---------- Students + Payments ----------
@pytest.fixture(scope="class")
def test_school(auth_headers):
    payload = {"name": "TEST_SchoolForStudents", "address": "X", "contact_person": "Y", "contact_phone": "9990000000"}
    r = requests.post(f"{BASE_URL}/api/schools", headers=auth_headers, json=payload, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    yield sid
    # cleanup (also cascades students/payments)
    requests.delete(f"{BASE_URL}/api/schools/{sid}", headers=auth_headers, timeout=15)


class TestStudentsAndPayments:
    def test_create_list_student(self, auth_headers, test_school):
        today = datetime.now(timezone.utc).date().isoformat()
        body = {
            "name": "TEST_Student_1",
            "parent_name": "TEST_Parent",
            "parent_mobile": "919998887777",
            "school_id": test_school,
            "standard": "5",
            "pickup_location": "Stop A",
            "yearly_fee": 12000,
            "admission_date": today,
            "due_date": today,
        }
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body, timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["status"] == "pending"
        assert s["paid_amount"] == 0.0
        assert s["pending_amount"] == 12000
        assert s["school_name"] == "TEST_SchoolForStudents"
        sid = s["id"]

        # list with school_id
        r = requests.get(f"{BASE_URL}/api/students?school_id={test_school}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert sid in ids

        # search
        r = requests.get(f"{BASE_URL}/api/students?search=TEST_Student", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == sid for x in r.json())

        # status filter
        r = requests.get(f"{BASE_URL}/api/students?status=pending&school_id={test_school}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert all(x["status"] == "pending" for x in r.json())

        # due=today
        r = requests.get(f"{BASE_URL}/api/students?due=today&school_id={test_school}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == sid for x in r.json())

        # due=week
        r = requests.get(f"{BASE_URL}/api/students?due=week&school_id={test_school}", headers=auth_headers, timeout=15)
        assert r.status_code == 200

        # Payment: partial
        pay = {"amount": 5000, "payment_date": today, "mode": "cash", "note": "first installment"}
        r = requests.post(f"{BASE_URL}/api/students/{sid}/payments", headers=auth_headers, json=pay, timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{BASE_URL}/api/students/{sid}", headers=auth_headers, timeout=15)
        s2 = r.json()
        assert s2["paid_amount"] == 5000
        assert s2["pending_amount"] == 7000
        assert s2["status"] == "partial"

        # Payment: complete
        pay2 = {"amount": 7000, "payment_date": today, "mode": "upi"}
        r = requests.post(f"{BASE_URL}/api/students/{sid}/payments", headers=auth_headers, json=pay2, timeout=15)
        assert r.status_code == 200

        r = requests.get(f"{BASE_URL}/api/students/{sid}", headers=auth_headers, timeout=15)
        s3 = r.json()
        assert s3["paid_amount"] == 12000
        assert s3["status"] == "completed"

        # Payment history
        r = requests.get(f"{BASE_URL}/api/students/{sid}/payments", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert len(r.json()) == 2

        # Invalid amount
        r = requests.post(f"{BASE_URL}/api/students/{sid}/payments", headers=auth_headers, json={"amount": 0, "payment_date": today, "mode": "cash"}, timeout=15)
        assert r.status_code == 400

        # Delete student cascades payments
        r = requests.delete(f"{BASE_URL}/api/students/{sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200

    def test_invalid_school_id(self, auth_headers):
        today = datetime.now(timezone.utc).date().isoformat()
        body = {
            "name": "TEST_X", "parent_name": "P", "parent_mobile": "9", "school_id": "non-existent",
            "standard": "1", "yearly_fee": 100, "admission_date": today, "due_date": today,
        }
        r = requests.post(f"{BASE_URL}/api/students", headers=auth_headers, json=body, timeout=15)
        assert r.status_code == 400


# ---------- Dashboard ----------
class TestDashboard:
    def test_summary(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/summary", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_schools", "total_students", "total_yearly", "total_collected", "total_pending", "total_completed"]:
            assert k in d

    def test_by_school(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/by-school", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, list)
        if d:
            row = d[0]
            for k in ["school_id", "school_name", "student_count", "yearly_total", "collected", "pending"]:
                assert k in row


# ---------- Reports ----------
class TestReports:
    def test_csv(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/csv", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.text.splitlines()[0].startswith("Student,School,Parent")

    def test_html(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/html", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert "<html" in r.text.lower()
        assert "Bus Fee Report" in r.text

    def test_csv_status_filter(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/reports/csv?status=pending", headers=auth_headers, timeout=15)
        assert r.status_code == 200
