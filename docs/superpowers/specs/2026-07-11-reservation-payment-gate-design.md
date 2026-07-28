# Reservation payment gate (manual) + admin calendar

**Date:** 2026-07-11
**Status:** Approved (brainstorm) — Phase 1 spec

## Goal

Insert a **payment step between admin approval and QR release**. Today: guest
submits → admin taps Confirm → QR emailed immediately. New: guest submits →
admin **Approves** and provides a **payment link + amount** → client is emailed a
payment request (no QR) → once payment is received, admin taps **Mark Paid &
Release** → QR is emailed and the reservation is confirmed. Confirmed
reservations are then visible in an in-app admin calendar (Phase 2).

Chosen (brainstorm): **manual** flow (no Paymob dependency — admin pastes any
payment link + amount and manually marks paid). Delivery to client = **email**.
When live Paymob credentials exist later, this same state machine upgrades to
auto-generate the link and auto-detect payment via the existing
`api/paymob-webhook.js` with no state rework.

## State machine

```
pending ──approve (collect link+amount)──▶ awaiting_payment ──mark paid──▶ confirmed ──(check-in)──▶ arrived
   └── decline ──▶ declined                    └── cancel ──▶ cancelled
```

- New status: **`awaiting_payment`** added to the `reservation_status` enum.
- QR is released ONLY on the `awaiting_payment → confirmed` transition (the
  existing `sendReservationConfirmationEmail`). `pending` and `awaiting_payment`
  never expose the QR.
- Decline (pending) keeps the existing reason-picker flow.

## Data model (migration + schema.sql mirror)

- `reservation_status` enum: add value `awaiting_payment`.
- `reservations`:
  - add `payment_amount numeric(10,2)` (EGP).
  - reuse existing `paymob_link text` for the pasted payment link (comment
    already says "sent after approval"); reuse `paymob_paid boolean` (set true on
    mark-paid) and `confirmed_at`.
  - add `payment_requested_at timestamptz` (when the payment email went out).
- New table `telegram_prompts` (serverless-safe conversational state — the bot
  has no memory between invocations):
  - `id uuid pk default gen_random_uuid()`
  - `chat_id bigint not null`
  - `prompt_message_id bigint not null`  (the bot's force_reply message id)
  - `reservation_id uuid not null references reservations(id)`
  - `kind text not null`  (e.g. `'await_payment_input'`)
  - `created_at timestamptz default now()`
  - `consumed_at timestamptz`
  - unique index on `(chat_id, prompt_message_id)`.

## Telegram flow (`api/telegram-webhook.js`)

Relabel the reservation-alert buttons in `api/reservation.js`: `✅ Confirm` →
**`✅ Approve`** (keep `callback_data = confirm:<uuid>` to limit churn), decline
stays.

1. **Approve — `confirm:<uuid>`** (behavior CHANGES): if reservation is
   `pending`, the bot does NOT confirm/email. Instead it sends a **`force_reply`**
   prompt: *"Reservation approved. Reply to this message with the payment link
   and amount in EGP — e.g. `https://pay.link/abc 500`."* It records a
   `telegram_prompts` row `(chat_id, prompt_message_id, reservation_id,
   kind='await_payment_input')`, edits the original alert to "✅ Approved —
   awaiting payment details", and answers the callback. Status stays `pending`
   until the reply arrives (guards against a half-approved state).

2. **Payment-details reply** (new `update.message` handler): when a message has
   `reply_to_message` and a matching un-consumed `telegram_prompts` row for
   `(chat_id, reply_to_message.message_id)`:
   - Parse the text into `{ link, amount }`. Rule: extract the first
     `https?://…` token as the link and the first positive number as the amount.
     On invalid input (missing URL or non-positive amount), reply with a short
     error and DON'T consume the prompt (let them retry).
   - Atomic guard `.eq('id',id).eq('status','pending')`: set
     `status='awaiting_payment'`, `paymob_link=link`, `payment_amount=amount`,
     `payment_requested_at=now()`. If it didn't win (already moved), stop.
   - Send **`sendPaymentRequestEmail`** to the client.
   - Mark the prompt row `consumed_at`.
   - Reply in Telegram with a message carrying two inline buttons:
     **`✅ Mark Paid & Release` → `paid:<uuid>`** and **`❌ Cancel` → `cancel:<uuid>`**,
     text: *"💳 Payment request sent to <email> — EGP <amount>. Tap Mark Paid &
     Release once payment is received."*

3. **Mark Paid & Release — `paid:<uuid>`** (new callback): if reservation is
   `awaiting_payment`, atomic `.eq('status','awaiting_payment')` update →
   `status='confirmed'`, `paymob_paid=true`, `confirmed_at=now()`. If it won and
   `checkin_token` present → `sendReservationConfirmationEmail` (releases the QR).
   Edit message → "✅ PAID & CONFIRMED — QR ticket emailed." Answer callback.
   (Email failure is swallowed; webhook always 200.)

4. **Cancel — `cancel:<uuid>`** (new callback): from `awaiting_payment` →
   `status='cancelled'`, `cancelled_at=now()`. Edit message → "❌ Cancelled." No
   email. (Only allowed from `awaiting_payment`.)

5. Existing `reject:` / `rej:<uuid>:<reason>` decline flow (from `pending`)
   unchanged.

All handlers keep the existing pattern: atomic status guards, answer the
callback before the email, always return 200.

## Emails (`api/email.js`)

- New **`sendPaymentRequestEmail({ customer_name, customer_email, type,
  res_date, res_time, party_size, sunbeds, amount, payment_link })`**: branded
  (Mazi logo, same style as the confirmation email), shows the reservation
  summary + **amount (EGP)** + a prominent **"Pay now"** button linking to
  `payment_link`. Copy: reservation approved, complete payment to secure the
  booking; the QR check-in ticket is emailed once payment is confirmed. Fails
  safe (returns null, never throws), like the other emails.
- `sendReservationConfirmationEmail` unchanged (fires on mark-paid → confirmed).

## Guest ticket page (`/r/:token`)

- `api/reservation-ticket.js`: add `payment_amount` and `paymob_link` to the
  select + JSON response (alongside the existing `status`).
- `ReservationTicket.tsx`: add an **`awaiting_payment`** branch — a "Payment
  pending" screen (Mazi logo, booking details, amount, a **Pay now** button to
  `paymob_link` when present) and NO QR. QR stays gated to `confirmed`/`arrived`.

## Admin panel (`ReservationsTab.tsx` + `api/admin.js`) — parity, no bypass

To avoid a payment-bypass path, the admin panel mirrors the Telegram flow:
- Show the `awaiting_payment` status badge + `payment_amount` on the row.
- Pending row: replace direct "Confirm" with **"Approve"** → opens a small dialog
  to enter payment link + amount → calls `admin.js` action
  `approve_reservation` → sets `awaiting_payment` + `sendPaymentRequestEmail`.
- `awaiting_payment` row: **"Mark Paid & Release"** button → `admin.js` action
  `mark_paid_reservation` → atomic `awaiting_payment→confirmed` +
  `sendReservationConfirmationEmail`. Plus a "Cancel" action.
- `api/admin.js`: add `approve_reservation` (id, payment_link, amount →
  awaiting_payment + email) and `mark_paid_reservation` (id → confirmed + QR
  email); keep the existing atomic-guard + swallow-email-failure patterns. The
  old direct `update_reservation status=confirmed` path is removed for the
  pending→confirmed jump (kept for decline/cancel/other transitions).

## Out of scope (Phase 1)

- Paymob auto-generation / auto-detection (revisit when live creds exist —
  upgrades this same state machine).
- SMS delivery (Twilio dev-mode).
- Payment link expiry handling / auto-resend.

## Phase 2 (separate spec)

- In-app admin **reservation calendar**: month/day view reading confirmed (and
  optionally awaiting_payment/arrived) reservations from Supabase. Greenfield
  (no existing admin calendar component). Own spec → plan → build.

## Testing

- Unit: payment-details parser (link+amount extraction, invalid inputs).
- E2E (post-deploy, live): submit → Approve in Telegram → reply link+amount →
  confirm the client gets the payment-request email and `/r/…` shows the
  "payment pending" screen (no QR) → tap Mark Paid & Release → confirm status
  flips to `confirmed`, QR confirmation email fires, `/r/…` now shows the QR.
- Backward compat: existing `confirmed`/`arrived`/`declined` rows and the
  QR-on-confirm gating remain correct.
