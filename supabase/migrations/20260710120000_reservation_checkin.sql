-- 20260710120000_reservation_checkin.sql
-- QR reservation check-in: ticket token, arrival timestamp, assigned table.

-- Enum value added in its own statement (Postgres allows ADD VALUE in a
-- transaction on PG12+ as long as the new value is not used in the same tx).
alter type reservation_status add value if not exists 'arrived';

alter table reservations
  add column if not exists checkin_token text,
  add column if not exists arrived_at    timestamptz,
  add column if not exists table_id      uuid references tables(id);

-- Unique index (partial, so re-run is idempotent and nulls don't collide).
create unique index if not exists reservations_checkin_token_key
  on reservations (checkin_token)
  where checkin_token is not null;
