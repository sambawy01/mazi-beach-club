-- ============================================================================
-- MAZI — verified_phones
-- Backs the dine-in OTP phone gate (api/otp-verify.js writes, api/order-dinein.js
-- reads within a 30-minute TTL). Extracted from the loose migration-mazi-features.sql
-- so it deploys through the standard `supabase db push` pipeline — without it, the
-- dine-in phone gate returns 503 verification_unavailable for every phone order.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── verified_phones ───────────────────────────────────────────────────────
-- Tracks phones that passed OTP verification (30-minute TTL).
create table if not exists verified_phones (
  phone        text primary key,
  verified_at  timestamptz not null default now()
);

-- Auto-expire: delete rows older than 30 minutes.
create or replace function cleanup_verified_phones()
returns void as $$
  delete from verified_phones where verified_at < now() - interval '30 minutes';
$$ language sql;

-- RLS: every consumer (api/order-dinein.js, api/otp-verify.js, api/paymob-intent.js)
-- uses the service_role client, which bypasses RLS. So enable RLS with NO
-- permissive policy for the anon/public role — that fully denies the anon key
-- (which ships in the frontend bundle). Leaving public policies here would let
-- anyone insert a spoofed "verified" phone (bypassing OTP) or read the rolling
-- list of recently-verified customer numbers. The drops also tighten any env
-- where the loose migration-mazi-features.sql already created those public
-- policies. The service_role policy documents the sole intended accessor.
alter table verified_phones enable row level security;

drop policy if exists "verified_phones_public_read" on verified_phones;
drop policy if exists "verified_phones_public_insert" on verified_phones;

drop policy if exists "verified_phones_admin_all" on verified_phones;
create policy "verified_phones_admin_all" on verified_phones
  for all using (auth.role() = 'service_role');
