# Bus Fee Manager — PRD (Phase 1 enhanced)

## Auth
- Single admin: `kharwaramog02@gmail.com` / `12345678` (seeded; previous admin removed)
- Forgot-password OTP via SendGrid (console fallback in dev)
- JWT (HS256) in AsyncStorage; supports `?token=` query for file downloads

## Modules
1. **Schools** CRUD
2. **Students** CRUD with datetime admission/due dates, FY filter
3. **Payments** with `next_due_date` (datetime) — drives overdue tracking
4. **Pending Fees** tab — overdue students with days overdue + last/next dates + WhatsApp
5. **Dashboard** KPIs + school cards + Financial Year chip selector (FY 2025-2026 / 2026-2027 / 2027-2028)
6. **Reports** — real PDF (reportlab) + real Excel (.xlsx via openpyxl); FY + school + status + date range filters
7. **WhatsApp** wa.me deep link reminders
8. **Skeleton loaders** on Dashboard + Pending screens

## Date / Currency
- All dates stored as ISO datetime; displayed as `DD/MM/YYYY HH:mm`
- Currency Indian INR (₹) with Indian grouping

## Roadmap (Phase 2)
- RBAC: Admin / Author (max 3) / Guest (unlimited) + page-permission matrix
- User Management screen
- Firebase Storage cloud archive (credentials needed)
- Custom logo
