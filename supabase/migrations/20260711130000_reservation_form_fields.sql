-- 20260711130000_reservation_form_fields.sql
-- Reservation form enhancement: capture a generic social handle/link and an
-- audit timestamp for when the guest accepted the reservation rules.
-- Beach reservations also start carrying a real party_size (people count);
-- that reuses the existing party_size column so no schema change is needed for it.
-- Existing rows: defaults ('' / null) are fine, no backfill required.

alter table reservations
  add column if not exists social_link       text default '',
  add column if not exists rules_accepted_at timestamptz;
