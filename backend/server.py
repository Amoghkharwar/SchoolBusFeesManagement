"""School Bus Fee Management — FastAPI backend."""
from __future__ import annotations

import logging
import os
import random
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import PlainTextResponse, HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------- Config ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "720"))
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "noreply@busfee.app")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@busfee.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@123")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("busfee")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="School Bus Fee Management API")
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


def make_token(email: str) -> str:
    payload = {
        "sub": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


async def get_current_admin(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    email = payload.get("sub")
    admin = await db.admins.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin


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


# ---------- Models ----------
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


class SchoolOut(SchoolIn):
    id: str
    created_at: str


class StudentIn(BaseModel):
    name: str
    parent_name: str
    parent_mobile: str  # WhatsApp number with country code preferred
    school_id: str
    standard: str
    pickup_location: Optional[str] = ""
    yearly_fee: float
    admission_date: str  # ISO date
    due_date: str  # ISO date


class StudentOut(StudentIn):
    id: str
    school_name: str
    paid_amount: float
    pending_amount: float
    status: str  # pending / partial / completed
    created_at: str


class PaymentIn(BaseModel):
    amount: float
    payment_date: str  # ISO date
    mode: str  # cash / upi / bank
    note: Optional[str] = ""


class PaymentOut(PaymentIn):
    id: str
    student_id: str
    created_at: str


# ---------- Helpers ----------
def compute_status(yearly: float, paid: float) -> str:
    if paid <= 0:
        return "pending"
    if paid + 0.0001 >= yearly:
        return "completed"
    return "partial"


async def student_to_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    school = await db.schools.find_one({"id": doc["school_id"]}, {"_id": 0, "name": 1})
    paid_agg = await db.payments.aggregate(
        [
            {"$match": {"student_id": doc["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    paid = float(paid_agg[0]["total"]) if paid_agg else 0.0
    yearly = float(doc["yearly_fee"])
    status_ = compute_status(yearly, paid)
    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "school_name": (school or {}).get("name", "—"),
        "paid_amount": round(paid, 2),
        "pending_amount": round(max(yearly - paid, 0), 2),
        "status": status_,
    }


# ---------- Startup ----------
@app.on_event("startup")
async def startup() -> None:
    await db.admins.create_index("email", unique=True)
    await db.schools.create_index("id", unique=True)
    await db.students.create_index("id", unique=True)
    await db.payments.create_index("id", unique=True)
    await db.password_resets.create_index("email")

    existing = await db.admins.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.admins.insert_one(
            {
                "email": ADMIN_EMAIL,
                "password_hash": hash_password(ADMIN_PASSWORD),
                "created_at": now_iso(),
            }
        )
        logger.info(f"Seeded admin: {ADMIN_EMAIL}")

    # Seed sample data if empty (helpful for first-run preview)
    if await db.schools.count_documents({}) == 0:
        import uuid as _uuid

        sample_schools = [
            {"id": str(_uuid.uuid4()), "name": "JB School", "address": "Main Road, Anand", "contact_person": "Mr. Joshi", "contact_phone": "9876500011", "created_at": now_iso()},
            {"id": str(_uuid.uuid4()), "name": "DP School", "address": "Station Road, Vadodara", "contact_person": "Mrs. Patel", "contact_phone": "9876500022", "created_at": now_iso()},
        ]
        await db.schools.insert_many([dict(s) for s in sample_schools])
        logger.info("Seeded sample schools")


@app.on_event("shutdown")
async def shutdown() -> None:
    client.close()


# ---------- Auth ----------
@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    admin = await db.admins.find_one({"email": body.email})
    if not admin or not verify_password(body.password, admin["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return TokenOut(token=make_token(body.email), email=body.email)


@api.get("/auth/me")
async def me(admin=Depends(get_current_admin)):
    return admin


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn):
    admin = await db.admins.find_one({"email": body.email})
    # always respond 200 to avoid user enumeration, but only send mail if exists
    if admin:
        otp = gen_otp()
        await db.password_resets.update_one(
            {"email": body.email},
            {
                "$set": {
                    "email": body.email,
                    "otp": otp,
                    "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
                    "consumed": False,
                    "created_at": now_iso(),
                }
            },
            upsert=True,
        )
        html = f"""
        <div style='font-family:system-ui,sans-serif;padding:24px;background:#f9fafb;'>
          <h2 style='color:#2B4C3E;'>Bus Fee Manager — Password Reset Approval</h2>
          <p>We received a request to reset the password for <b>{body.email}</b>.</p>
          <p>Your one-time approval code (valid for 15 minutes) is:</p>
          <div style='font-size:34px;font-weight:700;letter-spacing:6px;background:#fff;padding:18px 24px;border-radius:12px;display:inline-block;border:1px solid #E5E7EB;color:#111827;'>{otp}</div>
          <p style='margin-top:24px;'>Enter this code in the app to approve and set your new password.</p>
          <p style='color:#6B7280;font-size:12px;'>If you did not request this, ignore this email — your password will remain unchanged (reject).</p>
        </div>
        """
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
    await db.admins.update_one(
        {"email": body.email}, {"$set": {"password_hash": hash_password(body.new_password)}}
    )
    await db.password_resets.update_one({"email": body.email}, {"$set": {"consumed": True}})
    return {"ok": True, "message": "Password approved and updated. You can now log in."}


# ---------- Schools ----------
import uuid


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
    due: Optional[str] = None,  # 'today' | 'week'
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
    out = [await student_to_out(d) for d in docs]
    if status_filter and status_filter in ("pending", "partial", "completed"):
        out = [s for s in out if s["status"] == status_filter]
    if due:
        today = datetime.now(timezone.utc).date()
        end = today + (timedelta(days=0) if due == "today" else timedelta(days=7))
        kept = []
        for s in out:
            try:
                d = datetime.fromisoformat(s["due_date"]).date()
            except Exception:
                continue
            if due == "today" and d == today:
                kept.append(s)
            elif due == "week" and today <= d <= end:
                kept.append(s)
        out = kept
    return out


@api.post("/students")
async def create_student(body: StudentIn, admin=Depends(get_current_admin)):
    school = await db.schools.find_one({"id": body.school_id}, {"_id": 0})
    if not school:
        raise HTTPException(400, "Invalid school_id")
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "created_at": now_iso()}
    await db.students.insert_one(dict(doc))
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


# ---------- Dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(admin=Depends(get_current_admin)):
    total_schools = await db.schools.count_documents({})
    total_students = await db.students.count_documents({})

    yearly_agg = await db.students.aggregate(
        [{"$group": {"_id": None, "total": {"$sum": "$yearly_fee"}}}]
    ).to_list(1)
    total_yearly = float(yearly_agg[0]["total"]) if yearly_agg else 0.0

    paid_agg = await db.payments.aggregate(
        [{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    ).to_list(1)
    total_collected = float(paid_agg[0]["total"]) if paid_agg else 0.0

    docs = await db.students.find({}, {"_id": 0}).to_list(10000)
    completed_total = 0.0
    pending_total = 0.0
    for d in docs:
        p_agg = await db.payments.aggregate(
            [{"$match": {"student_id": d["id"]}}, {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]
        ).to_list(1)
        paid = float(p_agg[0]["t"]) if p_agg else 0.0
        yearly = float(d["yearly_fee"])
        if paid + 0.0001 >= yearly:
            completed_total += yearly
        pending_total += max(yearly - paid, 0)

    return {
        "total_schools": total_schools,
        "total_students": total_students,
        "total_yearly": round(total_yearly, 2),
        "total_collected": round(total_collected, 2),
        "total_pending": round(pending_total, 2),
        "total_completed": round(completed_total, 2),
    }


@api.get("/dashboard/by-school")
async def dashboard_by_school(admin=Depends(get_current_admin)):
    schools = await db.schools.find({}, {"_id": 0}).to_list(1000)
    out = []
    for s in schools:
        students = await db.students.find({"school_id": s["id"]}, {"_id": 0}).to_list(5000)
        sids = [st["id"] for st in students]
        yearly = sum(float(st["yearly_fee"]) for st in students)
        collected = 0.0
        if sids:
            paid_agg = await db.payments.aggregate(
                [{"$match": {"student_id": {"$in": sids}}}, {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]
            ).to_list(1)
            collected = float(paid_agg[0]["t"]) if paid_agg else 0.0
        out.append(
            {
                "school_id": s["id"],
                "school_name": s["name"],
                "student_count": len(students),
                "yearly_total": round(yearly, 2),
                "collected": round(collected, 2),
                "pending": round(max(yearly - collected, 0), 2),
            }
        )
    return out


# ---------- Reports ----------
def _format_inr(n: float) -> str:
    # Indian number format
    s = f"{int(round(n)):,}"
    # convert western to Indian grouping
    parts = s.split(",")
    if len(parts) > 1:
        first = parts[0]
        rest = "".join(parts[1:])
        # rebuild rest as 2-digit groups
        groups = []
        while len(rest) > 3:
            groups.insert(0, rest[-3:])
            rest = rest[:-3]
        groups.insert(0, rest)
        head_chunks = []
        while len(first) > 2:
            head_chunks.insert(0, first[-2:])
            first = first[:-2]
        if first:
            head_chunks.insert(0, first)
        return "₹" + ",".join(head_chunks + groups)
    return "₹" + s


@api.get("/reports/csv", response_class=PlainTextResponse)
async def report_csv(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    admin=Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if school_id:
        query["school_id"] = school_id
    docs = await db.students.find(query, {"_id": 0}).to_list(10000)
    rows = [
        "Student,School,Parent,Mobile,Standard,Yearly Fee,Paid,Pending,Status,Due Date",
    ]
    for d in docs:
        s = await student_to_out(d)
        if status_filter and s["status"] != status_filter:
            continue
        # date filter is on student due_date
        if start:
            try:
                if datetime.fromisoformat(s["due_date"]) < datetime.fromisoformat(start):
                    continue
            except Exception:
                pass
        if end:
            try:
                if datetime.fromisoformat(s["due_date"]) > datetime.fromisoformat(end):
                    continue
            except Exception:
                pass
        rows.append(
            f"{s['name']},{s['school_name']},{s['parent_name']},{s['parent_mobile']},{s['standard']},{s['yearly_fee']},{s['paid_amount']},{s['pending_amount']},{s['status']},{s['due_date']}"
        )
    return "\n".join(rows)


@api.get("/reports/html", response_class=HTMLResponse)
async def report_html(
    school_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    admin=Depends(get_current_admin),
):
    query: Dict[str, Any] = {}
    if school_id:
        query["school_id"] = school_id
    docs = await db.students.find(query, {"_id": 0}).to_list(10000)
    body_rows = []
    total_yearly = total_paid = total_pending = 0.0
    for d in docs:
        s = await student_to_out(d)
        if status_filter and s["status"] != status_filter:
            continue
        total_yearly += s["yearly_fee"]
        total_paid += s["paid_amount"]
        total_pending += s["pending_amount"]
        body_rows.append(
            f"<tr><td>{s['name']}</td><td>{s['school_name']}</td><td>{s['standard']}</td><td>{_format_inr(s['yearly_fee'])}</td><td>{_format_inr(s['paid_amount'])}</td><td>{_format_inr(s['pending_amount'])}</td><td>{s['status']}</td><td>{s['due_date']}</td></tr>"
        )
    html = f"""
    <html><head><meta charset='utf-8'><title>Bus Fee Report</title>
    <style>body{{font-family:system-ui;padding:24px;color:#111}}h1{{color:#2B4C3E}}table{{width:100%;border-collapse:collapse}}th,td{{padding:8px;border-bottom:1px solid #E5E7EB;text-align:left;font-size:13px}}th{{background:#F3F4F6}}.tot{{margin-top:16px;background:#F2F5F3;padding:12px;border-radius:8px}}</style>
    </head><body><h1>Bus Fee Report</h1>
    <p>Generated: {datetime.now().strftime('%d %b %Y, %H:%M')}</p>
    <table><thead><tr><th>Student</th><th>School</th><th>Class</th><th>Yearly</th><th>Paid</th><th>Pending</th><th>Status</th><th>Due</th></tr></thead><tbody>
    {''.join(body_rows) or '<tr><td colspan=8>No records</td></tr>'}
    </tbody></table>
    <div class='tot'><b>Total Yearly:</b> {_format_inr(total_yearly)} &nbsp; <b>Total Collected:</b> {_format_inr(total_paid)} &nbsp; <b>Total Pending:</b> {_format_inr(total_pending)}</div>
    </body></html>
    """
    return html


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "school-bus-fee-management", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
