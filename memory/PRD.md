# Bus Fee Manager — PRD (Phase 2 complete)

## Auth
- Primary admin `kharwaramog02@gmail.com` / `12345678` (protected — cannot be deleted/disabled)
- Forgot-password OTP via SendGrid (console fallback in dev)
- JWT (HS256) carries `role`; AsyncStorage; also accepts `?token=` query for downloads

## RBAC
- **Admin** — every page + every capability
- **Author** — max **3** accounts; pages: dashboard, students, pending, reports; caps: create/edit/export (no delete, no user management, no archive)
- **Guest** — unlimited; admin sets per-user page_permissions; no write caps by default

## Modules
1. **Schools** CRUD
2. **Students** CRUD with datetime admission/due, FY filter
3. **Payments** with `next_due_date` → drives overdue tracking
4. **Pending Fees** screen + **Bulk WhatsApp** ("Notify all" sequential wa.me, 2 s rate-limit)
5. **Dashboard** KPIs + school cards + Financial Year chip selector (Indian Apr–Mar)
6. **Reports** real PDF (reportlab) + real Excel (.xlsx via openpyxl); FY + school + status + date range filters
7. **Yearly Archive** — Firebase Storage upload with idempotent restore; auto-fallback to MongoDB when bucket missing
8. **Users** (admin-only tab) — create / edit / delete / activate-deactivate / reset password / page-permission matrix
9. **Skeleton loaders** on Dashboard, Pending, Users

## Frontend
- Tabs gated by `page_permissions` + role (Users tab only when role === 'admin')
- WhatsApp wa.me reminders with Indian INR formatting

## Configuration
- `/app/backend/.env`: `FIREBASE_CREDENTIALS_PATH`, `FIREBASE_BUCKET`
- Firebase Storage bucket `fees-management-app-d0025.firebasestorage.app` — user must enable Storage in Firebase Console for cloud archive to engage; otherwise MongoDB fallback used silently with warning field.
