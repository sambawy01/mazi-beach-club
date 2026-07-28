# Reservation form: people count, social link, and rules acceptance

**Date:** 2026-07-11
**Status:** Approved (brainstorm)

## Goal

Enrich the public reservation form (`/reserve`) so staff can better vet and
prepare for bookings:

1. Beach reservations capture **number of people** in addition to **number of sunbeds**.
2. Both beach and restaurant capture a **social media link** (soft-required).
3. Guests must **accept reservation rules** (hard gate) before submitting.

## Decisions (from brainstorm)

- **Social field:** one generic free-text input — "Social media (Instagram, TikTok, etc.)".
- **Social requirement:** *soft-required*. The booking still submits if left
  blank (so we don't block regulars/trusted clients), but this is NOT stated in
  the UI. The only visible helper note reads: **"Not including your social media
  profile link(s) may affect your booking eligibility or approval."**
- **Scope:** social field on **both** beach and restaurant.
- **Beach people vs sunbeds:** keep **both** — number of people AND number of sunbeds.
- **Rules card:** shown as a card, **adaptive** to the selected type (common
  rules + only the selected type's rules). A single required checkbox
  ("I have read and agree to the reservation rules") gates submission (hard).
- **Rules content:** as drafted below.

## Reservation rules content

**Common (beach & restaurant):**
1. This is a reservation request. It is confirmed only after we approve it and, where applicable, payment is completed — we'll then email you a confirmation with your QR check-in code.
2. Please arrive on time. Late arrivals may have their reservation released (see hold times).
3. The booking is for the number of guests reserved; significant changes must be arranged in advance and are subject to availability.
4. Cancellations or changes should be made at least 24 hours in advance.
5. Mazi reserves the right of admission; guests follow venue and staff guidance.

**Beach only:**
6. A minimum spend / entry fee may apply (per person or per sunbed) and will be confirmed with your booking.
7. Sunbeds are held 30 minutes past your reserved time, then released.
8. Outside food & drinks are not permitted; sunbed/umbrella placement is assigned by management.
9. No refunds for weather — we'll help reschedule where possible.

**Restaurant only:**
10. Tables are held 30 minutes past your reserved time, then released.
11. Specific seating (indoor/outdoor, particular tables) is subject to availability and not guaranteed.

## Data model (`reservations` table)

- Reuse existing `party_size integer` for the beach people count (was forced to 0 for beach).
- Add `social_link text default ''`.
- Add `rules_accepted_at timestamptz` (audit of acceptance; set on submit).
- New migration under `supabase/migrations/` + mirror in `supabase/schema.sql`.

## Components

### Frontend — `src/app/pages/Reservation.tsx`
- `FormData` gains `social: string`. Add `agreedToRules: boolean` (local state; not
  necessarily part of the posted `form`, but acceptance is signalled to the API).
- **Beach block** renders BOTH a "Number of People" selector (1–8+, same control
  style as restaurant party size) and the existing "Number of Sunbeds" selector.
- **Social input** (both types): label "Social media", helper note exactly:
  "Not including your social media profile link(s) may affect your booking
  eligibility or approval." No hard validation.
- **Rules card** (both types): renders common rules + the selected type's rules,
  followed by a required agree checkbox.
- **Submit gate:** button disabled (and `handleSubmit` guards with a toast) until
  `agreedToRules` is true. Social blank is allowed.
- Success screen and reset logic updated for the new fields.

### Backend — `api/reservation.js`
- Read `social` and, for beach, `partySize` (people) from the body.
- Insert `party_size` for beach as `parseInt(partySize)` (not 0), keep `sunbeds`.
- Insert `social_link` and `rules_accepted_at = now()` (server timestamp when the
  request includes the acceptance flag; reject/ignore if acceptance missing —
  the client already gates, server records the timestamp).
- Add **people count** and **social link** to the Telegram staff notification.

### Admin — `src/app/pages/admin/ReservationsTab.tsx`
- Show the social link and, for beach, the people count (alongside sunbeds) so
  staff can vet eligibility.

## Validation & edge cases

- Social: optional; trimmed; no format enforcement (accept handle or URL).
- Rules: submission blocked client-side until checked; server stamps
  `rules_accepted_at` on insert.
- Beach `party_size`: has a UI default so it's always present.
- Backwards compatibility: new columns are nullable/defaulted; existing rows and
  the QR-checkin flow are unaffected.

## Out of scope

- Automated eligibility decisions from the social link (staff vet manually).
- Social link verification / scraping.
- Changing the confirmation email layout (people/social not added to guest email).
