"""Phase 2: RBAC + Users + Bulk WhatsApp + Archive tests."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
assert BASE_URL, "BASE_URL required"

ADMIN_EMAIL = "kharwaramog02@gmail.com"
ADMIN_PASSWORD = "12345678"
CUR_FY = "2026-2027"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_users(admin_h):
    """Pre-clean any leftover TEST_ users so test reruns work."""
    r = requests.get(f"{BASE_URL}/api/users", headers=admin_h, timeout=15)
    if r.status_code == 200:
        for u in r.json():
            if u.get("email", "").startswith("test_") or u.get("email", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=admin_h, timeout=15)
    yield
    r = requests.get(f"{BASE_URL}/api/users", headers=admin_h, timeout=15)
    if r.status_code == 200:
        for u in r.json():
            if u.get("email", "").startswith("test_") or u.get("email", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=admin_h, timeout=15)


# ---------- /auth/me capabilities ----------
class TestAuthMe:
    def test_me_returns_role_caps_perms(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL
        assert d["role"] == "admin"
        assert d.get("status") == "active"
        assert isinstance(d.get("page_permissions"), list)
        assert "users" in d["page_permissions"]
        caps = d.get("capabilities", {})
        assert caps.get("manage_users") is True
        assert caps.get("archive") is True
        assert caps.get("delete") is True
        assert caps.get("export") is True


# ---------- Roles meta ----------
class TestRolesMeta:
    def test_roles_endpoint(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/users/roles", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert set(d["roles"]) == {"admin", "author", "guest"}
        assert d["max_authors"] == 3
        assert "dashboard" in d["all_pages"] and "users" in d["all_pages"]
        assert "admin" in d["default_permissions"]


# ---------- Users CRUD + RBAC ----------
class TestUsersCRUD:
    def test_list_users_as_admin(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/users", headers=admin_h, timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert any(u["email"] == ADMIN_EMAIL for u in users)

    def test_guest_unlimited(self, admin_h):
        # Create 4 guests - all should succeed
        ids = []
        try:
            for i in range(4):
                body = {"full_name": f"Guest {i}", "email": f"test_guest_{i}@busfeetest.com",
                        "password": "guestpass", "role": "guest"}
                r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
                assert r.status_code == 200, f"Guest #{i}: {r.status_code} {r.text}"
                ids.append(r.json()["id"])
        finally:
            for uid in ids:
                requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)

    def test_author_capped_at_3(self, admin_h):
        ids = []
        try:
            for i in range(3):
                body = {"full_name": f"Author {i}", "email": f"test_author_{i}@busfeetest.com",
                        "password": "authorpass", "role": "author"}
                r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
                assert r.status_code == 200, f"Author #{i}: {r.text}"
                ids.append(r.json()["id"])
            # 4th must fail
            body = {"full_name": "Author 4", "email": "test_author_4@busfeetest.com",
                    "password": "x" * 8, "role": "author"}
            r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
            assert r.status_code == 400
            assert "Maximum 3 Author" in r.text
        finally:
            for uid in ids:
                requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)

    def test_primary_admin_protected(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/users", headers=admin_h, timeout=15)
        admin_user = next(u for u in r.json() if u["email"] == ADMIN_EMAIL)
        # try to change role
        r = requests.put(f"{BASE_URL}/api/users/{admin_user['id']}",
                         headers=admin_h, json={"role": "guest"}, timeout=15)
        assert r.status_code == 400
        # try to deactivate
        r = requests.put(f"{BASE_URL}/api/users/{admin_user['id']}",
                         headers=admin_h, json={"status": "inactive"}, timeout=15)
        assert r.status_code == 400
        # try delete
        r = requests.delete(f"{BASE_URL}/api/users/{admin_user['id']}", headers=admin_h, timeout=15)
        assert r.status_code == 400

    def test_put_user_changes(self, admin_h):
        body = {"full_name": "Edit Me", "email": "test_edit@busfeetest.com",
                "password": "pwd12345", "role": "guest"}
        r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
        assert r.status_code == 200
        uid = r.json()["id"]
        try:
            r = requests.put(f"{BASE_URL}/api/users/{uid}", headers=admin_h,
                             json={"full_name": "Edited", "page_permissions": ["dashboard", "pending"]}, timeout=15)
            assert r.status_code == 200
            d = r.json()
            assert d["full_name"] == "Edited"
            assert set(d["page_permissions"]) == {"dashboard", "pending"}
        finally:
            r = requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)
            assert r.status_code == 200
            # verify gone
            r = requests.get(f"{BASE_URL}/api/users", headers=admin_h, timeout=15)
            assert uid not in [u["id"] for u in r.json()]

    def test_admin_reset_password(self, admin_h):
        body = {"full_name": "Pwd User", "email": "test_pwd@busfeetest.com",
                "password": "oldpwd123", "role": "guest"}
        r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
        uid = r.json()["id"]
        try:
            r = requests.post(f"{BASE_URL}/api/users/{uid}/reset-password",
                              headers=admin_h, json={"new_password": "newpwd456"}, timeout=15)
            assert r.status_code == 200
            # Login with new pwd
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": "test_pwd@busfeetest.com", "password": "newpwd456"}, timeout=15)
            assert r.status_code == 200
            # Old pwd should fail
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": "test_pwd@busfeetest.com", "password": "oldpwd123"}, timeout=15)
            assert r.status_code == 401
        finally:
            requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)


class TestRBACEnforcement:
    @pytest.fixture(scope="class")
    def author_token(self, admin_h):
        body = {"full_name": "RBAC Author", "email": "test_rbac_author@busfeetest.com",
                "password": "authorpwd", "role": "author"}
        r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "test_rbac_author@busfeetest.com", "password": "authorpwd"}, timeout=15)
        assert r.status_code == 200
        tok = r.json()["token"]
        yield tok
        requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)

    @pytest.fixture(scope="class")
    def guest_token(self, admin_h):
        body = {"full_name": "RBAC Guest", "email": "test_rbac_guest@busfeetest.com",
                "password": "guestpwd", "role": "guest"}
        r = requests.post(f"{BASE_URL}/api/users", headers=admin_h, json=body, timeout=15)
        assert r.status_code == 200
        uid = r.json()["id"]
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "test_rbac_guest@busfeetest.com", "password": "guestpwd"}, timeout=15)
        assert r.status_code == 200
        tok = r.json()["token"]
        yield tok
        requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_h, timeout=15)

    def test_author_cannot_list_users(self, author_token):
        h = {"Authorization": f"Bearer {author_token}"}
        r = requests.get(f"{BASE_URL}/api/users", headers=h, timeout=15)
        assert r.status_code == 403

    def test_guest_cannot_list_users(self, guest_token):
        h = {"Authorization": f"Bearer {guest_token}"}
        r = requests.get(f"{BASE_URL}/api/users", headers=h, timeout=15)
        assert r.status_code == 403

    def test_author_cannot_archive(self, author_token):
        h = {"Authorization": f"Bearer {author_token}"}
        r = requests.post(f"{BASE_URL}/api/archive/backup?fy={CUR_FY}", headers=h, timeout=15)
        assert r.status_code == 403
        r = requests.get(f"{BASE_URL}/api/archive/status", headers=h, timeout=15)
        assert r.status_code == 403

    def test_guest_cannot_archive(self, guest_token):
        h = {"Authorization": f"Bearer {guest_token}"}
        r = requests.post(f"{BASE_URL}/api/archive/backup?fy={CUR_FY}", headers=h, timeout=15)
        assert r.status_code == 403

    def test_author_me_caps(self, author_token):
        h = {"Authorization": f"Bearer {author_token}"}
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "author"
        caps = d["capabilities"]
        assert caps["create"] is True and caps["edit"] is True and caps["export"] is True
        assert caps["delete"] is False and caps["manage_users"] is False and caps["archive"] is False


# ---------- Bulk WhatsApp ----------
class TestBulkWhatsApp:
    def test_bulk_pending_shape(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/whatsapp/bulk-pending?fy={CUR_FY}", headers=admin_h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "count" in d and "items" in d
        assert isinstance(d["items"], list)
        assert d["count"] == len(d["items"])
        for it in d["items"]:
            for k in ("phone", "pending_amount", "overdue_days", "parent_name",
                      "student_name", "school_name", "next_due_date"):
                assert k in it, f"item missing {k}: {it}"


# ---------- Archive ----------
class TestArchive:
    def test_archive_status(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/archive/status", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "firebase_ready" in d and "archives" in d
        assert isinstance(d["archives"], list)

    def test_backup_falls_back_to_mongodb(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/archive/backup?fy={CUR_FY}", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["fy"] == CUR_FY
        # bucket not enabled → should fall back to mongodb-local
        assert d["stored_in"] in ("firebase", "mongodb-local")
        assert "counts" in d
        # counts.schools matches actual count
        sch = requests.get(f"{BASE_URL}/api/schools", headers=admin_h, timeout=15).json()
        assert d["counts"]["schools"] == len(sch)
        # warning field present (may be None if firebase wasn't tried, but key must exist)
        assert "warning" in d

    def test_restore_idempotent(self, admin_h):
        # Ensure backup exists
        requests.post(f"{BASE_URL}/api/archive/backup?fy={CUR_FY}", headers=admin_h, timeout=30)
        # students count before
        s1 = requests.get(f"{BASE_URL}/api/students", headers=admin_h, timeout=15).json()
        r = requests.post(f"{BASE_URL}/api/archive/restore?fy={CUR_FY}", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        s2 = requests.get(f"{BASE_URL}/api/students", headers=admin_h, timeout=15).json()
        assert len(s2) == len(s1), "restore must not duplicate documents"
        # restore again - still no duplicates
        r = requests.post(f"{BASE_URL}/api/archive/restore?fy={CUR_FY}", headers=admin_h, timeout=30)
        assert r.status_code == 200
        s3 = requests.get(f"{BASE_URL}/api/students", headers=admin_h, timeout=15).json()
        assert len(s3) == len(s1)


# ---------- Regression smoke ----------
class TestRegression:
    def test_dashboard_summary(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/dashboard/summary", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert "total_students" in r.json()

    def test_pending_fees(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/pending-fees", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_financial_years(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/financial-years", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert "current" in r.json()

    def test_reports_pdf(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/reports/pdf", headers=admin_h, timeout=30)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_reports_excel(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/reports/excel", headers=admin_h, timeout=30)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"
