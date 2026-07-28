# Reservation QR Check-In

QR ticket + door check-in for reservations. Guests book at `/reserve`, receive a
downloadable QR ticket (on-screen + email), and staff scan it at the door to mark
arrival and assign a table.

## Guest flow
- Booking (`POST /api/reservation`) returns a `checkinToken` and emails a QR ticket.
- **Ticket page:** `/r/<token>` — public, read-only. Shows booking details, a
  downloadable QR (encodes `https://mazibeach.com/r/<token>`), and live status
  (Confirmed → Checked in ✓).

## Staff flow
- **Scanner:** `/admin/checkin` — admin-gated. Phone camera scans the guest QR (or
  type the code), staff pick a table, then "Check in & seat".
- On success the reservation moves to `status = 'arrived'` with `arrived_at` and the
  assigned `table_id`; a Telegram note is sent. Duplicate scans return "already
  arrived"; wrong-day / unknown tokens are rejected.

## Endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/reservation-ticket?token=` | public | Guest-safe ticket data (no phone/email) |
| `POST /api/reservation-checkin` | `Authorization: Bearer <ADMIN_PASSWORD>` | Mark arrived + assign table (idempotent, Cairo-day window) |

## Data model
`reservations` adds: `checkin_token` (unique), `arrived_at`, `table_id` (FK →
`tables`). Status enum gains `arrived`. Migration:
`supabase/migrations/20260710120000_reservation_checkin.sql`.

## Required environment
- `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — DB (required).
- `ADMIN_PASSWORD` — bearer token the check-in endpoint validates.
- `RESEND_API_KEY`, `MAZI_EMAIL_FROM` — ticket email (dev-mode skips if unset).
- `SITE_URL` — live site origin used to build QR links and ticket URLs in emails (e.g. `https://www.mazibeach.com`). Defaults to `https://mazibeach.com` but **must be set to the actual public origin** or emailed QR codes and ticket links will resolve to the wrong host.
- `TELEGRAM_BOT_TOKEN` (+ chat) — check-in staff notification (optional).

## ⚠️ Deployment caveat — admin auth alignment
The scanner sends the admin-panel login password (`getStoredPassword()`, verified
against the Google Apps Script admin login) as the Bearer token to
`/api/reservation-checkin`, which validates it against the Vercel `ADMIN_PASSWORD`
env var. **These two must hold the same value** or check-in returns 401. The admin
login and the serverless `ADMIN_PASSWORD` are otherwise independent systems; set
`ADMIN_PASSWORD` in Vercel to match the password staff type at `/admin`.
