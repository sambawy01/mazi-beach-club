-- Phase 06 — Feedback & reputation.
-- Add lightweight triage fields so staff can work the feedback queue:
--   resolved     — has someone actioned/acknowledged this review?
--   resolved_at  — when it was marked resolved (audit trail)
--   staff_note   — internal note (e.g. "called guest, comped dessert")
alter table feedback add column if not exists resolved    boolean     not null default false;
alter table feedback add column if not exists resolved_at timestamptz;
alter table feedback add column if not exists staff_note  text        default '';

-- Unresolved low ratings are the ones that need attention first.
create index if not exists idx_feedback_unresolved on feedback(resolved, rating);
