-- Phase 00 — Staff accounts, roles & audit trail.
-- Adds per-user admin staff (scrypt-hashed passwords) and an append-only audit log.
-- Both are service-role-only (admin API): RLS on with no public policies.

create extension if not exists pgcrypto;

-- ── Staff accounts ────────────────────────────────────────────────────────
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null default 'host',      -- owner | manager | host | chef | accounting
  is_active     boolean not null default true,
  pw_salt       text not null,
  pw_hash       text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists staff_email_idx on staff (lower(email));

alter table staff enable row level security;
-- No policies → only the service role (admin API) can read/write. Passwords
-- never leave the server; the API never SELECTs pw_salt/pw_hash to the client.

-- ── Audit log (append-only) ───────────────────────────────────────────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text,                                 -- staff email, or 'owner (break-glass)'
  actor_role  text,
  action      text not null,                        -- e.g. confirm_reservation, refund_order
  target_type text,                                 -- reservation | order | event | staff | settings | outreach…
  target_id   text,
  summary     text,                                 -- human line for the activity feed
  meta        jsonb,                                -- optional before/after or extra context
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_target_idx  on audit_log (target_type, target_id);

alter table audit_log enable row level security;
-- Service-role only. Rows are never updated or deleted (append-only by convention).
