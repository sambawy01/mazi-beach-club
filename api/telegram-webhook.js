import https from 'https';
import { createClient } from '@supabase/supabase-js';
import { sendReservationConfirmationEmail, sendPaymentRequestEmail, sendReservationDeclinedEmail, sendMembershipApprovedEmail, sendMembershipDeclinedEmail } from './email.js';
import { parsePaymentReply } from './_lib/parsePaymentReply.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ── Supabase client (server-side, service role) ───────────────────────────
// Serverless-safe: each Telegram button press is a separate function
// invocation, so reservation state MUST live in Supabase, not in memory.
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function tgSendMessage(chatId, text, replyMarkup) {
  return new Promise((resolve, reject) => {
    const body = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const payload = JSON.stringify(body);

    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function tgAnswerCallback(callbackId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      callback_query_id: callbackId,
      text: text || '',
    });

    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function tgEditMessage(chatId, messageId, text, replyMarkup) {
  return new Promise((resolve, reject) => {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const payload = JSON.stringify(body);

    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/editMessageText`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

// Human-readable labels for decline reasons.
const REASON_LABELS = {
  capacity: 'We are at full capacity on this date',
  availability: 'We have no availability for the requested time',
  hours: 'The requested time is outside our operating hours',
  other: 'We are unable to accommodate this reservation',
};

// Format a reservation row (from Supabase) into a Telegram summary block.
function formatReservation(r) {
  const typeLabel = r.type === 'beach' ? '🏖️ Beach' : '🍽️ Restaurant';
  const sizeLabel = r.type === 'beach'
    ? `Sunbeds: ${r.sunbeds}`
    : `Party: ${r.party_size}`;
  return [
    `${typeLabel} — ${r.customer_name}`,
    `📞 ${r.customer_phone}`,
    `📅 ${r.res_date} at ${r.res_time}`,
    `👥 ${sizeLabel}`,
  ].join('\n');
}

// Atomic pending→declined + notify the guest by email. Returns a small status
// object so both the immediate-reason path and the custom-reason reply path can
// render the right Telegram feedback. `reasonText` is the human-facing reason.
async function declineAndEmail(id, reasonText) {
  const { data: r, error: fetchErr } = await supabase
    .from('reservations').select('*').eq('id', id).single();
  if (fetchErr || !r) return { notFound: true };
  if (r.status !== 'pending') return { notPending: true, r };
  const note = [r.notes, `[declined] ${reasonText}`].filter(Boolean).join('\n');
  const { data: rows, error: updErr } = await supabase
    .from('reservations')
    .update({ status: 'declined', declined_at: new Date().toISOString(), notes: note })
    .eq('id', id).eq('status', 'pending').select('id');
  if (updErr) return { dbError: updErr.message, r };
  if (!rows || rows.length === 0) return { raceLost: true, r };
  try { await sendReservationDeclinedEmail(r, reasonText); }
  catch (e) { console.error('decline email failed:', e.message); }
  return { declined: true, r };
}

// Warn only once per cold start that the webhook is running unauthenticated.
let warnedUnauthenticated = false;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'webhook active' });
  }

  // ── Authenticate the webhook (BLOCKING — must run before any read/write) ──
  // Telegram sends the configured secret in this header on every webhook call
  // (setWebhook `secret_token`). The POST handler performs service-role,
  // RLS-bypassing writes to `reservations` keyed only by a non-secret UUID, so
  // an unauthenticated caller could otherwise flip status / inject notes.
  // Rollout posture: if TELEGRAM_WEBHOOK_SECRET is unset we warn and proceed,
  // so legitimate traffic keeps working until the secret is registered with
  // Telegram. Once the secret is set, mismatches are hard-rejected with 401.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  } else if (!warnedUnauthenticated) {
    warnedUnauthenticated = true;
    console.warn('TELEGRAM_WEBHOOK_SECRET is not set — webhook is unauthenticated. Set it and register it with Telegram to secure reservation writes.');
  }

  try {
    const update = req.body;

    // Handle callback query (button press)
    if (update.callback_query) {
      const cb = update.callback_query;
      const callbackId = cb.id;
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const data = cb.data;

      // Parse callback data
      if (data === 'noop') {
        await tgAnswerCallback(callbackId);
        return res.status(200).json({ ok: true });
      }

      // ── Membership approve/decline: mconfirm:<uuid> / mreject:<uuid> ─────
      // Same lifecycle as reservations (pending → approved/declined) with a
      // branded status email. Placed before confirm:/reject: — 'mconfirm:' and
      // 'mreject:' never .startsWith('confirm:'/'reject:'/'rej:'), so no collision.
      if (data.startsWith('mconfirm:') || data.startsWith('mreject:')) {
        const approve = data.startsWith('mconfirm:');
        const id = data.slice(approve ? 9 : 8);
        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }
        const nowIso = new Date().toISOString();
        const patch = approve
          ? { status: 'approved', approved_at: nowIso, updated_at: nowIso }
          : { status: 'declined', declined_at: nowIso, updated_at: nowIso };
        // Atomic pending→approved/declined so the email fires at most once.
        const { data: rows, error: updErr } = await supabase
          .from('membership_applications')
          .update(patch)
          .eq('id', id)
          .eq('status', 'pending')
          .select('full_name, email, phone, membership_type');
        if (updErr) {
          await tgAnswerCallback(callbackId, 'DB update failed');
          return res.status(200).json({ ok: true });
        }
        const won = rows && rows.length > 0 ? rows[0] : null;
        if (!won) {
          await tgAnswerCallback(callbackId, 'Already actioned');
          return res.status(200).json({ ok: true });
        }
        const summary = `👤 ${won.full_name}\n✉️ ${won.email}\n🎟️ ${won.membership_type}`;
        await tgEditMessage(chatId, messageId,
          approve
            ? `✅ MEMBERSHIP APPROVED — welcome email sent.\n\n${summary}`
            : `❌ Membership declined — a polite note was emailed.\n\n${summary}`);
        await tgAnswerCallback(callbackId, approve ? 'Approved' : 'Declined');
        try {
          if (approve) await sendMembershipApprovedEmail(won);
          else await sendMembershipDeclinedEmail(won, '');
        } catch (e) {
          console.error('membership status email failed:', e);
        }
        return res.status(200).json({ ok: true });
      }

      // ── Delivery order status advance: ord:<uuid>:<code> ────────────────
      // Progressive one-tap status machine for delivery orders (from api/order.js).
      // Flow: pending_approval → confirmed → preparing → out_for_delivery → delivered.
      // Placed near the top; `'ord:...'.startsWith('confirm:')` is false, so it
      // never collides with the reservation confirm:/cancel:/reject:/paid:/rej:
      // branches below. callback_data = "ord:" (4) + uuid (36) + ":" (1) + code
      // (≤4) ≈ 45 bytes, well under Telegram's 64-byte limit.
      if (data.startsWith('ord:')) {
        const rest = data.slice(4);        // "<uuid>:<code>"
        const sep = rest.indexOf(':');
        const id = rest.slice(0, sep);
        const code = rest.slice(sep + 1);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        // Transition map: code → { from, to, tsCol }. Drives the atomic CAS only;
        // the footer label + next button are sourced from ORDER_STATUS_CONTROL below.
        const ORDER_FLOW = {
          conf: { from: 'pending_approval', to: 'confirmed', tsCol: 'confirmed_at' },
          prep: { from: 'confirmed', to: 'preparing', tsCol: null },
          ofd: { from: 'preparing', to: 'out_for_delivery', tsCol: null },
          deld: { from: 'out_for_delivery', to: 'delivered', tsCol: 'delivered_at' },
        };

        // Current status → { label, next: { text, code } | null } (delivery flow).
        // Single source of truth for BOTH paths, so a message always reflects the
        // order's CURRENT status. `next` is null for the terminal step (no button).
        const ORDER_STATUS_CONTROL = {
          pending_approval:  { label: 'Pending',          next: { text: '✅ Confirm order',     code: 'conf' } },
          confirmed:         { label: 'Confirmed',        next: { text: '👨‍🍳 Start Preparing', code: 'prep' } },
          preparing:         { label: 'Preparing',        next: { text: '🛵 Out for Delivery',  code: 'ofd'  } },
          out_for_delivery:  { label: 'Out for Delivery', next: { text: '📦 Mark Delivered',    code: 'deld' } },
          delivered:         { label: 'Delivered',        next: null },
        };

        // Inline keyboard for an order's CURRENT status. undefined = no button
        // (terminal 'delivered', or an unknown status we don't control).
        function orderControlMarkup(id, status) {
          const c = ORDER_STATUS_CONTROL[status];
          return c && c.next ? { inline_keyboard: [[{ text: c.next.text, callback_data: `ord:${id}:${c.next.code}` }]] } : undefined;
        }

        const step = ORDER_FLOW[code];
        if (!step) {
          await tgAnswerCallback(callbackId, 'Unknown action');
          return res.status(200).json({ ok: true });
        }

        // Atomic, idempotent transition. The `.eq('status', step.from)` makes the
        // flip conditional inside the DB: it changes a row ONLY when the order is
        // still in the expected `from` state. This is what closes the double-tap /
        // out-of-order / stale-button race — a second (or racing) press for the
        // same code finds the row already in `to`, matches zero rows, and reports
        // "already advanced" instead of re-writing timestamps or skipping steps.
        // The `.eq('mode', 'delivery')` guard scopes this machine to delivery
        // orders only: a forged `ord:<dine-in-uuid>:…` can never advance a dine-in
        // row (it matches zero rows and falls to the self-heal branch).
        const now = new Date().toISOString();
        const updates = { status: step.to, updated_at: now };
        if (step.tsCol) updates[step.tsCol] = now;

        const { data: rows, error } = await supabase
          .from('orders')
          .update(updates)
          .eq('id', id)
          .eq('status', step.from)
          .eq('mode', 'delivery')
          .select('id, order_ref');

        if (error) {
          console.error('Supabase order status update error:', error.message);
          await tgAnswerCallback(callbackId, 'DB update failed');
          return res.status(200).json({ ok: true });
        }

        if (rows && rows.length > 0) {
          // Won the transition. Render footer label + next button from the shared
          // control map keyed by the NEW status (step.to). Preserve the original
          // order details and swap only the status footer line, so the full order
          // block stays visible.
          const row = rows[0];
          const control = ORDER_STATUS_CONTROL[step.to];
          const label = control ? control.label : step.to;
          const baseText = (cb.message.text || '').split('\n\n🔄 ')[0];
          const newText = baseText + '\n\n🔄 Status: ' + label;

          // tgEditMessage / tgAnswerCallback resolve (never reject) on API errors,
          // so neither can block the always-return-200 posture.
          await tgEditMessage(chatId, messageId, newText, orderControlMarkup(id, step.to));
          await tgAnswerCallback(callbackId, row.order_ref ? `${label} · ${row.order_ref}` : label);
        } else {
          // Lost the CAS: the row wasn't in the expected `from` state (double-tap,
          // out-of-order, or a message whose button desynced from the DB after a
          // failed edit — the DB advanced but the message kept the old button).
          // Fetch the CURRENT status + mode; if it's a known delivery status,
          // REPAINT the message from the shared control map so a stale button
          // self-heals to the correct next button (or none if already delivered).
          // The repaint is best-effort — tgEditMessage never throws — so this
          // branch always returns 200. If the order isn't found or isn't a
          // delivery order, keep the answer-only behavior (no edit).
          const { data: cur } = await supabase
            .from('orders')
            .select('status, mode')
            .eq('id', id)
            .single();

          if (cur && cur.mode === 'delivery' && ORDER_STATUS_CONTROL[cur.status]) {
            const baseText = (cb.message.text || '').split('\n\n🔄 ')[0];
            const newText = baseText + '\n\n🔄 Status: ' + ORDER_STATUS_CONTROL[cur.status].label;
            await tgEditMessage(chatId, messageId, newText, orderControlMarkup(id, cur.status));
          }
          await tgAnswerCallback(callbackId, cur ? `Already ${cur.status}` : 'No longer in that state');
        }
        return res.status(200).json({ ok: true });
      }

      // ── Reason selected: rej:<uuid>:<reason> ────────────────────────────
      // Checked BEFORE `confirm:` / `reject:`. Note `'reject:'.startsWith('rej:')`
      // is false (the 4th char of "reject:" is 'e', not ':'), so `rej:` and
      // `reject:` never double-match — order here is purely for clarity.
      // callback_data ≈ "rej:" (4) + uuid (36) + ":" (1) + reason (≤12) ≈ 53 ≤ 64.
      if (data.startsWith('rej:')) {
        const rest = data.slice(4);          // "<uuid>:<reason>"
        const sep = rest.indexOf(':');
        const id = sep === -1 ? rest : rest.slice(0, sep);
        const reason = sep === -1 ? 'other' : rest.slice(sep + 1);
        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        // "Other Reason" → optionally type a custom reason for the guest's email.
        // Send a force_reply prompt; the reply (text, or "skip") is matched back
        // in the update.message handler below and drives the decline.
        if (reason === 'other') {
          const sent = await tgSendMessage(chatId,
            '✍️ Reply with a decline reason to include in the guest\'s email — or reply "skip" to decline without one.',
            { force_reply: true });
          const promptMessageId = sent && sent.result && sent.result.message_id;
          if (!promptMessageId) {
            await tgAnswerCallback(callbackId, 'Could not start — try again');
            return res.status(200).json({ ok: true });
          }
          await supabase.from('telegram_prompts').delete()
            .eq('reservation_id', id).eq('kind', 'await_decline_reason').is('consumed_at', null);
          await supabase.from('telegram_prompts').insert({
            chat_id: chatId, prompt_message_id: promptMessageId, reservation_id: id, kind: 'await_decline_reason',
          });
          await tgEditMessage(chatId, messageId, `📝 Awaiting a decline reason — reply to the prompt (or "skip").`);
          await tgAnswerCallback(callbackId, 'Type a reason or "skip"');
          return res.status(200).json({ ok: true });
        }

        // Fixed reasons decline immediately + email the guest their status.
        const reasonLabel = REASON_LABELS[reason] || REASON_LABELS.other;
        const result = await declineAndEmail(id, reasonLabel);
        if (result.notFound) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
        } else if (result.dbError) {
          console.error('Supabase decline update error:', result.dbError);
          await tgAnswerCallback(callbackId, 'DB update failed');
        } else if (result.declined) {
          await tgEditMessage(chatId, messageId,
            `❌ RESERVATION DECLINED — guest notified.\n\n${formatReservation(result.r)}\n\nReason: ${reasonLabel}`);
          await tgAnswerCallback(callbackId, 'Declined & emailed');
        } else {
          await tgEditMessage(chatId, messageId,
            `ℹ️ No longer pending — not declined.\n\n${formatReservation(result.r)}`);
          await tgAnswerCallback(callbackId, 'No longer pending');
        }
        return res.status(200).json({ ok: true });
      }

      // ── Approve flow: confirm:<uuid> → choose how to confirm ────────────
      // Approving no longer commits to a single path. It presents two options:
      //   💳 Request Payment  → reqpay:<uuid> (force_reply for link + amount)
      //   ✅ Confirm (no pay) → confnp:<uuid> (direct pending→confirmed + QR)
      // The row stays `pending` while the menu is shown, so no half-state is
      // created and either branch (or Decline) can still act on it.
      if (data.startsWith('confirm:')) {
        const id = data.slice(8);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const { data: r, error: fetchErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !r) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
          return res.status(200).json({ ok: true });
        }

        // Idempotency: only a pending reservation may be approved. Guards
        // against stale buttons on old Telegram messages re-triggering it.
        if (r.status !== 'pending') {
          await tgAnswerCallback(callbackId, `Already ${r.status}`);
          return res.status(200).json({ ok: true });
        }

        const choiceControls = {
          inline_keyboard: [
            [{ text: '💳 Request Payment', callback_data: `reqpay:${id}` }],
            [{ text: '✅ Confirm — no payment', callback_data: `confnp:${id}` }],
            [{ text: '❌ Decline', callback_data: `reject:${id}` }],
          ],
        };
        await tgEditMessage(chatId, messageId,
          `Approve this reservation — choose how:\n\n${formatReservation(r)}`,
          choiceControls
        );
        await tgAnswerCallback(callbackId, 'Choose payment option');
        return res.status(200).json({ ok: true });
      }

      // ── Request Payment: reqpay:<uuid> ──────────────────────────────────
      // Asks the admin (via force_reply) for the payment link + amount. The
      // reservation stays `pending` until that reply arrives (see the
      // `update.message` payment-details handler), guarding against a
      // half-approved state. QR release happens on the later `paid:` step.
      if (data.startsWith('reqpay:')) {
        const id = data.slice(7);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const { data: r, error: fetchErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !r) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
          return res.status(200).json({ ok: true });
        }

        // Idempotency: only a pending reservation may enter the payment flow.
        if (r.status !== 'pending') {
          await tgAnswerCallback(callbackId, `Already ${r.status}`);
          return res.status(200).json({ ok: true });
        }

        // Send a force_reply prompt and capture the prompt message id so the
        // admin's reply can be matched back to THIS reservation. The bot has no
        // memory between invocations, so this mapping lives in `telegram_prompts`.
        const promptText =
          'Reply to this message with the payment link and amount in EGP — e.g. `https://pay.link/abc 500`.';
        const sent = await tgSendMessage(chatId, promptText, { force_reply: true });
        const promptMessageId = sent && sent.result && sent.result.message_id;

        if (!promptMessageId) {
          console.error('Approve: could not obtain prompt message id', sent);
          await tgAnswerCallback(callbackId, 'Could not start approval — try again');
          return res.status(200).json({ ok: true });
        }

        // De-dupe: a double-tap would otherwise leave two live force_reply
        // prompts for the same reservation, either of which could fire the
        // payment email. Drop any prior un-consumed prompt before inserting the
        // fresh one. Best-effort — a failure here must not block approval.
        await supabase
          .from('telegram_prompts')
          .delete()
          .eq('reservation_id', id)
          .eq('kind', 'await_payment_input')
          .is('consumed_at', null);

        const { error: promptErr } = await supabase
          .from('telegram_prompts')
          .insert({
            chat_id: chatId,
            prompt_message_id: promptMessageId,
            reservation_id: id,
            kind: 'await_payment_input',
          });

        if (promptErr) {
          console.error('Supabase telegram_prompts insert error:', promptErr.message);
          await tgAnswerCallback(callbackId, 'DB error — try again');
          return res.status(200).json({ ok: true });
        }

        // Keep a single ❌ Decline button on the edited alert so a reservation
        // that's approved-but-never-replied-to can still be declined from
        // Telegram. It's still `pending`, so the guarded decline in the rej:
        // handler works; a stale tap after it moves to awaiting_payment simply
        // hits the 0-row guard and reports "no longer pending".
        const approvedControls = {
          inline_keyboard: [
            [{ text: '❌ Decline', callback_data: `reject:${id}` }],
          ],
        };
        await tgEditMessage(chatId, messageId,
          `✅ Approved — awaiting payment details\n\n${formatReservation(r)}`,
          approvedControls
        );
        await tgAnswerCallback(callbackId, 'Approved — send payment details');
        return res.status(200).json({ ok: true });
      }

      // ── Confirm without payment: confnp:<uuid> ──────────────────────────
      // Direct pending→confirmed with NO payment step. Releases the QR ticket
      // immediately (like paid:), but skips awaiting_payment entirely. Used
      // when staff waive the per-person charge. Idempotent + atomic.
      if (data.startsWith('confnp:')) {
        const id = data.slice(7);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const { data: r, error: fetchErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !r) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
          return res.status(200).json({ ok: true });
        }

        // Idempotency: only a pending reservation may be confirmed here.
        if (r.status !== 'pending') {
          await tgAnswerCallback(callbackId, `Already ${r.status}`);
          return res.status(200).json({ ok: true });
        }

        // Atomic pending→confirmed. The `.eq('status','pending')` makes the flip
        // conditional inside the DB — exactly ONE concurrent press gets a row
        // back, so the QR email fires at most once.
        const { data: confirmedRows, error: updErr } = await supabase
          .from('reservations')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'pending')
          .select('checkin_token, customer_name, customer_email, type, res_date, res_time, party_size, sunbeds');

        if (updErr) {
          console.error('Supabase confirm (no payment) update error:', updErr.message);
          await tgAnswerCallback(callbackId, 'DB update failed');
          return res.status(200).json({ ok: true });
        }

        // Answer Telegram FIRST so the (un-timeout'd) Resend call below can never
        // delay the callback near the function timeout.
        await tgEditMessage(chatId, messageId,
          `✅ CONFIRMED (no payment) — QR ticket emailed.\n\n${formatReservation(r)}`
        );
        await tgAnswerCallback(callbackId, 'Confirmed — no payment');

        // Release the QR ticket — ONLY if this invocation won the atomic
        // transition AND the row carries a checkin_token. Email failure must
        // NEVER break the webhook.
        const won = confirmedRows && confirmedRows.length > 0 ? confirmedRows[0] : null;
        if (won && won.checkin_token) {
          try {
            await sendReservationConfirmationEmail({
              customer_name: won.customer_name,
              customer_email: won.customer_email,
              type: won.type,
              res_date: won.res_date,
              res_time: won.res_time,
              party_size: won.party_size,
              sunbeds: won.sunbeds,
              checkin_token: won.checkin_token,
            });
          } catch (e) {
            console.error('reservation confirmation email failed:', e);
          }
        }

        return res.status(200).json({ ok: true });
      }

      // ── Mark Paid & Release: paid:<uuid> ────────────────────────────────
      // awaiting_payment → confirmed. This is where the QR check-in ticket is
      // released (sendReservationConfirmationEmail). Idempotent + atomic.
      if (data.startsWith('paid:')) {
        const id = data.slice(5);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const { data: r, error: fetchErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !r) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
          return res.status(200).json({ ok: true });
        }

        // Idempotency: only an awaiting_payment reservation may be marked paid.
        if (r.status !== 'awaiting_payment') {
          await tgAnswerCallback(callbackId, `Already ${r.status}`);
          return res.status(200).json({ ok: true });
        }

        // Atomic awaiting_payment→confirmed. The `.eq('status','awaiting_payment')`
        // makes the flip conditional inside the DB — exactly ONE concurrent press
        // gets a row back in `confirmedRows`.
        const { data: confirmedRows, error: updErr } = await supabase
          .from('reservations')
          .update({ status: 'confirmed', paymob_paid: true, confirmed_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'awaiting_payment')
          .select('checkin_token, customer_name, customer_email, type, res_date, res_time, party_size, sunbeds');

        if (updErr) {
          console.error('Supabase mark-paid update error:', updErr.message);
          await tgAnswerCallback(callbackId, 'DB update failed');
          return res.status(200).json({ ok: true });
        }

        // Answer Telegram FIRST so the (un-timeout'd) Resend call below can never
        // delay the callback near the function timeout.
        await tgEditMessage(chatId, messageId,
          `✅ PAID & CONFIRMED — QR ticket emailed.\n\n${formatReservation(r)}`
        );
        await tgAnswerCallback(callbackId, 'Paid & confirmed');

        // Release the QR ticket — ONLY if this invocation won the atomic
        // transition AND the row carries a checkin_token. Email failure must
        // NEVER break the webhook.
        const won = confirmedRows && confirmedRows.length > 0 ? confirmedRows[0] : null;
        if (won && won.checkin_token) {
          try {
            await sendReservationConfirmationEmail({
              customer_name: won.customer_name,
              customer_email: won.customer_email,
              type: won.type,
              res_date: won.res_date,
              res_time: won.res_time,
              party_size: won.party_size,
              sunbeds: won.sunbeds,
              checkin_token: won.checkin_token,
            });
          } catch (e) {
            console.error('reservation confirmation email failed:', e);
          }
        }

        return res.status(200).json({ ok: true });
      }

      // ── Cancel (from awaiting_payment): cancel:<uuid> ───────────────────
      if (data.startsWith('cancel:')) {
        const id = data.slice(7);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const { data: r, error: fetchErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !r) {
          await tgEditMessage(chatId, messageId, `⚠️ Reservation not found (${id}).`);
          await tgAnswerCallback(callbackId, 'Not found');
          return res.status(200).json({ ok: true });
        }

        // Cancel is only allowed from awaiting_payment.
        if (r.status !== 'awaiting_payment') {
          await tgAnswerCallback(callbackId, `Already ${r.status}`);
          return res.status(200).json({ ok: true });
        }

        const { data: cancelledRows, error: updErr } = await supabase
          .from('reservations')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'awaiting_payment')
          .select('id');

        if (updErr) {
          console.error('Supabase cancel update error:', updErr.message);
          await tgAnswerCallback(callbackId, 'DB update failed');
          return res.status(200).json({ ok: true });
        }

        // Only claim "Cancelled" if a row actually flipped (mirrors the paid:
        // won/!won pattern). Otherwise the status moved out from under us.
        if (cancelledRows && cancelledRows.length > 0) {
          await tgEditMessage(chatId, messageId,
            `❌ Cancelled.\n\n${formatReservation(r)}`
          );
          await tgAnswerCallback(callbackId, 'Cancelled');
        } else {
          await tgEditMessage(chatId, messageId,
            `ℹ️ No longer awaiting payment — not cancelled.\n\n${formatReservation(r)}`
          );
          await tgAnswerCallback(callbackId, 'No longer awaiting payment');
        }
        return res.status(200).json({ ok: true });
      }

      // ── Reject flow: reject:<uuid> → show reason buttons ────────────────
      // Each reason button's callback_data stays ≤64 bytes (see rej: handler).
      if (data.startsWith('reject:')) {
        const id = data.slice(7);

        if (!supabase) {
          await tgAnswerCallback(callbackId, 'DB not configured');
          return res.status(200).json({ ok: true });
        }

        const rejectButtons = {
          inline_keyboard: [
            [
              { text: '📦 At Capacity', callback_data: `rej:${id}:capacity` },
              { text: '🗓️ No Availability', callback_data: `rej:${id}:availability` },
            ],
            [
              { text: '🕐 Outside Hours', callback_data: `rej:${id}:hours` },
              { text: '📝 Other Reason', callback_data: `rej:${id}:other` },
            ],
          ],
        };

        await tgEditMessage(chatId, messageId,
          `❌ DECLINING RESERVATION\n\nSelect a reason:`,
          rejectButtons
        );
        await tgAnswerCallback(callbackId, 'Select reason');
        return res.status(200).json({ ok: true });
      }

      await tgAnswerCallback(callbackId);
      return res.status(200).json({ ok: true });
    }

    // Handle regular messages
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';

      // ── Payment-details reply (approval → awaiting_payment) ───────────────
      // Matched BEFORE the /start,/status handling. A force_reply prompt was
      // sent during Approve; when the admin replies to it we look up the
      // matching un-consumed telegram_prompts row and parse the link+amount.
      if (supabase && update.message.reply_to_message) {
        const replyToId = update.message.reply_to_message.message_id;

        // ── Decline-reason reply (from the "Other Reason" force_reply) ──────
        const { data: dPrompt } = await supabase
          .from('telegram_prompts').select('*')
          .eq('chat_id', chatId).eq('prompt_message_id', replyToId)
          .eq('kind', 'await_decline_reason').is('consumed_at', null).maybeSingle();
        if (dPrompt) {
          const raw = (text || '').trim();
          const reasonText = (!raw || /^skip$/i.test(raw)) ? REASON_LABELS.other : raw;
          const result = await declineAndEmail(dPrompt.reservation_id, reasonText);
          await supabase.from('telegram_prompts')
            .update({ consumed_at: new Date().toISOString() })
            .eq('chat_id', chatId).eq('prompt_message_id', replyToId).eq('kind', 'await_decline_reason');
          if (result.declined) {
            await tgSendMessage(chatId, `❌ Declined — guest notified by email.\nReason: ${reasonText}\n\n${formatReservation(result.r)}`);
          } else if (result.notFound) {
            await tgSendMessage(chatId, '⚠️ Reservation not found.');
          } else {
            await tgSendMessage(chatId, 'ℹ️ That reservation is no longer pending — not declined.');
          }
          return res.status(200).json({ ok: true });
        }

        const { data: prompt, error: promptErr } = await supabase
          .from('telegram_prompts')
          .select('*')
          .eq('chat_id', chatId)
          .eq('prompt_message_id', replyToId)
          .eq('kind', 'await_payment_input')
          .is('consumed_at', null)
          .maybeSingle();

        if (!promptErr && prompt) {
          const reservationId = prompt.reservation_id;
          const parsed = parsePaymentReply(text);

          // On invalid input, reply with guidance and DON'T consume the prompt
          // so the admin can simply reply again.
          if (parsed.error) {
            await tgSendMessage(chatId,
              `⚠️ ${parsed.error}\n\nReply to the approval prompt with a link and amount, e.g. \`https://pay.link/abc 500\`.`
            );
            return res.status(200).json({ ok: true });
          }

          const { link, amount } = parsed;

          // Atomic pending→awaiting_payment. The `.eq('status','pending')`
          // makes the flip conditional inside the DB (guards against a stale
          // or duplicate reply).
          const { data: movedRows, error: updErr } = await supabase
            .from('reservations')
            .update({
              status: 'awaiting_payment',
              paymob_link: link,
              payment_amount: amount,
              payment_requested_at: new Date().toISOString(),
            })
            .eq('id', reservationId)
            .eq('status', 'pending')
            .select('customer_name, customer_email, type, res_date, res_time, party_size, sunbeds');

          if (updErr) {
            console.error('Supabase awaiting_payment update error:', updErr.message);
            await tgSendMessage(chatId, '⚠️ Could not save payment details — please try again.');
            return res.status(200).json({ ok: true });
          }

          const won = movedRows && movedRows.length > 0 ? movedRows[0] : null;
          if (!won) {
            // Lost the race / no longer pending. Leave the prompt as-is.
            await tgSendMessage(chatId, 'ℹ️ This reservation is no longer pending — no payment request sent.');
            return res.status(200).json({ ok: true });
          }

          // Send the payment-request email. Failure is swallowed (webhook 200).
          try {
            await sendPaymentRequestEmail({
              customer_name: won.customer_name,
              customer_email: won.customer_email,
              type: won.type,
              res_date: won.res_date,
              res_time: won.res_time,
              party_size: won.party_size,
              sunbeds: won.sunbeds,
              amount,
              payment_link: link,
            });
          } catch (e) {
            console.error('payment request email failed:', e);
          }

          // Consume the prompt so a second reply can't re-fire.
          await supabase
            .from('telegram_prompts')
            .update({ consumed_at: new Date().toISOString() })
            .eq('id', prompt.id);

          const controls = {
            inline_keyboard: [
              [
                { text: '✅ Mark Paid & Release', callback_data: `paid:${reservationId}` },
                { text: '❌ Cancel', callback_data: `cancel:${reservationId}` },
              ],
            ],
          };
          await tgSendMessage(chatId,
            `💳 Payment request sent to ${won.customer_email} — EGP ${amount}. Tap Mark Paid & Release once payment is received.`,
            controls
          );
          return res.status(200).json({ ok: true });
        }
        // No matching prompt — fall through to normal message handling.
      }

      if (text === '/start' || text.toLowerCase().includes('start')) {
        await tgSendMessage(chatId,
          `🏖️ Mazi Reservation Bot\n\nThis bot manages reservation requests from mazibeach.com.\n\nNew reservations will appear here with Confirm/Reject buttons.\n\nCommands:\n/status — Check bot status`
        );
        return res.status(200).json({ ok: true });
      }

      if (text === '/status') {
        await tgSendMessage(chatId,
          `✅ Bot is active.\n📥 Webhook: ${process.env.VERCEL_URL || 'mazibeach.com'}\n🗄️ Database: ${supabase ? 'connected' : 'not configured'}\n🔑 Email service: ${process.env.RESEND_API_KEY ? 'configured' : 'pending'}\n💰 Pricing: ${process.env.MAZI_PRICING ? 'configured' : 'pending'}`
        );
        return res.status(200).json({ ok: true });
      }

      // Unknown message
      await tgSendMessage(chatId, `Received: "${text}"\n\nThis bot handles reservation requests. New reservations from the website will appear here automatically.`);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}