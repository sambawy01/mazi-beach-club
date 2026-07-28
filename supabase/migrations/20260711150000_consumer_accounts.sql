-- 20260711150000_consumer_accounts.sql
-- Consumer accounts (Supabase Auth, email OTP): a `profiles` table keyed to
-- auth.users, plus a nullable `user_id` link on reservations and orders so a
-- signed-in guest can read their own QR tickets / order history via the anon
-- client. Existing guest rows keep user_id = null and are unaffected.
--
-- ── RLS MODEL (read carefully) ───────────────────────────────────────────────
-- RLS is already ENABLED on reservations and orders (see init/schema.sql). This
-- migration adds user-scoped SELECT policies. It is additive EXCEPT for one
-- deliberate hardening step: it DROPS the pre-existing anon INSERT policies
-- `reservations_public_insert` / `orders_public_insert` (see SECURITY HARDENING
-- below). No other existing policy is touched.
--
--   * SERVICE ROLE bypasses RLS entirely. All writes (reservation/order inserts
--     + admin reads/updates) go through service-role API routes (api/*.js using
--     SUPABASE_SERVICE_ROLE_KEY, e.g. api/reservation.js, api/order.js,
--     api/order-dinein.js, api/admin.js). Those are UNAFFECTED by these policies.
--   * ANON / AUTHENTICATED (the browser Supabase client) can now SELECT only the
--     reservations/orders whose user_id equals the caller's auth.uid() — i.e. a
--     signed-in user sees only their own rows. A signed-out caller (auth.uid()
--     is null) matches nothing via these policies (null = null is not true), so
--     no rows leak. Existing anon behaviour (public insert, orders read-by-token)
--     is left exactly as-is.
--
-- IMPORTANT: we deliberately add NO anon/authenticated INSERT/UPDATE/DELETE
-- policy on reservations/orders here. Writes stay service-role-only; the browser
-- never mutates these tables directly, and user_id is set server-side from the
-- verified JWT (never trusted from the client).

-- ── profiles ─────────────────────────────────────────────────────────────────
-- NOTE: no `email` column here on purpose. auth.users.email (verified via OTP)
-- is the single source of truth for a consumer's email. A client-writable
-- profiles.email would be an unverified shadow that can drift or be spoofed, so
-- callers read the email from the session (auth.users) instead.
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table profiles enable row level security;

-- A user can only see / create / edit their own profile row.
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (user_id = auth.uid());

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert with check (user_id = auth.uid());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep updated_at fresh (reuses the shared trigger fn from init/schema.sql).
do $$ begin
  create trigger trg_profiles_updated
    before update on profiles
    for each row execute function update_updated_at();
exception when duplicate_object then null; end $$;

-- ── link reservations + orders to an account (nullable; guests stay null) ─────
alter table reservations
  add column if not exists user_id uuid references auth.users(id);

alter table orders
  add column if not exists user_id uuid references auth.users(id);

create index if not exists idx_reservations_user_id on reservations(user_id);
create index if not exists idx_orders_user_id on orders(user_id);

-- ── SECURITY HARDENING: drop anon INSERT policies on reservations + orders ────
-- The pre-existing `reservations_public_insert` / `orders_public_insert` policies
-- were `with check (true)`, letting anyone holding the anon key insert arbitrary
-- rows directly — including a spoofed `user_id` — bypassing the server-side API
-- routes (input validation, payment gate, and JWT-derived ownership). The app
-- NEVER inserts these tables via the anon client: all writes go through
-- service-role API routes (api/reservation.js, api/order.js, api/order-dinein.js
-- — all built with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS). Dropping these
-- policies therefore closes the spoofing vector without affecting the app.
-- Writes to these tables are now service-role-only.
drop policy if exists "reservations_public_insert" on reservations;
drop policy if exists "orders_public_insert" on orders;

-- ── user-scoped SELECT on reservations + orders (additive; see RLS MODEL) ─────
-- RLS is already enabled on both tables; these enables are idempotent no-ops
-- kept here so the migration is self-describing.
alter table reservations enable row level security;
alter table orders enable row level security;

drop policy if exists reservations_select_own on reservations;
create policy reservations_select_own on reservations
  for select using (user_id = auth.uid());

drop policy if exists orders_select_own on orders;
create policy orders_select_own on orders
  for select using (user_id = auth.uid());
