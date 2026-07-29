import { createClient } from '@supabase/supabase-js';
import { sendReservationConfirmationEmail, sendPaymentRequestEmail, sendOutreachEmail } from './email.js';
import { generateCheckinToken } from './_lib/checkinToken.js';

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
        case 'contacts': {
          // Distinct customer contacts for outreach — union of reservations,
          // orders, and account profiles, de-duped by email (case-insensitive).
          const results = await Promise.allSettled([
            supabase.from('reservations').select('customer_email, customer_name'),
            supabase.from('orders').select('customer_email, customer_name'),
            supabase.from('profiles').select('email, full_name'),
          ]);
          const map = new Map();
          const add = (email, name) => {
            if (!email || !/@/.test(email)) return;
            const key = String(email).toLowerCase();
            if (!map.has(key)) map.set(key, { email, name: name || '' });
          };
          const [resv, ord, prof] = results;
          if (resv.status === 'fulfilled') (resv.value.data || []).forEach(r => add(r.customer_email, r.customer_name));
          if (ord.status === 'fulfilled') (ord.value.data || []).forEach(o => add(o.customer_email, o.customer_name));
          if (prof.status === 'fulfilled') (prof.value.data || []).forEach(p => add(p.email, p.full_name));
          return res.status(200).json({ ok: true, data: [...map.values()] });
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
        case 'create_reservation': {
          // Admin-created reservation (e.g. a phone booking). Created directly as
          // confirmed with a check-in token; optionally emails the guest.
          const { type, name, phone, email, date, time, partySize, sunbeds, notes, notify } = body;
          if (!name || !date || !time) return res.status(400).json({ error: 'Missing name, date, or time' });
          const isBeach = type === 'beach';
          const now = new Date().toISOString();
          const checkin_token = generateCheckinToken();
          const adminNote = '[created by admin — phone reservation]';
          const row = {
            type: isBeach ? 'beach' : 'restaurant',
            status: 'confirmed',
            customer_name: name,
            customer_phone: phone || '',
            customer_email: email || '',
            res_date: date,
            res_time: time,
            party_size: parseInt(partySize) || 0,
            sunbeds: isBeach ? (parseInt(sunbeds) || 0) : 0,
            notes: notes ? `${notes}\n${adminNote}` : adminNote,
            checkin_token,
            confirmed_at: now,
            rules_accepted_at: now,
          };
          const { data, error } = await supabase.from('reservations').insert(row).select('*').single();
          if (error) return res.status(500).json({ error: error.message });
          if (notify && email) {
            try { await sendReservationConfirmationEmail(data); }
            catch (e) { console.error('admin create_reservation email failed:', e.message); }
          }
          return res.status(200).json({ ok: true, data });
        }
        case 'send_outreach': {
          // Promotional / communication email. recipients = 'all' (every distinct
          // contact) OR an array of emails OR a single email string.
          const { subject, title, body: msgBody, ctaLabel, ctaUrl, imageUrl, recipients } = body;
          if (!subject || !msgBody) return res.status(400).json({ error: 'Missing subject or message' });

          let emails = [];
          if (recipients === 'all') {
            const results = await Promise.allSettled([
              supabase.from('reservations').select('customer_email'),
              supabase.from('orders').select('customer_email'),
              supabase.from('profiles').select('email'),
            ]);
            const set = new Set();
            const push = (e) => { if (e && /@/.test(e)) set.add(String(e).toLowerCase()); };
            const [rv, od, pf] = results;
            if (rv.status === 'fulfilled') (rv.value.data || []).forEach(r => push(r.customer_email));
            if (od.status === 'fulfilled') (od.value.data || []).forEach(o => push(o.customer_email));
            if (pf.status === 'fulfilled') (pf.value.data || []).forEach(p => push(p.email));
            emails = [...set];
          } else if (Array.isArray(recipients)) {
            emails = recipients;
          } else if (typeof recipients === 'string') {
            emails = [recipients];
          }
          emails = [...new Set(emails.filter(e => e && /@/.test(e)).map(e => String(e).trim()))];
          if (emails.length === 0) return res.status(400).json({ error: 'No valid recipients' });

          let sent = 0, failed = 0;
          for (const to of emails) {
            try {
              const id = await sendOutreachEmail(to, { subject, title, body: msgBody, ctaLabel, ctaUrl, imageUrl });
              if (id) sent++; else failed++;
            } catch (e) { failed++; console.error('outreach send failed for', to, e.message); }
          }
          return res.status(200).json({ ok: true, data: { total: emails.length, sent, failed } });
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