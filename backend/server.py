"""School Bus Fee Management — FastAPI backend (Phase 1 enhanced)."""
from __future__ import annotations

import io
import logging
import os
import random
import re
import string
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = "schoolbusfees"
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "720"))
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "noreply@busfee.app")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "kharwaramog02@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "12345678")

FIREBASE_CREDENTIALS_PATH = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")
FIREBASE_BUCKET = os.environ.get("FIREBASE_BUCKET", "")

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()


def _vapid_subject(raw: str) -> str:
    """Push services reject a `sub` claim that isn't a mailto:/https: URL, and an
    env var that is set-but-blank never falls back to a default — so normalise
    both here rather than trusting how the value was typed into a dashboard.
    """
    value = (raw or "").strip()
    if not value:
        value = ADMIN_EMAIL or "admin@busfee.app"
    if value.startswith(("mailto:", "http://", "https://")):
        return value
    return f"mailto:{value}"


VAPID_SUBJECT = _vapid_subject(os.environ.get("VAPID_SUBJECT", ""))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("busfee")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ---------- Roles & Permissions ----------
ROLE_ADMIN = "admin"
ROLE_AUTHOR = "author"
ROLE_GUEST = "guest"
ALL_PAGES = ["dashboard", "schools", "students", "work", "pending", "reports", "users"]
ROLE_DEFAULT_PERMS: Dict[str, List[str]] = {
    ROLE_ADMIN: ALL_PAGES,
    ROLE_AUTHOR: ["dashboard", "students", "work", "pending", "reports"],
    ROLE_GUEST: ["dashboard"],  # admin can override per user
}
# Action permissions
ROLE_CAPS: Dict[str, Dict[str, bool]] = {
    ROLE_ADMIN: {"create": True, "edit": True, "delete": True, "export": True, "manage_users": True, "archive": True},
    ROLE_AUTHOR: {"create": True, "edit": True, "delete": False, "export": True, "manage_users": False, "archive": False},
    ROLE_GUEST: {"create": False, "edit": False, "delete": False, "export": False, "manage_users": False, "archive": False},
}
MAX_AUTHORS = 3

# Firebase Storage lazy init
_firebase_bucket = None
def _get_bucket():
    global _firebase_bucket
    if _firebase_bucket is not None:
        return _firebase_bucket
    if not FIREBASE_CREDENTIALS_PATH or not os.path.exists(FIREBASE_CREDENTIALS_PATH) or not FIREBASE_BUCKET:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, storage as fb_storage
        if not firebase_admin._apps:
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            firebase_admin.initialize_app(cred, {"storageBucket": FIREBASE_BUCKET})
        _firebase_bucket = fb_storage.bucket()
        return _firebase_bucket
    except Exception as e:
        logger.error(f"Firebase init failed: {e}")
        return None

app = FastAPI(title="School Bus Fee Management API")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


# ---------- Utility ----------
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_token(email: str, role: str = ROLE_ADMIN) -> str:
    return jwt.encode(
        {
            "sub": email,
            "role": role,
            "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
            "iat": datetime.now(timezone.utc),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


async def _admin_from_token(token: str) -> Dict[str, Any]:
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"email": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("status") and user["status"] != "active":
        raise HTTPException(403, "User inactive")
    return user


async def get_current_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Accept token from Authorization header OR ?token=... query param (for downloads)."""
    raw = creds.credentials if creds else token
    if not raw:
        raise HTTPException(401, "Missing token")
    return await _admin_from_token(raw)


def require_role(*roles: str):
    async def dep(user=Depends(get_current_admin)):
        if user.get("role") not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return user
    return dep


def require_cap(cap: str):
    async def dep(user=Depends(get_current_admin)):
        caps = ROLE_CAPS.get(user.get("role", ""), {})
        if not caps.get(cap):
            raise HTTPException(403, f"Action '{cap}' not allowed for your role")
        return user
    return dep


def gen_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def send_email(to: str, subject: str, html: str) -> bool:
    if not SENDGRID_API_KEY:
        logger.warning("[DEV] No SENDGRID_API_KEY — printing email to console")
        logger.info(f"EMAIL TO: {to}\nSUBJECT: {subject}\nBODY:\n{html}")
        return True
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail
        message = Mail(from_email=SENDER_EMAIL, to_emails=to, subject=subject, html_content=html)
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(message)
        logger.info(f"SendGrid status {resp.status_code} to {to}")
        return resp.status_code in (200, 202)
    except Exception as e:
        logger.error(f"SendGrid error: {e}")
        return False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Web Push ----------
async def push_report(title: str, body: str, url: str = "/") -> Dict[str, Any]:
    """Fans a notification out to every stored subscription and reports the outcome.

    Subscriptions the push service reports as gone (404/410) are deleted, which
    is the only way they ever get cleaned up — browsers rotate them silently.
    The per-attempt reasons are returned so a failure can be diagnosed from the
    API alone, without shell access to the host's logs.
    """
    if not VAPID_PRIVATE_KEY:
        logger.warning("No VAPID_PRIVATE_KEY — skipping push: %s", title)
        return {"sent": 0, "total": 0, "reason": "VAPID_PRIVATE_KEY is not set"}

    try:
        from pywebpush import WebPushException, webpush
    except ImportError as e:
        logger.error("pywebpush import failed — skipping push: %s", e)
        return {"sent": 0, "total": 0, "reason": f"pywebpush import failed: {e}"}

    import asyncio
    import json

    subs = await db.push_subscriptions.find({}, {"_id": 0}).to_list(2000)
    if not subs:
        return {"sent": 0, "total": 0, "reason": "no subscriptions stored"}

    payload = json.dumps({"title": title, "body": body, "url": url})
    stale: List[str] = []
    errors: List[str] = []

    def deliver(sub: Dict[str, Any]) -> bool:
        try:
            webpush(
                subscription_info=sub["subscription"],
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
                timeout=10,
            )
            return True
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                stale.append(sub["endpoint"])
                errors.append(f"{code} gone — pruned")
            else:
                errors.append(f"{code}: {e}"[:200])
                logger.warning("Push failed (%s): %s", code, e)
            return False
        except Exception as e:
            errors.append(f"{type(e).__name__}: {e}"[:200])
            logger.warning("Push error: %s", e)
            return False

    results = await asyncio.gather(
        *(asyncio.to_thread(deliver, s) for s in subs), return_exceptions=True
    )
    for r in results:
        if isinstance(r, BaseException):
            errors.append(f"{type(r).__name__}: {r}"[:200])
    sent = sum(1 for r in results if r is True)

    if stale:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": stale}})
        logger.info("Pruned %d stale push subscriptions", len(stale))

    logger.info("Push '%s' delivered to %d/%d subscriptions", title, sent, len(subs))
    return {"sent": sent, "total": len(subs), "errors": errors}


async def send_push_to_all(title: str, body: str, url: str = "/") -> int:
    return (await push_report(title, body, url))["sent"]


# ---------- Financial Year (Indian Default: April → March) ----------
def fy_label(dt: datetime, start_month: int = 4) -> str:
    """Computes FY label for a datetime according to the configured start month."""
    y = dt.year
    if dt.month < start_month:
        return f"{y - 1}-{y}"
    return f"{y}-{y + 1}"


def fy_range(label: str) -> (datetime, datetime):
    """Return [start, end) of a financial year label like '2026-2027'."""
    try:
        a, b = label.split("-")
        start = datetime(int(a), 4, 1, tzinfo=timezone.utc)
        end = datetime(int(b), 4, 1, tzinfo=timezone.utc)
        return start, end
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc), datetime.max.replace(tzinfo=timezone.utc)


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # accept both "YYYY-MM-DD" and ISO datetimes
        if "T" not in s and len(s) <= 10:
            d = datetime.fromisoformat(s)
        else:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def _in_fy(value: Optional[str], fy: Optional[str]) -> bool:
    if not fy:
        return True
    dt = _parse_dt(value)
    if not dt:
        return False
    s, e = fy_range(fy)
    return s <= dt < e


async def _fy_entry_error(value: Optional[str], action: str) -> Optional[str]:
    """Returns an error message if a record dated `value` should not be allowed
    in, else None. Only the current financial year (unless explicitly closed) or
    a past year explicitly reopened (status == "open" in financial_years) may
    receive new students/payments. Any other year — explicitly closed, or simply
    never registered (e.g. a stray 2024 date picked by mistake) — is rejected,
    since only the currently tracked FY window is meant to be editable."""
    dt = _parse_dt(value)
    if not dt:
        return None
    label = fy_label(dt)
    current_label = fy_label(datetime.now(timezone.utc))
    doc = await db.financial_years.find_one({"label": label}, {"_id": 0, "status": 1})
    fy_status = doc.get("status") if doc else None
    if fy_status == "closed":
        return f"Cannot {action}: Financial Year {label} is closed"
    if label == current_label:
        return None
    if fy_status == "open":
        return None
    return f"Cannot {action}: Financial Year {label} is not open for new entries"


# ---------- Models ----------
class CreateFY(BaseModel):
    label: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    email: EmailStr


class ForgotIn(BaseModel):
    email: EmailStr


class VerifyResetIn(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


class SchoolIn(BaseModel):
    name: str
    address: Optional[str] = ""
    contact_person: Optional[str] = ""
    contact_phone: Optional[str] = ""
    fy_start_month: Optional[int] = 4  # 1-12 (e.g. 3=March for JB School, 4=April default, 5=May for DSilva School)
    fy_end_month: Optional[int] = 3    # 1-12 (e.g. 2=Feb for JB School, 3=March default, 6=June for DSilva School)


class StudentIn(BaseModel):
    name: str
    parent_name: str
    parent_mobile: str
    school_id: str
    standard: str
    pickup_location: Optional[str] = ""
    yearly_fee: float
    admission_date: str  # ISO datetime
    due_date: str  # ISO datetime

    @field_validator("parent_mobile")
    @classmethod
    def validate_parent_mobile(cls, v: str) -> str:
        digits = v.strip()
        if digits.startswith("+91"):
            digits = digits[3:]
        elif digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) == 11:
            digits = digits[1:]
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Parent mobile must be a valid 10-digit Indian mobile number")
        return digits


class PaymentIn(BaseModel):
    amount: float
    payment_date: str  # ISO datetime
    mode: str  # cash / upi / bank
    note: Optional[str] = ""
    next_due_date: Optional[str] = None  # ISO datetime — next fee due


class WorkerIn(BaseModel):
    """A person on the payroll. `monthly_salary` is only the default used to
    pre-fill new salary months — each month stores its own matured amount, so
    a raise or a short month doesn't rewrite history."""
    name: str
    mobile: Optional[str] = ""
    designation: Optional[str] = ""
    monthly_salary: float
    join_date: str  # ISO datetime
    active: Optional[bool] = True

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> str:
        digits = (v or "").strip()
        if not digits:
            return ""
        if digits.startswith("+91"):
            digits = digits[3:]
        elif digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) == 11:
            digits = digits[1:]
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Mobile must be a valid 10-digit Indian mobile number")
        return digits


class SalaryPeriodIn(BaseModel):
    """One salary cycle — the stretch of work whose pay matures on end_date."""
    start_date: str  # ISO datetime
    end_date: str    # ISO datetime — the day the salary matures
    total_salary: float
    note: Optional[str] = ""


class SalaryPaymentIn(BaseModel):
    """A part-payment against salary. With no `period_id` the amount is spread
    over unpaid months oldest-first, which is how a lump sum handed over after
    a couple of missed months actually settles them."""
    amount: float
    payment_date: str  # ISO datetime
    mode: str  # cash / upi / bank
    note: Optional[str] = ""
    period_id: Optional[str] = None


# ---------- Helpers ----------
def compute_status(yearly: float, paid: float) -> str:
    if paid <= 0:
        return "pending"
    if paid + 0.0001 >= yearly:
        return "completed"
    return "partial"


async def student_to_out(doc: Dict[str, Any], fy: Optional[str] = None) -> Dict[str, Any]:
    school = await db.schools.find_one({"id": doc["school_id"]}, {"_id": 0, "name": 1})
    payments = await db.payments.find({"student_id": doc["id"]}, {"_id": 0}).to_list(1000)
    # Scope payments to the financial year when requested (so paid/pending are FY-accurate)
    if fy:
        payments = [p for p in payments if _in_fy(p.get("payment_date"), fy)]
    paid = sum(float(p["amount"]) for p in payments)
    yearly = float(doc["yearly_fee"])
    status_ = compute_status(yearly, paid)
    # last payment + next_due tracking
    last_payment_date: Optional[str] = None
    next_due: Optional[str] = doc.get("due_date")
    if payments:
        payments_sorted = sorted(
            payments, key=lambda p: _parse_dt(p.get("payment_date")) or datetime.min.replace(tzinfo=timezone.utc)
        )
        last = payments_sorted[-1]
        last_payment_date = last.get("payment_date")
        if last.get("next_due_date"):
            next_due = last["next_due_date"]
    overdue_days = 0
    nd = _parse_dt(next_due)
    if nd and status_ != "completed":
        delta = (datetime.now(timezone.utc) - nd).days
        overdue_days = max(delta, 0)
    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "school_name": (school or {}).get("name", "—"),
        "paid_amount": round(paid, 2),
        "pending_amount": round(max(yearly - paid, 0), 2),
        "status": status_,
        "last_payment_date": last_payment_date,
        "next_due_date": next_due,
        "overdue_days": overdue_days,
    }


# ---------- Startup ----------
@app.on_event("startup")
async def startup() -> None:
    await db.users.create_index("email", unique=True)
    await db.schools.create_index("id", unique=True)
    await db.students.create_index("id", unique=True)
    await db.payments.create_index("id", unique=True)
    await db.password_resets.create_index("email")
    await db.archives.create_index("fy", unique=True)
    await db.workers.create_index("id", unique=True)
    await db.salary_periods.create_index("id", unique=True)
    await db.salary_periods.create_index("worker_id")
    await db.salary_payments.create_index("id", unique=True)
    await db.salary_payments.create_index("worker_id")

    # Migrate old admins → users
    async for old in db.admins.find({}):
        await db.users.update_one(
            {"email": old["email"]},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "email": old["email"],
                "password_hash": old["password_hash"],
                "full_name": old.get("email", "").split("@")[0].title(),
                "mobile": "",
                "role": ROLE_ADMIN,
                "status": "active",
                "page_permissions": ALL_PAGES,
                "created_at": old.get("created_at", now_iso()),
                "last_login": None,
            }},
            upsert=True,
        )
    await db.admins.drop()

    # Enforce single admin = ADMIN_EMAIL.  Remove any users that aren't ADMIN_EMAIL and have role admin without legit reason.
    # Seed admin if missing
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "full_name": "Bus Fee Admin",
            "mobile": "",
            "role": ROLE_ADMIN,
            "status": "active",
            "page_permissions": ALL_PAGES,
            "created_at": now_iso(),
            "last_login": None,
        })
        logger.info(f"Seeded admin: {ADMIN_EMAIL}")
    else:
        # ensure admin is active + has full perms
        await db.users.update_one(
            {"email": ADMIN_EMAIL},
            {"$set": {"role": ROLE_ADMIN, "status": "active", "page_permissions": ALL_PAGES}},
        )

    if await db.schools.count_documents({}) == 0:
        sample_schools = [
            {"id": str(uuid.uuid4()), "name": "JB School", "address": "Main Road, Anand", "contact_person": "Mr. Joshi", "contact_phone": "9876500011", "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "DP School", "address": "Station Road, Vadodara", "contact_person": "Mrs. Patel", "contact_phone": "9876500022", "created_at": now_iso()},
        ]
        await db.schools.insert_many([dict(s) for s in sample_schools])
        logger.info("Seeded sample schools")


@app.on_event("shutdown")
async def shutdown() -> None:
    client.close()


# ---------- Auth ----------
@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if user.get("status") and user["status"] != "active":
        raise HTTPException(403, "User is inactive")
    await db.users.update_one({"email": body.email}, {"$set": {"last_login": now_iso()}})
    return TokenOut(token=make_token(body.email, user.get("role", ROLE_ADMIN)), email=body.email)


@api.get("/auth/me")
async def me(user=Depends(get_current_admin)):
    role = user.get("role", ROLE_ADMIN)
    return {
        **{k: v for k, v in user.items() if k != "password_hash"},
        "capabilities": ROLE_CAPS.get(role, {}),
    }


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn):
    user = await db.users.find_one({"email": body.email})
    if user:
        otp = gen_otp()
        await db.password_resets.update_one(
            {"email": body.email},
            {"$set": {
                "email": body.email, "otp": otp,
                "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
                "consumed": False, "created_at": now_iso(),
            }},
            upsert=True,
        )
        html = f"""<div style='font-family:system-ui,sans-serif;padding:24px;background:#f9fafb;'>
          <h2 style='color:#2B4C3E;'>Bus Fee Manager — Password Reset Approval</h2>
          <p>We received a request to reset the password for <b>{body.email}</b>.</p>
          <p>Your one-time approval code (valid for 15 minutes) is:</p>
          <div style='font-size:34px;font-weight:700;letter-spacing:6px;background:#fff;padding:18px 24px;border-radius:12px;display:inline-block;border:1px solid #E5E7EB;color:#111827;'>{otp}</div>
          <p style='margin-top:24px;'>Enter this code in the app to approve and set your new password.</p>
        </div>"""
        send_email(body.email, "Approve Password Reset — Bus Fee Manager", html)
    return {"ok": True, "message": "If the email exists, an OTP has been sent."}


@api.post("/auth/verify-reset")
async def verify_reset(body: VerifyResetIn):
    rec = await db.password_resets.find_one({"email": body.email})
    if not rec or rec.get("consumed"):
        raise HTTPException(400, "Invalid or already used code")
    if rec["otp"] != body.otp:
        raise HTTPException(400, "Incorrect OTP")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
    except Exception:
        raise HTTPException(400, "Invalid OTP record")
    if exp < datetime.now(timezone.utc):
        raise HTTPException(400, "OTP expired")
    if len(body.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    res = await db.users.update_one({"email": body.email}, {"$set": {"password_hash": hash_password(body.new_password)}})
    if res.matched_count == 0:
        raise HTTPException(404, "No account found for that email")
    await db.password_resets.update_one({"email": body.email}, {"$set": {"consumed": True}})
    return {"ok": True, "message": "Password approved and updated."}


# ---------- Schools ----------
@api.get("/schools")
async def list_schools(admin=Depends(get_current_admin)):
    schools = await db.schools.find({}, {"_id": 0}).to_list(1000)
    out = []
    for s in schools:
        cnt = await db.students.count_documents({"school_id": s["id"]})
        s["student_count"] = cnt
        out.append(s)
    return out


@api.post("/schools")
async def create_school(body: SchoolIn, admin=Depends(get_current_admin)):
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "created_at": now_iso()}
    await db.schools.insert_one(dict(doc))
    actor = admin.get("full_name") or admin.get("email") or "Someone"
    await send_push_to_all("New school added", f"{actor} added {doc['name']}.", "/schools")
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/schools/{school_id}")
async def get_school(school_id: str, admin=Depends(get_current_admin)):
    s = await db.schools.find_one({"id": school_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "School not found")
    return s


@api.put("/schools/{school_id}")
async def update_school(school_id: str, body: SchoolIn, admin=Depends(get_current_admin)):
    res = await db.schools.update_one({"id": school_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "School not found")
    return await db.schools.find_one({"id": school_id}, {"_id": 0})


@api.delete("/schools/{school_id}")
async def delete_school(school_id: str, admin=Depends(get_current_admin)):
    students = await db.students.find({"school_id": school_id}, {"id": 1, "_id": 0}).to_list(10000)
    sids = [s["id"] for s in students]
    if sids:
        await db.payments.delete_many({"student_id": {"$in": sids}})
        await db.students.delete_many({"school_id": school_id})
    await db.schools.delete_one({"id": school_id})
    return {"ok": True}


# ---------- Students ----------
@api.get("/students")
async def list_students(
    school_id: Optional[str] = None,
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    standard: Optional[str] = None,
    due: Optional[str] = None,
    fy: Optional[str] = None,
    admin=Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if school_id:
        query["school_id"] = school_id
    if standard:
        query["standard"] = standard
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"parent_name": {"$regex": search, "$options": "i"}},
            {"parent_mobile": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.students.find(query, {"_id": 0}).to_list(5000)
    if fy:
        docs = [d for d in docs if _in_fy(d.get("admission_date"), fy)]
    out = [await student_to_out(d) for d in docs]
    if status_filter and status_filter in ("pending", "partial", "completed"):
        out = [s for s in out if s["status"] == status_filter]
    if due:
        today = datetime.now(timezone.utc).date()
        end = today + (timedelta(days=0) if due == "today" else timedelta(days=7))
        kept = []
        for s in out:
            d = _parse_dt(s.get("next_due_date") or s.get("due_date"))
            if not d:
                continue
            if due == "today" and d.date() == today:
                kept.append(s)
            elif due == "week" and today <= d.date() <= end:
                kept.append(s)
        out = kept
    return out


def _duplicate_student_query(body: StudentIn, exclude_id: Optional[str] = None) -> Dict[str, Any]:
    """Matches an existing student with the same name, parent, mobile, class,
    pickup location, and fee within the same school — a near-certain sign the
    same enrollment is being entered twice."""
    q: Dict[str, Any] = {
        "school_id": body.school_id,
        "name": {"$regex": f"^{re.escape(body.name.strip())}$", "$options": "i"},
        "parent_name": {"$regex": f"^{re.escape(body.parent_name.strip())}$", "$options": "i"},
        "parent_mobile": body.parent_mobile,
        "standard": {"$regex": f"^{re.escape(body.standard.strip())}$", "$options": "i"},
        "pickup_location": {"$regex": f"^{re.escape((body.pickup_location or '').strip())}$", "$options": "i"},
        "yearly_fee": body.yearly_fee,
    }
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return q


@api.post("/students")
async def create_student(body: StudentIn, admin=Depends(get_current_admin)):
    school = await db.schools.find_one({"id": body.school_id}, {"_id": 0})
    if not school:
        raise HTTPException(400, "Invalid school_id")
    fy_err = await _fy_entry_error(body.admission_date, "add student")
    if fy_err:
        raise HTTPException(400, fy_err)
    if await db.students.find_one(_duplicate_student_query(body)):
        raise HTTPException(400, "A student with the same name, parent, mobile, class, pickup location, and fee already exists")
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "created_at": now_iso()}
    await db.students.insert_one(dict(doc))
    actor = admin.get("full_name") or admin.get("email") or "Someone"
    await send_push_to_all(
        "New student added",
        f"{actor} added {doc['name']} to {school['name']}.",
        "/students",
    )
    return await student_to_out(doc)


@api.get("/students/{student_id}")
async def get_student(student_id: str, admin=Depends(get_current_admin)):
    s = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Student not found")
    return await student_to_out(s)


@api.put("/students/{student_id}")
async def update_student(student_id: str, body: StudentIn, admin=Depends(get_current_admin)):
    school = await db.schools.find_one({"id": body.school_id}, {"_id": 0})
    if not school:
        raise HTTPException(400, "Invalid school_id")
    if await db.students.find_one(_duplicate_student_query(body, exclude_id=student_id)):
        raise HTTPException(400, "A student with the same name, parent, mobile, class, pickup location, and fee already exists")
    res = await db.students.update_one({"id": student_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Student not found")
    doc = await db.students.find_one({"id": student_id}, {"_id": 0})
    return await student_to_out(doc)


@api.delete("/students/{student_id}")
async def delete_student(student_id: str, admin=Depends(get_current_admin)):
    await db.payments.delete_many({"student_id": student_id})
    await db.students.delete_one({"id": student_id})
    return {"ok": True}


# ---------- Web Push subscriptions ----------
class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: Dict[str, str]


@api.get("/push/public-key")
async def push_public_key():
    return {"public_key": VAPID_PUBLIC_KEY, "enabled": bool(VAPID_PRIVATE_KEY)}


@api.post("/push/subscribe")
async def push_subscribe(body: PushSubscriptionIn, admin=Depends(get_current_admin)):
    sub = {"endpoint": body.endpoint, "keys": body.keys}
    await db.push_subscriptions.update_one(
        {"endpoint": body.endpoint},
        {
            "$set": {
                "endpoint": body.endpoint,
                "subscription": sub,
                "user_id": admin.get("id"),
                "user_email": admin.get("email"),
                "updated_at": now_iso(),
            },
            "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now_iso()},
        },
        upsert=True,
    )
    return {"ok": True}


@api.post("/push/unsubscribe")
async def push_unsubscribe(body: Dict[str, str], admin=Depends(get_current_admin)):
    endpoint = body.get("endpoint")
    if endpoint:
        await db.push_subscriptions.delete_one({"endpoint": endpoint})
    return {"ok": True}


@api.post("/push/test")
async def push_test(admin=Depends(get_current_admin)):
    report = await push_report(
        "Test notification",
        f"Push is working — sent by {admin.get('full_name') or admin.get('email')}.",
        "/",
    )
    return {"ok": True, **report}


# ---------- Payments ----------
@api.get("/students/{student_id}/payments")
async def list_payments(student_id: str, admin=Depends(get_current_admin)):
    docs = await db.payments.find({"student_id": student_id}, {"_id": 0}).sort("payment_date", -1).to_list(1000)
    return docs


@api.post("/students/{student_id}/payments")
async def add_payment(student_id: str, body: PaymentIn, admin=Depends(get_current_admin)):
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(404, "Student not found")
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    fy_err = await _fy_entry_error(body.payment_date, "record payment")
    if fy_err:
        raise HTTPException(400, fy_err)
    existing_payments = await db.payments.find({"student_id": student_id}, {"_id": 0}).to_list(1000)
    already_paid = sum(float(p["amount"]) for p in existing_payments)
    yearly_fee = float(student["yearly_fee"])
    remaining = round(yearly_fee - already_paid, 2)
    if body.amount > remaining:
        if remaining <= 0:
            raise HTTPException(400, "Yearly fee is already fully paid; no balance remaining")
        raise HTTPException(400, f"Payment exceeds remaining balance of Rs. {remaining}")
    doc = {
        **body.model_dump(),
        "id": str(uuid.uuid4()),
        "student_id": student_id,
        "created_at": now_iso(),
    }
    await db.payments.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


@api.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, admin=Depends(get_current_admin)):
    await db.payments.delete_one({"id": payment_id})
    return {"ok": True}


# ---------- Work Management (workers & salary) ----------
_MONTHS = ["January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]


def _period_label(start: Optional[str], end: Optional[str]) -> str:
    """Names a salary cycle the way it gets spoken about — "September 2026" for a
    calendar month, "Aug–Sep 2026" when the cycle straddles two."""
    s = _parse_dt(start)
    e = _parse_dt(end)
    if not s:
        return "Salary period"
    if e and (e.month != s.month or e.year != s.year):
        if e.year != s.year:
            return f"{_MONTHS[s.month - 1][:3]} {s.year} – {_MONTHS[e.month - 1][:3]} {e.year}"
        return f"{_MONTHS[s.month - 1][:3]}–{_MONTHS[e.month - 1][:3]} {s.year}"
    return f"{_MONTHS[s.month - 1]} {s.year}"


def _sort_key(value: Optional[str]) -> datetime:
    return _parse_dt(value) or datetime.min.replace(tzinfo=timezone.utc)


def _salary_status(total: float, paid: float) -> str:
    """Deliberately separate from the student-fee status helper: work management
    is its own module, so a change to fee rules must not move salary states."""
    if paid <= 0:
        return "pending"
    if paid + 0.0001 >= total:
        return "completed"
    return "partial"


async def _worker_periods(worker_id: str) -> List[Dict[str, Any]]:
    """Every salary cycle for a worker, oldest first, with what has been paid
    against it resolved from the payment allocations."""
    periods = await db.salary_periods.find({"worker_id": worker_id}, {"_id": 0}).to_list(500)
    payments = await db.salary_payments.find({"worker_id": worker_id}, {"_id": 0}).to_list(2000)

    paid_by_period: Dict[str, float] = {}
    for pay in payments:
        for alloc in pay.get("allocations", []):
            pid = alloc.get("period_id")
            if pid:
                paid_by_period[pid] = paid_by_period.get(pid, 0.0) + float(alloc.get("amount", 0))

    periods.sort(key=lambda p: _sort_key(p.get("start_date")))
    today = datetime.now(timezone.utc)
    out: List[Dict[str, Any]] = []
    for p in periods:
        total = float(p.get("total_salary", 0))
        paid = round(paid_by_period.get(p["id"], 0.0), 2)
        pending = round(max(total - paid, 0), 2)
        end = _parse_dt(p.get("end_date"))
        matured = bool(end and end <= today)
        overdue_days = max((today - end).days, 0) if (end and matured and pending > 0) else 0
        out.append({
            **p,
            "label": _period_label(p.get("start_date"), p.get("end_date")),
            "paid_amount": paid,
            "pending_amount": pending,
            "status": _salary_status(total, paid),
            "matured": matured,
            "overdue_days": overdue_days,
        })
    return out


async def worker_to_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    """A worker plus the roll-up the list and pending screens both read from."""
    periods = await _worker_periods(doc["id"])
    total_salary = round(sum(float(p["total_salary"]) for p in periods), 2)
    total_paid = round(sum(float(p["paid_amount"]) for p in periods), 2)
    total_pending = round(sum(float(p["pending_amount"]) for p in periods), 2)

    # Only a matured cycle can be owed — an in-progress month isn't late yet.
    unpaid_matured = [p for p in periods if p["matured"] and p["pending_amount"] > 0]
    matured_pending = round(sum(float(p["pending_amount"]) for p in unpaid_matured), 2)

    last_payment = await db.salary_payments.find({"worker_id": doc["id"]}, {"_id": 0}) \
        .sort("payment_date", -1).to_list(1)

    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "period_count": len(periods),
        "total_salary": total_salary,
        "total_paid": total_paid,
        "total_pending": total_pending,
        "matured_pending": matured_pending,
        "status": _salary_status(total_salary, total_paid) if periods else "pending",
        "pending_months": [p["label"] for p in unpaid_matured],
        "oldest_pending_month": unpaid_matured[0]["label"] if unpaid_matured else None,
        "max_overdue_days": max([p["overdue_days"] for p in unpaid_matured], default=0),
        "last_payment_date": last_payment[0]["payment_date"] if last_payment else None,
    }


@api.get("/workers")
async def list_workers(
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    active: Optional[bool] = None,
    admin=Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if active is not None:
        query["active"] = active
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"mobile": {"$regex": search, "$options": "i"}},
            {"designation": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.workers.find(query, {"_id": 0}).to_list(2000)
    out = [await worker_to_out(d) for d in docs]
    if status_filter in ("pending", "partial", "completed"):
        out = [w for w in out if w["status"] == status_filter]
    out.sort(key=lambda w: (-w["matured_pending"], w["name"].lower()))
    return out


@api.post("/workers")
async def create_worker(body: WorkerIn, admin=Depends(get_current_admin)):
    if body.monthly_salary <= 0:
        raise HTTPException(400, "Monthly salary must be greater than zero")
    if await db.workers.find_one({"name": body.name.strip(), "mobile": body.mobile}):
        raise HTTPException(400, "A worker with the same name and mobile already exists")
    doc = {
        **body.model_dump(),
        "name": body.name.strip(),
        "id": str(uuid.uuid4()),
        "created_at": now_iso(),
    }
    await db.workers.insert_one(dict(doc))
    actor = admin.get("full_name") or admin.get("email") or "Someone"
    await send_push_to_all("New worker added", f"{actor} added {doc['name']} to work management.", "/work")
    return await worker_to_out(doc)


@api.get("/workers/{worker_id}")
async def get_worker(worker_id: str, admin=Depends(get_current_admin)):
    doc = await db.workers.find_one({"id": worker_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Worker not found")
    return await worker_to_out(doc)


@api.put("/workers/{worker_id}")
async def update_worker(worker_id: str, body: WorkerIn, admin=Depends(get_current_admin)):
    if body.monthly_salary <= 0:
        raise HTTPException(400, "Monthly salary must be greater than zero")
    res = await db.workers.update_one(
        {"id": worker_id}, {"$set": {**body.model_dump(), "name": body.name.strip()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Worker not found")
    doc = await db.workers.find_one({"id": worker_id}, {"_id": 0})
    return await worker_to_out(doc)


@api.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str, _=Depends(require_cap("delete"))):
    await db.salary_payments.delete_many({"worker_id": worker_id})
    await db.salary_periods.delete_many({"worker_id": worker_id})
    await db.workers.delete_one({"id": worker_id})
    return {"ok": True}


# ---------- Salary periods (months) ----------
@api.get("/workers/{worker_id}/periods")
async def list_salary_periods(worker_id: str, admin=Depends(get_current_admin)):
    if not await db.workers.find_one({"id": worker_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Worker not found")
    periods = await _worker_periods(worker_id)
    periods.reverse()  # newest month first for display
    return periods


@api.post("/workers/{worker_id}/periods")
async def create_salary_period(worker_id: str, body: SalaryPeriodIn, admin=Depends(get_current_admin)):
    worker = await db.workers.find_one({"id": worker_id}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    if body.total_salary <= 0:
        raise HTTPException(400, "Total salary must be greater than zero")
    start = _parse_dt(body.start_date)
    end = _parse_dt(body.end_date)
    if not start or not end:
        raise HTTPException(400, "Start and end dates are required")
    if end < start:
        raise HTTPException(400, "End date must be on or after the start date")

    # Overlapping cycles would let the same day's work be paid twice.
    for existing in await db.salary_periods.find({"worker_id": worker_id}, {"_id": 0}).to_list(500):
        es, ee = _parse_dt(existing.get("start_date")), _parse_dt(existing.get("end_date"))
        if es and ee and start <= ee and es <= end:
            clash = _period_label(existing.get("start_date"), existing.get("end_date"))
            raise HTTPException(400, f"This overlaps the existing salary period {clash}")

    doc = {
        **body.model_dump(),
        "id": str(uuid.uuid4()),
        "worker_id": worker_id,
        "created_at": now_iso(),
    }
    await db.salary_periods.insert_one(dict(doc))
    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "label": _period_label(doc["start_date"], doc["end_date"]),
        "paid_amount": 0.0,
        "pending_amount": round(float(doc["total_salary"]), 2),
        "status": "pending",
    }


@api.delete("/periods/{period_id}")
async def delete_salary_period(period_id: str, _=Depends(require_cap("delete"))):
    period = await db.salary_periods.find_one({"id": period_id}, {"_id": 0})
    if not period:
        raise HTTPException(404, "Salary period not found")
    paid = 0.0
    payments = await db.salary_payments.find({"worker_id": period["worker_id"]}, {"_id": 0}).to_list(2000)
    for pay in payments:
        for alloc in pay.get("allocations", []):
            if alloc.get("period_id") == period_id:
                paid += float(alloc.get("amount", 0))
    if paid > 0:
        raise HTTPException(
            400,
            f"Rs. {round(paid, 2)} is already recorded against this month — delete those payments first",
        )
    await db.salary_periods.delete_one({"id": period_id})
    return {"ok": True}


# ---------- Salary payments ----------
@api.get("/workers/{worker_id}/salary-payments")
async def list_salary_payments(worker_id: str, admin=Depends(get_current_admin)):
    docs = await db.salary_payments.find({"worker_id": worker_id}, {"_id": 0}) \
        .sort("payment_date", -1).to_list(2000)
    labels = {p["id"]: p["label"] for p in await _worker_periods(worker_id)}
    for d in docs:
        d["allocation_labels"] = [
            {"label": labels.get(a.get("period_id"), "Unknown month"),
             "amount": round(float(a.get("amount", 0)), 2)}
            for a in d.get("allocations", [])
        ]
    return docs


@api.post("/workers/{worker_id}/salary-payments")
async def add_salary_payment(worker_id: str, body: SalaryPaymentIn, admin=Depends(get_current_admin)):
    worker = await db.workers.find_one({"id": worker_id}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")

    periods = await _worker_periods(worker_id)
    if not periods:
        raise HTTPException(400, "Add a salary month for this worker before recording a payment")

    if body.period_id:
        targets = [p for p in periods if p["id"] == body.period_id]
        if not targets:
            raise HTTPException(400, "That salary month does not belong to this worker")
    else:
        # Oldest unpaid month first: a lump sum handed over after a missed month
        # settles the arrears before it touches the current one.
        targets = [p for p in periods if p["pending_amount"] > 0]

    capacity = round(sum(float(p["pending_amount"]) for p in targets), 2)
    if capacity <= 0:
        raise HTTPException(
            400,
            "This salary month is already fully paid" if body.period_id
            else "Nothing is pending for this worker",
        )
    if body.amount > capacity + 0.0001:
        raise HTTPException(400, f"Payment exceeds the pending salary of Rs. {capacity}")

    remaining = float(body.amount)
    allocations: List[Dict[str, Any]] = []
    for p in targets:
        if remaining <= 0.0001:
            break
        take = min(remaining, float(p["pending_amount"]))
        if take <= 0:
            continue
        allocations.append({"period_id": p["id"], "amount": round(take, 2)})
        remaining = round(remaining - take, 2)

    doc = {
        **{k: v for k, v in body.model_dump().items() if k != "period_id"},
        "id": str(uuid.uuid4()),
        "worker_id": worker_id,
        "allocations": allocations,
        "created_at": now_iso(),
    }
    await db.salary_payments.insert_one(dict(doc))

    labels = {p["id"]: p["label"] for p in periods}
    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "allocation_labels": [
            {"label": labels.get(a["period_id"], "Unknown month"), "amount": a["amount"]}
            for a in allocations
        ],
        "worker": await worker_to_out(worker),
    }


@api.delete("/salary-payments/{payment_id}")
async def delete_salary_payment(payment_id: str, _=Depends(require_cap("delete"))):
    res = await db.salary_payments.delete_one({"id": payment_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Salary payment not found")
    return {"ok": True}


# ---------- Work summary / pending ----------
@api.get("/work/summary")
async def work_summary(admin=Depends(get_current_admin)):
    docs = await db.workers.find({}, {"_id": 0}).to_list(2000)
    workers = [await worker_to_out(d) for d in docs]
    return {
        "total_workers": len(workers),
        "active_workers": sum(1 for w in workers if w.get("active", True)),
        "total_salary": round(sum(w["total_salary"] for w in workers), 2),
        "total_paid": round(sum(w["total_paid"] for w in workers), 2),
        "total_pending": round(sum(w["total_pending"] for w in workers), 2),
        "matured_pending": round(sum(w["matured_pending"] for w in workers), 2),
        "workers_with_pending": sum(1 for w in workers if w["matured_pending"] > 0),
    }


@api.get("/work/pending")
async def work_pending(admin=Depends(get_current_admin)):
    """Workers owed matured salary, most overdue first, with the months named."""
    docs = await db.workers.find({}, {"_id": 0}).to_list(2000)
    out = []
    for d in docs:
        w = await worker_to_out(d)
        if w["matured_pending"] <= 0:
            continue
        w["pending_periods"] = [
            p for p in await _worker_periods(d["id"]) if p["matured"] and p["pending_amount"] > 0
        ]
        out.append(w)
    out.sort(key=lambda w: -w["max_overdue_days"])
    return out


# ---------- Pending Fees ----------
@api.get("/pending-fees")
async def pending_fees(fy: Optional[str] = None, admin=Depends(get_current_admin)):
    """Return students whose next_due_date is past today and balance > 0."""
    docs = await db.students.find({}, {"_id": 0}).to_list(10000)
    if fy:
        docs = [d for d in docs if _in_fy(d.get("admission_date"), fy)]
    out = []
    today = datetime.now(timezone.utc)
    for d in docs:
        full = await student_to_out(d)
        if full["status"] == "completed":
            continue
        nd = _parse_dt(full.get("next_due_date") or full.get("due_date"))
        if not nd or nd > today:
            continue
        out.append(full)
    out.sort(key=lambda s: -s["overdue_days"])
    return out


# ---------- Dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(fy: Optional[str] = None, admin=Depends(get_current_admin)):
    docs = await db.students.find({}, {"_id": 0}).to_list(10000)
    if fy:
        docs = [d for d in docs if _in_fy(d.get("admission_date"), fy)]
    total_schools = await db.schools.count_documents({})
    total_students = len(docs)
    total_yearly = sum(float(d["yearly_fee"]) for d in docs)
    sids = [d["id"] for d in docs]
    pay_q: Dict[str, Any] = {}
    if sids:
        pay_q["student_id"] = {"$in": sids}
    payments = await db.payments.find(pay_q, {"_id": 0}).to_list(50000)
    if fy:
        payments = [p for p in payments if _in_fy(p.get("payment_date"), fy)]
    total_collected = sum(float(p["amount"]) for p in payments)
    # completed: students fully paid
    by_student: Dict[str, float] = {}
    for p in payments:
        by_student[p["student_id"]] = by_student.get(p["student_id"], 0.0) + float(p["amount"])
    completed_total = sum(float(d["yearly_fee"]) for d in docs if by_student.get(d["id"], 0.0) + 0.0001 >= float(d["yearly_fee"]))
    pending_total = max(total_yearly - total_collected, 0)
    return {
        "total_schools": total_schools,
        "total_students": total_students,
        "total_yearly": round(total_yearly, 2),
        "total_collected": round(total_collected, 2),
        "total_pending": round(pending_total, 2),
        "total_completed": round(completed_total, 2),
    }


@api.get("/dashboard/by-school")
async def dashboard_by_school(fy: Optional[str] = None, admin=Depends(get_current_admin)):
    schools = await db.schools.find({}, {"_id": 0}).to_list(1000)
    out = []
    for s in schools:
        students = await db.students.find({"school_id": s["id"]}, {"_id": 0}).to_list(5000)
        if fy:
            students = [st for st in students if _in_fy(st.get("admission_date"), fy)]
        sids = [st["id"] for st in students]
        yearly = sum(float(st["yearly_fee"]) for st in students)
        collected = 0.0
        if sids:
            pq = await db.payments.find({"student_id": {"$in": sids}}, {"_id": 0}).to_list(50000)
            if fy:
                pq = [p for p in pq if _in_fy(p.get("payment_date"), fy)]
            collected = sum(float(p["amount"]) for p in pq)
        out.append({
            "school_id": s["id"], "school_name": s["name"], "student_count": len(students),
            "yearly_total": round(yearly, 2), "collected": round(collected, 2),
            "pending": round(max(yearly - collected, 0), 2),
        })
    return out


# ---------- Financial Years ----------
@api.get("/financial-years")
async def financial_years(admin=Depends(get_current_admin)):
    """
    Returns exactly 2 FYs: current year + 1 most-recent past year.
    NEVER includes future financial years, even if student records have future admission dates.
    Includes per-FY status metadata from the financial_years collection.
    """
    cur = datetime.now(timezone.utc)
    current_label = fy_label(cur)
    current_start = int(current_label.split("-")[0])  # e.g. 2026

    # Always seed with current and immediately previous FY
    candidate_labels: set = {current_label}

    # Previous year's label: go back exactly one Indian FY
    prev_start = current_start - 1
    candidate_labels.add(f"{prev_start}-{prev_start + 1}")

    # Add any FYs explicitly created in the financial_years collection
    # (may include past years older than prev; they'll be filtered below)
    async for fydoc in db.financial_years.find({}, {"label": 1, "_id": 0}):
        lbl = fydoc.get("label", "")
        try:
            s = int(lbl.split("-")[0])
            # STRICT: only include if it's current or in the past
            if s <= current_start:
                candidate_labels.add(lbl)
        except Exception:
            pass

    # Do NOT auto-add labels from student/payment records —
    # admission/payment dates may lie in the future and would
    # pollute the FY list. Only explicit creation matters.

    # Sort descending and take current + at most 1 past year
    sorted_labels = sorted(
        candidate_labels,
        key=lambda x: int(x.split("-")[0]),
        reverse=True,
    )

    limited: list = []
    past_count = 0
    for y in sorted_labels:
        if y == current_label:
            limited.append(y)
        elif past_count < 1:
            limited.append(y)
            past_count += 1
        else:
            break

    # Fetch status metadata for the limited labels
    meta_map: Dict[str, Any] = {}
    async for fydoc in db.financial_years.find({"label": {"$in": limited}}, {"_id": 0}):
        meta_map[fydoc["label"]] = fydoc

    years_with_meta = []
    for y in limited:
        meta = meta_map.get(y, {})
        years_with_meta.append({
            "label": y,
            "status": meta.get("status", "open"),
            "closed_at": meta.get("closed_at"),
            "created_at": meta.get("created_at"),
        })

    return {
        "current": current_label,
        "years": [m["label"] for m in years_with_meta],
        "meta": years_with_meta,
    }


@api.post("/financial-years")
async def create_financial_year(payload: CreateFY, admin=Depends(get_current_admin)):
    """Manually add a current or past financial year (sets status=open)."""
    label = payload.label.strip()
    import re
    if not re.match(r"^\d{4}-\d{4}$", label):
        raise HTTPException(400, "Financial year must be in format YYYY-YYYY (e.g. 2025-2026)")

    try:
        a_str, b_str = label.split("-")
        a, b = int(a_str), int(b_str)
    except Exception:
        raise HTTPException(400, "Invalid year format")

    if b != a + 1:
        raise HTTPException(400, "Financial year years must be consecutive (e.g. 2025-2026)")

    # Check if future year
    cur = datetime.now(timezone.utc)
    current_label = fy_label(cur)
    current_start = int(current_label.split("-")[0])

    if a > current_start:
        raise HTTPException(400, "Future financial years are not allowed")

    # Strict Validation: Check if any older financial year is still open
    async for fydoc in db.financial_years.find({"status": "open"}, {"_id": 0, "label": 1}):
        old_lbl = fydoc.get("label", "")
        try:
            old_start = int(old_lbl.split("-")[0])
            if old_start < a:
                raise HTTPException(
                    400,
                    f"Cannot create FY {label} because older financial year FY {old_lbl} is still OPEN. Please close FY {old_lbl} and download its financial records first."
                )
        except Exception:
            pass

    # Upsert — create if missing, preserve existing status
    exists = await db.financial_years.find_one({"label": label})
    if not exists:
        await db.financial_years.insert_one({
            "label": label,
            "status": "open",
            "closed_at": None,
            "created_at": now_iso(),
        })
    return {"status": "success", "label": label}


class FYActionIn(BaseModel):
    label: Optional[str] = None


@api.patch("/financial-years/close")
@api.post("/financial-years/close")
@api.patch("/financial-years/{label}/close")
@api.post("/financial-years/{label}/close")
async def close_financial_year(
    label: Optional[str] = None,
    body: Optional[FYActionIn] = None,
    fy: Optional[str] = Query(None),
    admin=Depends(get_current_admin),
):
    """Mark a financial year as closed. Cannot re-open once closed."""
    target = label or fy or (body and body.label)
    if not target:
        raise HTTPException(400, "Missing financial year label")
    target = target.strip()
    import re
    if not re.match(r"^\d{4}-\d{4}$", target):
        raise HTTPException(400, "Invalid financial year label format (expected YYYY-YYYY)")

    # Ensure the FY doc exists; create if it was auto-derived
    exists = await db.financial_years.find_one({"label": target})
    if not exists:
        await db.financial_years.insert_one({
            "label": target,
            "status": "open",
            "closed_at": None,
            "created_at": now_iso(),
        })

    doc = await db.financial_years.find_one({"label": target})
    if doc and doc.get("status") == "closed":
        raise HTTPException(400, "Financial year is already closed")

    await db.financial_years.update_one(
        {"label": target},
        {"$set": {"status": "closed", "closed_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True, "label": target, "status": "closed"}


@api.delete("/financial-years/records")
@api.post("/financial-years/records")
@api.post("/financial-years/delete")
@api.delete("/financial-years/{label}/records")
@api.post("/financial-years/{label}/records")
@api.post("/financial-years/{label}/delete")
async def delete_fy_records(
    label: Optional[str] = None,
    body: Optional[FYActionIn] = None,
    fy: Optional[str] = Query(None),
    admin=Depends(get_current_admin),
):
    """Delete all students and their payments that belong to the given closed financial year."""
    target = label or fy or (body and body.label)
    if not target:
        raise HTTPException(400, "Missing financial year label")
    target = target.strip()
    import re
    if not re.match(r"^\d{4}-\d{4}$", target):
        raise HTTPException(400, "Invalid financial year label format")

    # Require FY to be closed before deleting
    fy_doc = await db.financial_years.find_one({"label": target})
    if not fy_doc or fy_doc.get("status") != "closed":
        raise HTTPException(400, "Financial year must be closed before deleting its records")

    # Find students in this FY (filtered by admission_date)
    all_students = await db.students.find({}, {"_id": 0, "id": 1, "admission_date": 1}).to_list(50000)
    target_sids = [s["id"] for s in all_students if _in_fy(s.get("admission_date"), target)]

    deleted_payments = 0
    deleted_students = 0
    if target_sids:
        res_p = await db.payments.delete_many({"student_id": {"$in": target_sids}})
        deleted_payments = res_p.deleted_count
        res_s = await db.students.delete_many({"id": {"$in": target_sids}})
        deleted_students = res_s.deleted_count

    # Also remove the FY doc itself so it no longer appears
    await db.financial_years.delete_one({"label": target})

    return {
        "ok": True,
        "label": target,
        "deleted_students": deleted_students,
        "deleted_payments": deleted_payments,
    }


@api.delete("/financial-years/reset")
@api.post("/financial-years/reset")
@api.delete("/financial-years/{label}/reset")
@api.post("/financial-years/{label}/reset")
async def reset_fy_data(
    label: Optional[str] = None,
    body: Optional[FYActionIn] = None,
    fy: Optional[str] = Query(None),
    admin=Depends(get_current_admin),
):
    """Delete all students and payments belonging to a financial year, independent of its
    open/closed status. Unlike delete_fy_records, the FY registration itself is kept (stays
    open) so the year can immediately be used again with fresh data."""
    target = label or fy or (body and body.label)
    if not target:
        raise HTTPException(400, "Missing financial year label")
    target = target.strip()
    import re
    if not re.match(r"^\d{4}-\d{4}$", target):
        raise HTTPException(400, "Invalid financial year label format")

    all_students = await db.students.find({}, {"_id": 0, "id": 1, "admission_date": 1}).to_list(50000)
    target_sids = [s["id"] for s in all_students if _in_fy(s.get("admission_date"), target)]

    deleted_payments = 0
    deleted_students = 0
    if target_sids:
        res_p = await db.payments.delete_many({"student_id": {"$in": target_sids}})
        deleted_payments = res_p.deleted_count
        res_s = await db.students.delete_many({"id": {"$in": target_sids}})
        deleted_students = res_s.deleted_count

    return {
        "ok": True,
        "label": target,
        "deleted_students": deleted_students,
        "deleted_payments": deleted_payments,
    }


# ---------- Reports: real PDF + real Excel ----------
def _format_inr(n: float) -> str:
    s = f"{int(round(n)):,}"
    parts = s.split(",")
    if len(parts) > 1:
        first, rest = parts[0], "".join(parts[1:])
        groups = []
        while len(rest) > 3:
            groups.insert(0, rest[-3:]); rest = rest[:-3]
        groups.insert(0, rest)
        head: List[str] = []
        while len(first) > 2:
            head.insert(0, first[-2:]); first = first[:-2]
        if first:
            head.insert(0, first)
        return "Rs. " + ",".join(head + groups)
    return "Rs. " + s


def _fmt_dt(s: Optional[str]) -> str:
    if not s:
        return "—"
    dt = _parse_dt(s)
    if not dt:
        return s
    return dt.strftime("%d/%m/%Y %H:%M")


async def _gather_report_rows(
    school_id: Optional[str], status_filter: Optional[str], start: Optional[str], end: Optional[str], fy: Optional[str]
):
    query: Dict[str, Any] = {}
    if school_id:
        query["school_id"] = school_id
    docs = await db.students.find(query, {"_id": 0}).to_list(10000)
    if fy:
        docs = [d for d in docs if _in_fy(d.get("admission_date"), fy)]
    out = []
    s_dt = _parse_dt(start)
    e_dt = _parse_dt(end)
    for d in docs:
        s = await student_to_out(d, fy=fy)
        if status_filter and s["status"] != status_filter:
            continue
        nd = _parse_dt(s.get("next_due_date") or s.get("due_date"))
        if s_dt and nd and nd < s_dt:
            continue
        if e_dt and nd and nd > e_dt:
            continue
        out.append(s)
    return out


@api.get("/reports/excel")
async def report_excel(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    fy: Optional[str] = None,
    admin=Depends(get_current_admin),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    rows = await _gather_report_rows(school_id, status_filter, start, end, fy)
    wb = Workbook()
    ws = wb.active
    ws.title = "Bus Fee Report"

    title_font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="2B4C3E")
    head_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    money = Font(name="Calibri", size=10)

    ws.merge_cells("A1:J1")
    cell = ws["A1"]
    cell.value = f"Bus Fee Report — Generated {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    cell.font = title_font
    cell.fill = head_fill
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 26

    headers = ["Student", "School", "Class", "Parent", "Mobile", "Yearly Fee", "Paid", "Pending", "Status", "Next Due"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=3, column=i, value=h)
        c.font = head_font
        c.fill = head_fill
        c.alignment = Alignment(horizontal="center")

    total_y = total_p = total_pend = 0.0
    for idx, s in enumerate(rows, start=4):
        ws.cell(row=idx, column=1, value=s["name"])
        ws.cell(row=idx, column=2, value=s["school_name"])
        ws.cell(row=idx, column=3, value=s["standard"])
        ws.cell(row=idx, column=4, value=s["parent_name"])
        ws.cell(row=idx, column=5, value=s["parent_mobile"])
        ws.cell(row=idx, column=6, value=float(s["yearly_fee"])).number_format = '"₹"#,##0'
        ws.cell(row=idx, column=7, value=float(s["paid_amount"])).number_format = '"₹"#,##0'
        ws.cell(row=idx, column=8, value=float(s["pending_amount"])).number_format = '"₹"#,##0'
        ws.cell(row=idx, column=9, value=s["status"].title())
        ws.cell(row=idx, column=10, value=_fmt_dt(s.get("next_due_date")))
        total_y += s["yearly_fee"]
        total_p += s["paid_amount"]
        total_pend += s["pending_amount"]

    tot_row = len(rows) + 5
    ws.cell(row=tot_row, column=5, value="TOTAL").font = Font(bold=True)
    ws.cell(row=tot_row, column=6, value=total_y).number_format = '"₹"#,##0'
    ws.cell(row=tot_row, column=7, value=total_p).number_format = '"₹"#,##0'
    ws.cell(row=tot_row, column=8, value=max(total_y - total_p, 0)).number_format = '"₹"#,##0'
    for col in range(5, 9):
        ws.cell(row=tot_row, column=col).font = Font(bold=True)

    widths = [22, 22, 8, 22, 14, 14, 14, 14, 12, 18]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"bus-fee-report-{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.get("/reports/pdf")
async def report_pdf(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    fy: Optional[str] = None,
    admin=Depends(get_current_admin),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    rows = await _gather_report_rows(school_id, status_filter, start, end, fy)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#2B4C3E"))
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#6B7280"))

    story: List[Any] = []
    story.append(Paragraph("Bus Fee Management Report", title_style))
    story.append(Paragraph(
        f"Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
        f"{' · FY: ' + fy if fy else ''}"
        f"{' · Status: ' + status_filter.title() if status_filter else ''}",
        sub_style,
    ))
    story.append(Spacer(1, 10))

    headers = ["Student", "School", "Class", "Parent", "Mobile", "Yearly", "Paid", "Pending", "Status", "Next Due"]
    data: List[List[Any]] = [headers]
    total_y = total_p = total_pend = 0.0
    for s in rows:
        data.append([
            s["name"], s["school_name"], s["standard"], s["parent_name"], s["parent_mobile"],
            _format_inr(s["yearly_fee"]), _format_inr(s["paid_amount"]), _format_inr(s["pending_amount"]),
            s["status"].title(), _fmt_dt(s.get("next_due_date")),
        ])
        total_y += s["yearly_fee"]
        total_p += s["paid_amount"]
        total_pend += s["pending_amount"]
    data.append(["", "", "", "", "TOTAL", _format_inr(total_y), _format_inr(total_p), _format_inr(max(total_y - total_p, 0)), "", ""])

    tbl = Table(data, repeatRows=1, colWidths=[28*mm, 28*mm, 14*mm, 28*mm, 24*mm, 22*mm, 22*mm, 22*mm, 18*mm, 26*mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2B4C3E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (5, 0), (7, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("GRID", (0, 0), (-1, -2), 0.4, colors.HexColor("#E5E7EB")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F2F5F3")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.HexColor("#2B4C3E")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F9FAFB")]),
    ]))
    story.append(tbl)
    doc.build(story)
    buf.seek(0)
    fname = f"bus-fee-report-{datetime.now().strftime('%Y%m%d-%H%M')}.pdf"
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


# Keep legacy endpoints
@api.get("/reports/csv", response_class=PlainTextResponse)
async def report_csv(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    fy: Optional[str] = None,
    admin=Depends(get_current_admin),
):
    rows = await _gather_report_rows(school_id, status_filter, start, end, fy)
    out = ["Student,School,Class,Parent,Mobile,Yearly Fee,Paid,Pending,Status,Next Due"]
    for s in rows:
        out.append(
            f'"{s["name"]}","{s["school_name"]}","{s["standard"]}","{s["parent_name"]}",'
            f'"{s["parent_mobile"]}",{s["yearly_fee"]},{s["paid_amount"]},{s["pending_amount"]},'
            f'{s["status"]},"{_fmt_dt(s.get("next_due_date"))}"'
        )
    return "\n".join(out)


@api.get("/reports/html", response_class=HTMLResponse)
async def report_html(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    fy: Optional[str] = None,
    admin=Depends(get_current_admin),
):
    rows = await _gather_report_rows(school_id, status_filter, start, end, fy)
    body_rows: List[str] = []
    total_y = total_p = total_pend = 0.0
    for s in rows:
        body_rows.append(
            f"<tr><td>{s['name']}</td><td>{s['school_name']}</td><td>{s['standard']}</td>"
            f"<td>{_format_inr(s['yearly_fee'])}</td><td>{_format_inr(s['paid_amount'])}</td>"
            f"<td>{_format_inr(s['pending_amount'])}</td><td>{s['status']}</td>"
            f"<td>{_fmt_dt(s.get('next_due_date'))}</td></tr>"
        )
        total_y += s["yearly_fee"]; total_p += s["paid_amount"]; total_pend += s["pending_amount"]
    return f"""<html><head><meta charset='utf-8'><title>Bus Fee Report</title>
    <style>body{{font-family:system-ui;padding:24px;color:#111}}h1{{color:#2B4C3E}}
    table{{width:100%;border-collapse:collapse}}th,td{{padding:8px;border-bottom:1px solid #E5E7EB;text-align:left;font-size:13px}}
    th{{background:#F3F4F6}}.tot{{margin-top:16px;background:#F2F5F3;padding:12px;border-radius:8px}}</style></head>
    <body><h1>Bus Fee Report</h1><p>Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}</p>
    <table><thead><tr><th>Student</th><th>School</th><th>Class</th><th>Yearly</th><th>Paid</th><th>Pending</th><th>Status</th><th>Next Due</th></tr></thead>
    <tbody>{''.join(body_rows) or '<tr><td colspan=8>No records</td></tr>'}</tbody></table>
    <div class='tot'><b>Total Yearly:</b> {_format_inr(total_y)} &nbsp; <b>Total Collected:</b> {_format_inr(total_p)} &nbsp; <b>Total Pending:</b> {_format_inr(max(total_y - total_p, 0))}</div>
    </body></html>"""


# ---------- User Management (Admin only) ----------
class UserIn(BaseModel):
    full_name: str
    email: EmailStr
    mobile: Optional[str] = ""
    password: str
    role: str = ROLE_GUEST
    status: str = "active"
    page_permissions: Optional[List[str]] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    mobile: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    page_permissions: Optional[List[str]] = None


class PasswordResetByAdmin(BaseModel):
    new_password: str


def _user_to_out(u: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in u.items() if k not in ("_id", "password_hash")}


@api.get("/users")
async def list_users(_=Depends(require_cap("manage_users"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs


@api.get("/users/roles")
async def role_info(_=Depends(require_cap("manage_users"))):
    return {
        "roles": [ROLE_ADMIN, ROLE_AUTHOR, ROLE_GUEST],
        "default_permissions": ROLE_DEFAULT_PERMS,
        "all_pages": ALL_PAGES,
        "max_authors": MAX_AUTHORS,
    }


@api.post("/users")
async def create_user(body: UserIn, _=Depends(require_cap("manage_users"))):
    if body.role not in (ROLE_ADMIN, ROLE_AUTHOR, ROLE_GUEST):
        raise HTTPException(400, "Invalid role")
    if body.role == ROLE_AUTHOR:
        count = await db.users.count_documents({"role": ROLE_AUTHOR})
        if count >= MAX_AUTHORS:
            raise HTTPException(400, f"Maximum {MAX_AUTHORS} Author users are allowed.")
    existing = await db.users.find_one({"email": body.email})
    if existing:
        raise HTTPException(400, "Email already registered")
    perms = body.page_permissions if body.page_permissions is not None else ROLE_DEFAULT_PERMS.get(body.role, [])
    doc = {
        "id": str(uuid.uuid4()),
        "email": body.email,
        "full_name": body.full_name,
        "mobile": body.mobile or "",
        "password_hash": hash_password(body.password),
        "role": body.role,
        "status": body.status if body.status in ("active", "inactive") else "active",
        "page_permissions": perms,
        "created_at": now_iso(),
        "last_login": None,
    }
    await db.users.insert_one(dict(doc))
    return _user_to_out(doc)


@api.put("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin=Depends(require_cap("manage_users"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    updates: Dict[str, Any] = {}
    if body.full_name is not None:
        updates["full_name"] = body.full_name
    if body.mobile is not None:
        updates["mobile"] = body.mobile
    if body.role is not None:
        if body.role not in (ROLE_ADMIN, ROLE_AUTHOR, ROLE_GUEST):
            raise HTTPException(400, "Invalid role")
        if body.role == ROLE_AUTHOR and target.get("role") != ROLE_AUTHOR:
            count = await db.users.count_documents({"role": ROLE_AUTHOR})
            if count >= MAX_AUTHORS:
                raise HTTPException(400, f"Maximum {MAX_AUTHORS} Author users are allowed.")
        if target["email"] == ADMIN_EMAIL and body.role != ROLE_ADMIN:
            raise HTTPException(400, "Cannot change role of the primary admin")
        updates["role"] = body.role
        if body.page_permissions is None:
            updates["page_permissions"] = ROLE_DEFAULT_PERMS.get(body.role, [])
    if body.status is not None:
        if target["email"] == ADMIN_EMAIL and body.status != "active":
            raise HTTPException(400, "Cannot deactivate primary admin")
        updates["status"] = body.status
    if body.page_permissions is not None:
        updates["page_permissions"] = body.page_permissions
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return doc


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_cap("manage_users"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    if target["email"] == ADMIN_EMAIL:
        raise HTTPException(400, "Cannot delete primary admin")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


@api.post("/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, body: PasswordResetByAdmin, _=Depends(require_cap("manage_users"))):
    if len(body.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}


# ---------- Bulk WhatsApp ----------
@api.get("/whatsapp/bulk-pending")
async def bulk_pending(fy: Optional[str] = None, admin=Depends(get_current_admin)):
    """Build a list of {phone, message} entries for all overdue students. Client opens wa.me sequentially with delay."""
    docs = await db.students.find({}, {"_id": 0}).to_list(10000)
    if fy:
        docs = [d for d in docs if _in_fy(d.get("admission_date"), fy)]
    out = []
    today = datetime.now(timezone.utc)
    for d in docs:
        full = await student_to_out(d)
        if full["status"] == "completed":
            continue
        nd = _parse_dt(full.get("next_due_date") or full.get("due_date"))
        if not nd or nd > today:
            continue
        out.append({
            "student_id": full["id"],
            "student_name": full["name"],
            "school_name": full["school_name"],
            "parent_name": full["parent_name"],
            "phone": full["parent_mobile"],
            "pending_amount": full["pending_amount"],
            "next_due_date": full.get("next_due_date") or full.get("due_date"),
            "overdue_days": full["overdue_days"],
        })
    return {"count": len(out), "items": out}


# ---------- Archive (Firebase Storage) ----------
@api.get("/archive/status")
async def archive_status(_=Depends(require_cap("archive"))):
    bucket = _get_bucket()
    archives = await db.archives.find({}, {"_id": 0}).to_list(100)
    return {
        "firebase_ready": bucket is not None,
        "bucket": FIREBASE_BUCKET if bucket is not None else None,
        "archives": archives,
    }


@api.post("/archive/backup")
async def archive_backup(fy: str = Query(..., description="Financial year label e.g. 2026-2027"), _=Depends(require_cap("archive"))):
    import json as _json
    bucket = _get_bucket()
    schools = await db.schools.find({}, {"_id": 0}).to_list(10000)
    students = await db.students.find({}, {"_id": 0}).to_list(50000)
    students = [s for s in students if _in_fy(s.get("admission_date"), fy)]
    sids = [s["id"] for s in students]
    payments = await db.payments.find({"student_id": {"$in": sids}}, {"_id": 0}).to_list(100000) if sids else []
    payments = [p for p in payments if _in_fy(p.get("payment_date"), fy)]
    snapshot = {
        "fy": fy,
        "exported_at": now_iso(),
        "schools": schools,
        "students": students,
        "payments": payments,
        "counts": {"schools": len(schools), "students": len(students), "payments": len(payments)},
    }
    payload = _json.dumps(snapshot, default=str).encode("utf-8")
    storage_url = None
    storage_error: Optional[str] = None
    if bucket is not None:
        try:
            blob = bucket.blob(f"archives/busfee-{fy}.json")
            blob.upload_from_string(payload, content_type="application/json")
            try:
                storage_url = blob.public_url
            except Exception:
                storage_url = f"gs://{FIREBASE_BUCKET}/archives/busfee-{fy}.json"
        except Exception as exc:
            storage_error = str(exc).splitlines()[0][:200]
            logger.warning(f"Firebase upload failed, falling back to MongoDB: {storage_error}")
    await db.archives.update_one(
        {"fy": fy},
        {"$set": {
            "fy": fy, "exported_at": snapshot["exported_at"],
            "counts": snapshot["counts"], "storage_url": storage_url,
            "size_bytes": len(payload),
            "local_snapshot": snapshot if storage_url is None else None,
        }},
        upsert=True,
    )
    return {
        "ok": True, "fy": fy, "counts": snapshot["counts"], "storage_url": storage_url,
        "stored_in": "firebase" if storage_url else "mongodb-local",
        "warning": storage_error,
    }


@api.post("/archive/restore")
async def archive_restore(fy: str = Query(...), _=Depends(require_cap("archive"))):
    import json as _json
    bucket = _get_bucket()
    arch = await db.archives.find_one({"fy": fy}, {"_id": 0})
    if not arch:
        raise HTTPException(404, "No archive recorded for that FY")
    snapshot = None
    if bucket is not None and arch.get("storage_url"):
        blob = bucket.blob(f"archives/busfee-{fy}.json")
        if blob.exists():
            data = blob.download_as_bytes()
            snapshot = _json.loads(data.decode("utf-8"))
    if snapshot is None:
        snapshot = arch.get("local_snapshot")
    if not snapshot:
        raise HTTPException(404, "Archive payload not available")

    # idempotent restore: upsert by id, do not duplicate
    for s in snapshot.get("schools", []):
        await db.schools.update_one({"id": s["id"]}, {"$set": s}, upsert=True)
    for st in snapshot.get("students", []):
        await db.students.update_one({"id": st["id"]}, {"$set": st}, upsert=True)
    for p in snapshot.get("payments", []):
        await db.payments.update_one({"id": p["id"]}, {"$set": p}, upsert=True)
    return {"ok": True, "fy": fy, "restored": snapshot.get("counts", {})}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "school-bus-fee-management", "status": "ok"}


app.include_router(api)
