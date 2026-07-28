# Mazi QR Reservation Check-In — Design Spec

**Date:** 2026-07-10
**Status:** Approved for planning
**Author:** Brainstormed with owner

## 1. Summary

Add a QR-based reservation check-in flow to the Mazi site. When a guest books at
`/reserve`, they receive a QR "ticket" (on a downloadable on-screen page **and** by
email). On arrival, staff scan the QR with a phone camera in the admin panel, see the
booking, assign a table, and mark the guest as arrived. Staff are notified on Telegram,
and duplicate or invalid scans are rejected.

This is v1. WhatsApp delivery, Wallet passes, auto-opening the ordering page, and a
floor-map view are explicitly out of scope (see §9).

## 2. Goals & non-goals

**Goals**
- Every reservation gets a unique, unguessable QR ticket.
- Guest can view and download the ticket (on-screen page) and receive it by email.
- Staff can scan the QR at the door with a phone camera (no app install).
- On scan: show booking details, assign a table, mark `arrived`, notify Telegram.
- Reject double check-ins and invalid/wrong-day QR codes clearly.

**Non-goals (v1)**
- WhatsApp or Apple/Google Wallet delivery.
- Auto-opening the food-ordering page after check-in.
- Real-time floor map / table-occupancy dashboard.
- Waitlist or no-show automation.

## 3. End-to-end flow

```
Guest books at /reserve
      │
      ▼
POST /api/reservation
  ├─ insert reservation (existing) + generate checkin_token
  └─ send confirmation email (Resend) with QR + /r/<token> link   [NEW]
      │
      ├──► On-screen ticket page  /r/<token>  (QR shown, downloadable PNG, live status)
      └──► Email ticket (same QR + link)
      │
   ── guest arrives ──
      │
      ▼
Staff open /admin/checkin → camera decodes QR → extract token
      │
      ▼
GET /api/reservation-ticket?token=…  (also used by /r page)  → show booking
      │
      ▼
Staff pick a table → POST /api/reservation-checkin { token, tableId }  (admin-authed)
      │
      ├─ validate token + date window + not-already-arrived
      ├─ set status='arrived', arrived_at=now(), table_id=…
      └─ Telegram: "✅ Sarah, party of 4, seated at D12"
      │
      ▼
Scanner shows ✅ / ⚠️ already-arrived / ❌ invalid
```

## 4. Data model changes

Target table: `reservations` (see `supabase/schema.sql:153`). Add columns and one enum
value. Delivered as a new timestamped migration under `supabase/migrations/`.

**New columns on `reservations`:**
| Column | Type | Notes |
|---|---|---|
| `checkin_token` | `text unique` | Unguessable id encoded in the QR (e.g. nanoid `r_a8Kd93mZ`). Backfilled for existing rows. |
| `arrived_at` | `timestamptz` | Null until check-in. |
| `table_id` | `uuid references tables(id)` | Null until assigned at the door. |

**Enum change:** add `'arrived'` to `reservation_status`
(current values: `pending, confirmed, declined, cancelled, completed, no_show` —
`supabase/schema.sql:36`).

```sql
-- migration sketch
alter type reservation_status add value if not exists 'arrived';
alter table reservations
  add column if not exists checkin_token text unique,
  add column if not exists arrived_at   timestamptz,
  add column if not exists table_id     uuid references tables(id);
-- backfill tokens for any existing rows lacking one (app-side or SQL).
```

No new tables. Reuses the existing `tables` table (`schema.sql:93`) that the ordering
QR system already populates (D1–D30, B1–B15, Daybed-1–6).

## 5. Components

### 5.1 Guest ticket page — `/r/:token` (NEW route)
- Public, read-only. React page under `src/app/pages/` (e.g. `ReservationTicket.tsx`),
  registered in `src/app/App.tsx` (outside the `Layout` wrapper, like `/track`).
- Fetches booking via `GET /api/reservation-ticket?token=…`.
- Displays: Mazi branding, guest name, date, time, party size / sunbeds,
  beach-vs-restaurant, and a large QR encoding `https://mazibeach.com/r/<token>`.
- **Download button**: renders the QR (and a simple ticket card) to a canvas and saves
  a PNG client-side — no server round-trip. Library: reuse whatever QR lib the scanner
  needs, or `qrcode` (already a dependency, used by `scripts/generate-qr.cjs`).
- Shows live status: `Confirmed` → `Checked in ✓` (re-fetch on load; no realtime needed).

### 5.2 Booking success screen (existing `Reservation.tsx`)
- After a successful POST, link to `/r/<token>` (and optionally render the QR inline).
  The API response must return `checkin_token`.

### 5.3 Confirmation email (NEW, fills an existing gap)
- Today `Reservation.tsx` promises "we'll send you a confirmation email" but
  `api/reservation.js` sends none. Add it using the existing Resend helper in
  `api/email.js` (dev-mode silently skips when `RESEND_API_KEY` is unset).
- Email contains booking summary, the QR as an embedded image, and the `/r/<token>` link.

### 5.4 Staff scanner — `/admin/checkin` (NEW admin route)
- Mobile-first page under `src/app/pages/admin/`, gated by existing admin auth
  (same login the admin panel uses).
- Opens the camera via `getUserMedia` + a QR-decode lib (`html5-qrcode` or `jsQR`).
  Continuous scan; on decode, parse the token out of the scanned URL.
- **Result card** with three states:
  - ✅ **Valid, not yet arrived** → show details + table picker + "Check in & seat".
  - ⚠️ **Already arrived** → "Checked in at 8:42 PM · table D12." No re-check-in.
  - ❌ **Invalid / wrong day** → clear rejection (token not found, or not today's date).
- **Manual fallback**: "Enter code" text field routes through the same validation, for
  when the camera fails at night on the beach.
- **Table picker**: searchable dropdown of active tables grouped by zone
  (Dining / Bar / Daybed), mirroring the ordering system's zones. Reuse
  `SearchableSelect.tsx` from the admin components.

## 6. API endpoints

All new endpoints are Vercel functions under `api/`, matching existing style
(`export default async function handler(req, res)`, Supabase service-role client,
node18 fetch).

### 6.1 `POST /api/reservation` — MODIFY
- On insert, generate `checkin_token` and include it in the insert
  (`api/reservation.js:48` insert block).
- Return `checkin_token` in the JSON response so the frontend can route to `/r/<token>`.
- After insert, call the new email-send (dev-mode safe).

### 6.2 `GET /api/reservation-ticket?token=…` — NEW (public)
- Look up reservation by `checkin_token`.
- Return only guest-safe fields: `customer_name`, `type`, `res_date`, `res_time`,
  `party_size`, `sunbeds`, `status`, `arrived_at`, and assigned table `label` if any.
- 404 on unknown token. No listing/enumeration endpoint.

### 6.3 `POST /api/reservation-checkin` — NEW (admin-authed)
- Auth: `Authorization: Bearer <ADMIN_PASSWORD>` — same scheme as `api/admin.js:16`
  (`ADMIN_PASSWORD`, default `mazi2025`). Reject with 401 otherwise.
- Body: `{ token, tableId }`.
- Validation order:
  1. Token exists → else `{ state: 'invalid', reason: 'not_found' }`.
  2. `res_date` equals today (venue local day) → else `{ state: 'invalid', reason: 'wrong_day' }`.
  3. Not already `arrived` → else `{ state: 'already', arrived_at, table_label }`.
  4. `tableId` is a valid active table → else 400.
- On success: set `status='arrived'`, `arrived_at=now()`, `table_id=tableId`; fire
  Telegram (reuse the sendTelegram pattern in `api/reservation.js`); return
  `{ state: 'ok', reservation, table_label }`.
- Idempotent: a repeated scan hits step 3 and never double-books.

## 7. Security & validation

- QR encodes the **guest ticket URL** (`/r/<token>`), not a raw DB id. A guest scanning
  their own QR only sees a read-only ticket.
- Only the **admin-authed** `/api/reservation-checkin` can change status. The scanner
  page lives behind admin login and sends the bearer token.
- `checkin_token` is random and unguessable (nanoid), so tickets cannot be enumerated.
- **Date window:** check-in valid only on the reservation's calendar day (venue local
  time). (Decision: single-day window; revisit ± a day later if late arrivals need it.)
- Idempotent check-in; duplicate scans are reported, not reprocessed.

## 8. Prerequisite (step 0 of implementation)

The production Supabase project baked into the deployed bundle
(`mmjjphgzzhdifvkrokxz.supabase.co`) is **dead — DNS returns NXDOMAIN**. The existing
reservations, ordering, tracking, and admin features are therefore non-functional in
production regardless of this feature. Before this feature can go live:
- Connect a working Supabase project (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Run the init schema + the new migration.
- Re-seed `tables` (`scripts/seed-tables.cjs`) and regenerate QR codes if UUIDs change
  (`scripts/generate-qr.cjs`).

Build and local testing can proceed against a fresh Supabase or the code's dev-mode
fallbacks without waiting on production.

## 9. Out of scope (v1)

- WhatsApp ticket delivery (fits the market; candidate for the next iteration).
- Apple/Google Wallet passes.
- Auto-opening the food-ordering page after check-in (table assignment only in v1).
- Floor-map / live table occupancy.
- Waitlist and no-show automation.

## 10. Testing

- **Unit:** `checkin_token` generation; date-window and duplicate/idempotency logic in
  `/api/reservation-checkin`; auth rejection (401) without bearer token.
- **Integration (local, dev-mode safe):** book → response includes `checkin_token` →
  `/r/<token>` renders → ticket endpoint returns safe fields only.
- **Live browser test (`/browse`):** book a reservation → land on ticket page → download
  the QR PNG → open `/admin/checkin` → scan the generated QR → verify `arrived` state,
  table assignment, Telegram payload, and that a second scan is rejected as
  already-arrived.

## 11. Assumptions & open items

- Venue local timezone for the date-window check: assume Africa/Cairo. Confirm during
  implementation.
- QR-decode library choice (`html5-qrcode` vs `jsQR`) decided at implementation time
  based on bundle size and iOS Safari camera behavior.
- Beach reservations assign a Daybed-zone table; restaurant reservations assign a
  Dining/Bar table. Picker shows all active tables; no hard enforcement in v1.
