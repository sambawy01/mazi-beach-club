-- 20260711140000_reservation_payment_gate.sql
-- Payment-gate reservation flow: insert an "awaiting_payment" state between admin
-- approval and QR release. Admin approves + provides a payment link/amount, the
-- guest is emailed a payment request (no QR), and only on mark-paid does the
-- reservation move to confirmed and the QR ticket go out.
-- Reuses existing paymob_link / paymob_paid / confirmed_at / cancelled_at columns.

-- Enum value added in its own statement, mirroring the check-in migration's
-- `arrived` add. Postgres allows ADD VALUE on PG12+ as long as the new value is
-- not referenced in the same transaction; keeping it as its own top-level
-- statement (before it is used anywhere) sidesteps the "ALTER TYPE ... ADD VALUE
-- cannot run inside a transaction block" restriction on setups that wrap files
-- in a txn, and IF NOT EXISTS makes re-runs idempotent.
alter type reservation_status add value if not exists 'awaiting_payment';

alter table reservations
  add column if not exists payment_amount       numeric(10,2),   -- payment amount (EGP)
  add column if not exists payment_requested_at timestamptz;     -- when the payment-request email went out

-- ── Telegram prompts ─────────────────────────────────────────────────────────
-- Serverless-safe conversational state for the Telegram bot, which has no memory
-- between invocations. When the bot sends a force_reply prompt (e.g. "reply with
-- the payment link and amount"), it records the prompt's message id here so a
-- later reply can be correlated back to the right reservation.
create table if not exists telegram_prompts (
  id                uuid primary key default gen_random_uuid(),
  chat_id           bigint not null,
  prompt_message_id bigint not null,                                    -- the bot's force_reply message id
  reservation_id    uuid not null references reservations(id) on delete cascade,
  kind              text not null,                                      -- e.g. 'await_payment_input'
  created_at        timestamptz default now(),
  consumed_at       timestamptz
);

create unique index if not exists telegram_prompts_chat_msg_idx
  on telegram_prompts(chat_id, prompt_message_id);
