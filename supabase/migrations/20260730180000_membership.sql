-- Membership applications — same approval lifecycle as reservations
-- (pending → approved / declined), actioned from Telegram + the admin panel,
-- with branded status emails to the applicant.
create table if not exists membership_applications (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  phone           text not null,
  membership_type text default 'individual',   -- individual | couple | family
  notes           text default '',
  social_link     text default '',
  status          text not null default 'pending',   -- pending | approved | declined
  decline_reason  text,
  user_id         uuid,                          -- linked account if applied while signed in
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  approved_at     timestamptz,
  declined_at     timestamptz
);

create index if not exists idx_membership_status  on membership_applications(status);
create index if not exists idx_membership_created  on membership_applications(created_at desc);
create index if not exists idx_membership_email    on membership_applications(lower(email));

-- RLS on; the server uses the service-role key and bypasses it. No public policies.
alter table membership_applications enable row level security;
