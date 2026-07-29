import { createClient } from '@supabase/supabase-js';
import { sendReservationConfirmationEmail, sendPaymentRequestEmail } from './email.js';

// Note: We no longer send status-update emails. The customer gets a single
// confirmation email at order placement with a tracking link and feedback
// link. They use the tracking link to see live status updates.

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || 'mazi2025';

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function checkAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token !== adminPassword) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action;

  // Password verification only depends on checkAuth passing — reaching here
  // means the bearer token matched ADMIN_PASSWORD. No database needed.
  if (req.method === 'GET' && action === 'verify') {
    return res.status(200).json({ ok: true, role: 'admin' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  try {
    // ── GET: list operations ────────────────────────────────────────────
    if (req.method === 'GET') {
      switch (action) {
        case 'orders': {
          const { data, error } = await supabase
            .from('orders')
            .select('*, tables(label)')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          const flat = (data || []).map(({ tables, ...o }) => ({ ...o, table_label: tables?.label ?? null }));
          return res.status(200).json({ ok: true, data: flat });
        }
        case 'reservations': {
          const { data, error } = await supabase
            .from('reservations')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        case 'events': {
          const { data, error } = await supabase
            .from('event_bookings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    // ── PATCH: update operations ────────────────────────────────────────
    if (req.method === 'PATCH' || req.method === 'POST') {
      const body = req.body || {};
      switch (action) {
        case 'update_order': {
          const { id, status } = body;
          if (!id || !status) return res.status(400).json({ error: 'Missing id or status' });
          const updates = { status, updated_at: new Date().toISOString() };
          if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
          if (status === 'delivered') updates.delivered_at = new Date().toISOString();
          if (status === 'served') updates.served_at = new Date().toISOString();
          const { error } = await supabase.from('orders').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });

          // No status-update email — customer tracks via /track?token=...
          return res.status(200).json({ ok: true });
        }
        case 'update_reservation': {
          // NOTE: the pending→confirmed jump (and its QR email) is intentionally
          // NOT handled here anymore — the payment gate requires going through
          // approve_reservation → mark_paid_reservation. This case now only
          // handles declined / cancelled / other plain status transitions
          // (timestamp + update, no email).
          const { id, status } = body;
          if (!id || !status) return res.status(400).json({ error: 'Missing id or status' });
          // Payment-gate: the pending→awaiting_payment→confirmed path is owned
          // exclusively by approve_reservation / mark_paid_reservation. Rejecting
          // these here prevents a row being flipped straight to confirmed with no
          // payment and no QR email (a confirmed-but-no-ticket dead state).
          if (status === 'confirmed' || status === 'awaiting_payment') {
            return res.status(400).json({ error: 'Use approve_reservation / mark_paid_reservation for this transition' });
          }
          const updates = { status, updated_at: new Date().toISOString() };
          if (status === 'declined') updates.declined_at = new Date().toISOString();
          if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();

          const { error } = await supabase.from('reservations').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
        }
        case 'approve_reservation': {
          const { id, payment_link, amount } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          if (typeof payment_link !== 'string' || !/^https?:\/\/\S+/i.test(payment_link.trim())) {
            return res.status(400).json({ error: 'Invalid payment_link' });
          }
          const amt = Number(amount);
          if (!Number.isFinite(amt) || amt <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
          }
          const link = payment_link.trim();
          const now = new Date().toISOString();

          // Atomic pending→awaiting_payment: only the winning update returns a
          // row, so the payment-request email fires exactly once even under
          // concurrent approvals.
          const { data: rows, error } = await supabase
            .from('reservations')
            .update({
              status: 'awaiting_payment',
              paymob_link: link,
              payment_amount: amt,
              payment_requested_at: now,
              updated_at: now,
            })
            .eq('id', id)
            .eq('status', 'pending')
            .select('customer_name, customer_email, type, res_date, res_time, party_size, sunbeds');
          if (error) return res.status(500).json({ error: error.message });

          if (rows && rows.length > 0) {
            try {
              await sendPaymentRequestEmail({ ...rows[0], amount: amt, payment_link: link });
            } catch (e) {
              console.error('payment request email failed:', e);
            }
            return res.status(200).json({ ok: true });
          }
          return res.status(409).json({ ok: false, error: 'Reservation is not pending' });
        }
        case 'mark_paid_reservation': {
          const { id } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const now = new Date().toISOString();

          // Atomic awaiting_payment→confirmed: only the winning update returns a
          // row, so the QR confirmation email is sent exactly once. Skip if the
          // row has no checkin_token, which would email a broken link.
          const { data: rows, error } = await supabase
            .from('reservations')
            .update({
              status: 'confirmed',
              paymob_paid: true,
              confirmed_at: now,
              updated_at: now,
            })
            .eq('id', id)
            .eq('status', 'awaiting_payment')
            .select('customer_name, customer_email, type, res_date, res_time, party_size, sunbeds, checkin_token');
          if (error) return res.status(500).json({ error: error.message });

          if (rows && rows.length > 0) {
            if (rows[0].checkin_token) {
              try { await sendReservationConfirmationEmail(rows[0]); }
              catch (e) { console.error('reservation confirmation email failed:', e); }
            }
            return res.status(200).json({ ok: true });
          }
          return res.status(409).json({ ok: false, error: 'Reservation is not awaiting payment' });
        }
        case 'confirm_reservation': {
          // Direct pending→confirmed with NO payment step. This is the "just
          // confirm" path — used when staff waive the per-person charge. It
          // releases the QR ticket immediately, exactly like mark_paid does,
          // but skips awaiting_payment entirely (no payment link / amount).
          const { id } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const now = new Date().toISOString();

          // Atomic pending→confirmed: only the winning update returns a row, so
          // the QR confirmation email is sent exactly once. Skip the email if
          // the row has no checkin_token (would email a broken link).
          const { data: rows, error } = await supabase
            .from('reservations')
            .update({
              status: 'confirmed',
              confirmed_at: now,
              updated_at: now,
            })
            .eq('id', id)
            .eq('status', 'pending')
            .select('customer_name, customer_email, type, res_date, res_time, party_size, sunbeds, checkin_token');
          if (error) return res.status(500).json({ error: error.message });

          if (rows && rows.length > 0) {
            if (rows[0].checkin_token) {
              try { await sendReservationConfirmationEmail(rows[0]); }
              catch (e) { console.error('reservation confirmation email failed:', e); }
            }
            return res.status(200).json({ ok: true });
          }
          return res.status(409).json({ ok: false, error: 'Reservation is not pending' });
        }
        case 'update_event': {
          const { id, status, quoted_price, paymob_link } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const updates = { updated_at: new Date().toISOString() };
          if (status) updates.status = status;
          if (quoted_price !== undefined) updates.quoted_price = quoted_price;
          if (paymob_link !== undefined) updates.paymob_link = paymob_link;
          const { error } = await supabase.from('event_bookings').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}