# School Bus Fee Manager — PRD

## Purpose
Admin-only mobile app (Expo / FastAPI / MongoDB) to manage students, yearly bus fees, payments, and WhatsApp reminders across multiple schools.

## Auth
- Email + password login (`admin@busfee.com` / `Admin@123` seeded)
- Forgot password = 6-digit OTP emailed via SendGrid (falls back to backend logs in dev)
- JWT (HS256) stored in AsyncStorage

## Core Modules
1. **Schools** — CRUD with address & contact
2. **Students** — registration with parent name, WhatsApp mobile, school, class, yearly fee, admission/due dates
3. **Payments** — record cash / UPI / bank with date and note; auto-computed paid + pending
4. **Dashboard** — KPI cards (schools, students, collected, pending) + school-wise cards
5. **School Detail** — segmented tabs Pending / Partial / Paid
6. **Student Detail** — payment history timeline + Record Payment bottom modal + WhatsApp reminder button
7. **WhatsApp** — `wa.me` deep-link with auto-generated reminder text (₹ INR formatted)
8. **Reports** — by school / status / date range; "View Report" (HTML) and "Export Excel" (CSV → clipboard)
9. **Search & Filters** — name / parent / mobile, status chips, Due Today / Due This Week
10. **Theme** — Light / Dark / System cyclable from dashboard
