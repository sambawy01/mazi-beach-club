# Order Capacity & Tracking System — Design Spec

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Decision:** Build custom ("custom brain") on the existing Apps Script + Google Sheets stack. Cal.com was evaluated and rejected because its capacity model counts bookings, not items, and cannot express the dual rule below.

## Problem

The order flow accepts unlimited orders for any time slot. The time picker in `CartDrawer.tsx` shows hardcoded 30-minute slots with no capacity checks, and the chosen time is not saved anywhere — it only appears in the WhatsApp message text. The kitchen gets overloaded when too many orders land in the same window.

## Goals

1. Enforce kitchen capacity: **max 4 orders AND max 6 items per hour** — whichever cap is reached first blocks the hour.
2. Allow over-capacity orders with **per-order admin approval** (rush days / easy menu items are a human judgment call).
3. Give the kitchen a live Google Calendar of upcoming orders.
4. Give customers order status visibility: confirmed → being prepared → out for delivery → delivered.
5. Keep the existing cart UI, Google Sheet CRM, and AdminPanel. No new vendors, no new infrastructure.

## Business rules

| Rule | Value | Where defined |
|---|---|---|
| Max orders per hour | 4 | Settings tab (editable) |
| Max items per hour | 6 | Settings tab (editable) |
| Working hours | 2 PM – 8 PM (`openHour: 14`, `closeHour: 20`) | Settings tab (editable) |
| Slot granularity (customer-facing) | 30 minutes; each pick counts against its parent hour's caps | Fixed |
| Minimum lead time | 30 minutes | Settings tab (editable) |
| Date range | Same-day only | Fixed (for now) |
| Daily ceiling (derived) | 24 orders / 36 items at default caps | — |
| Over-capacity orders | Allowed as "Pending approval"; admin approves or declines per order | Fixed |
| Blackout dates / pause | Admin can close specific dates or pause ordering immediately | Settings tab |

## Architecture

No new infrastructure. The React site (GitHub Pages) calls the existing Google Apps Script backend (`apps-script/admin-api.gs`), which reads/writes the CRM Google Sheet and a Google Calendar.

```
React site (GitHub Pages)
  CartDrawer (picker)  ──getAvailability──▶  Apps Script backend
  CartDrawer (submit)  ──submitOrder──────▶    │  LockService re-check
  /track page          ──getOrderStatus──▶     │
  AdminPanel OrdersTab ──updateOrderStatus▶    ▼
                                          CRM Google Sheet
                                            Orders (+ new columns)
                                            Settings (new tab)
                                          Google Calendar "Bistro Kitchen"
                                          MailApp (confirmation / decline / status emails)
```

### New/changed Apps Script endpoints

- `getAvailability` — counts today's active (non-cancelled, non-declined) orders and items per hour from the Orders sheet; returns each 30-minute slot as `open` or `busy` (over-cap), respecting lead time, working hours, blackout dates, and the pause toggle.
- `submitOrder` (extended) — re-checks capacity inside `LockService` before writing. Open slot → status `Confirmed`. Busy slot → status `Pending approval`. Race loser → rejection response with fresh availability.
- `getOrderStatus` — returns order status + slot for a given tracking token.
- `updateOrderStatus` — admin-authenticated; sets status, triggers notification email and (on first confirmation) the calendar event.

### Data model changes (Orders sheet)

New columns: `delivery_date`, `delivery_slot` (e.g. `14:30`), `item_count`, `tracking_token` (random, unguessable), `status` extended to: `pending_approval`, `confirmed`, `preparing`, `out_for_delivery`, `delivered`, `declined`, `cancelled`.

New **Settings tab**: `maxOrdersPerHour`, `maxItemsPerHour`, `openHour`, `closeHour`, `leadTimeMins`, `blackoutDates`, `paused`.

## Customer-facing behavior

### Time picker (CartDrawer)

- On open, fetches availability. Shows 30-minute times from 2 PM to 8 PM (from Settings).
- Open times: selectable normally.
- Over-cap times: shown as **"Busy — subject to confirmation"**, still selectable.
- Times inside the lead-time window or outside working hours: hidden.
- **ASAP:** auto-finds the earliest open time and shows it for explicit confirmation before submit ("Earliest available: 3:30 PM — confirm?"). ASAP never lands on a busy slot.

### Submission outcomes

- **Open slot:** order confirmed instantly. Confirmation email with slot + tracking link. Calendar event created.
- **Busy slot:** order saved as Pending approval. Customer told "we'll confirm your time shortly"; once the tracking page ships (Phase 2) it shows *Pending confirmation*. No capacity consumed until approved.
- **Race loser** (slot filled between picker load and submit): friendly "that time just filled" message + refreshed picker with the nearest open time pre-selected.

### Tracking page

`bistro-cloud.com/track?token=<tracking_token>` — a status timeline (Pending → Confirmed → Being prepared → Out for delivery → Delivered, or Declined) that polls `getOrderStatus`. The link is included in the confirmation email and in the WhatsApp message text the customer already sends.

## Admin-facing behavior (OrdersTab in AdminPanel)

- Pending orders are flagged prominently with their items visible, with **Approve** / **Decline** buttons.
  - Approve → order confirmed over-cap, calendar event created, confirmation email sent.
  - Decline → decline email listing currently open times; tracking page shows Declined.
- Confirmed orders get status buttons: **Being prepared → Out for delivery → Delivered**, plus **Cancel** for customer-requested cancellations (via WhatsApp/phone). Each tap emails the customer and updates the tracking page. Cancelling frees the slot's capacity.
- Capacity raises for planned rushes: edit the Settings tab (e.g. `maxOrdersPerHour` 4 → 6); the picker reflects it immediately.

**Operational note:** the pending queue needs prompt attention during rush hours — a customer stuck on "pending" will call. If limbo becomes a problem, a future auto-decline-after-X-minutes rule can be added; not built initially.

## Error handling

- **Availability fetch fails:** picker fails open (shows all slots) rather than blocking sales — the submit-time lock check is the real enforcement.
- **Submit write fails:** fall back to current behavior (WhatsApp message still goes out); order flagged for manual slot assignment.
- **Concurrency:** `LockService` serializes capacity re-check + write; exactly one of two racing customers gets the last slot.
- **Tracking token invalid:** tracking page shows a generic "order not found" with WhatsApp contact link.

## Notifications

Channels: **email** (Apps Script `MailApp`) + **tracking page**. Emails sent on: confirmation (with tracking link), decline (with open alternatives), and each status change. The send-notification function is a single module so WhatsApp Business API can be slotted in later without restructuring.

## Phasing

- **Phase 1 — capacity + approval queue (~15–19 hrs):** Settings tab, `getAvailability`, picker rework + ASAP confirm, locked reserve, pending-approval flow with Approve/Decline in OrdersTab, slot persisted to CRM, kitchen calendar, confirmation/decline emails. *The overload problem is solved at the end of this phase.* Until Phase 2 ships, emails omit the tracking link and approval/decline outcomes are communicated by email only.
- **Phase 2 — visibility (~6–8 hrs):** full status buttons (preparing / out for delivery / delivered) and the tracking page.
- **Phase 3 — optional, decide later:** delivery-hour reminder emails, self-service reschedule/cancel links, WhatsApp Business API push, auto-decline timeout for the pending queue.

## Testing

- **Concurrency:** two simultaneous submits for the last slot in an hour — exactly one confirms, the other gets the race-loser flow.
- **Capacity math:** orders cap and items cap each tested as the binding constraint (e.g. 3 orders totaling 6 items blocks the hour; 4 one-item orders blocks the hour).
- **Boundary rules:** lead time, working-hours edges (1:55 PM, 7:45 PM), blackout date, pause toggle.
- **Approval flow:** approve and decline paths end-to-end including emails and tracking page states.
- **Live QA** of picker, submission, and tracking on the deployed site before launch.

## Out of scope (explicitly)

- Future-date ordering (same-day only for now).
- Item-weighted capacity (a lamb tray ≠ a salad) — admin judgment via the approval queue covers this; weights can be added later if needed.
- Per-dish daily caps / inventory-aware availability.
- Online payment processing.
- Cal.com or any third-party scheduling vendor.
