import { createClient } from '@supabase/supabase-js';
import { sendReservationConfirmationEmail, sendPaymentRequestEmail, sendOutreachEmail } from './email.js';
import { generateCheckinToken } from './_lib/checkinToken.js';
import { resolveAuth, can, writeAudit } from './_lib/adminAuth.js';
import { hashPassword } from './_lib/staffAuth.js';

// Note: We no longer send status-update emails. The customer gets a single
// confirmation email at order placement with a tracking link and feedback
// link. They use the tracking link to see live status updates.

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Break-glass owner password OR a signed staff token (see _lib/adminAuth).
  const auth = resolveAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action;

  // 'verify' reports the caller's real role — drives the client role-gating.
  if (req.method === 'GET' && action === 'verify') {
    return res.status(200).json({ ok: true, role: auth.role, name: auth.name });
  }

  // Per-action authorization, enforced server-side (not just hidden buttons).
  if (!can(auth.role, action)) {
    return res.status(403).json({ error: 'Your role does not permit this action' });
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
        case 'list_staff': {
          // Never expose pw_salt / pw_hash to the client.
          const { data, error } = await supabase
            .from('staff')
            .select('id, email, name, role, is_active, created_at, last_login_at')
            .order('created_at', { ascending: true });
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        case 'list_audit': {
          const { data, error } = await supabase
            .from('audit_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(300);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        case 'settings': {
          const { data, error } = await supabase.from('settings').select('key, value');
          if (error) return res.status(500).json({ error: error.message });
          const obj = Object.fromEntries((data || []).map(r => [r.key, r.value]));
          return res.status(200).json({ ok: true, data: obj });
        }
        case 'tables': {
          // Floor plan — every table with its live occupancy. A table counts as
          // occupied when it has a dine-in order that isn't yet served/cancelled.
          const [tblRes, ordRes] = await Promise.allSettled([
            supabase.from('tables').select('*').order('zone', { ascending: true }).order('label', { ascending: true }),
            supabase.from('orders').select('table_id, status, order_ref, total, created_at').eq('mode', 'dine_in').limit(2000),
          ]);
          const tables = tblRes.status === 'fulfilled' ? (tblRes.value.data || []) : [];
          const orders = ordRes.status === 'fulfilled' ? (ordRes.value.data || []) : [];
          if (tblRes.status === 'fulfilled' && tblRes.value.error) return res.status(500).json({ error: tblRes.value.error.message });
          const ACTIVE = new Set(['pending_approval', 'confirmed', 'preparing', 'ready']);
          const occupancy = {};
          for (const o of orders) {
            if (!o.table_id || !ACTIVE.has(o.status)) continue;
            const cur = occupancy[o.table_id];
            if (!cur || o.created_at > cur.since) occupancy[o.table_id] = { order_ref: o.order_ref, total: o.total, status: o.status, since: o.created_at };
          }
          const data = tables.map(t => ({ ...t, occupied_by: occupancy[t.id] || null }));
          return res.status(200).json({ ok: true, data });
        }
        case 'feedback': {
          // Reputation queue — newest first, plus rating aggregates for the
          // header. select('*') so it works whether or not the triage migration
          // (resolved / staff_note) has been applied yet.
          const { data, error } = await supabase
            .from('feedback')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
          if (error) return res.status(500).json({ error: error.message });
          const rows = data || [];
          const count = rows.length;
          const avg = count ? rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count : 0;
          const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          rows.forEach(r => { const k = Math.round(Number(r.rating) || 0); if (distribution[k] !== undefined) distribution[k]++; });
          const unresolved = rows.filter(r => !r.resolved && (Number(r.rating) || 0) <= 3).length;
          return res.status(200).json({ ok: true, data: { rows, summary: { count, avg, distribution, unresolved } } });
        }
        case 'customers': {
          // Customer 360 — one row per guest (keyed by lowercased email), built
          // by folding every order and reservation together. Gives lifetime
          // value, visit counts, first/last seen, and channel mix so staff can
          // recognise regulars and VIPs.
          const [ordRes, resvRes, profRes] = await Promise.allSettled([
            supabase.from('orders').select('customer_email, customer_name, customer_phone, total, status, created_at').limit(5000),
            supabase.from('reservations').select('customer_email, customer_name, customer_phone, status, res_date, party_size, created_at').limit(5000),
            supabase.from('profiles').select('email, full_name, phone, created_at').limit(5000),
          ]);
          const orders = ordRes.status === 'fulfilled' ? (ordRes.value.data || []) : [];
          const reservations = resvRes.status === 'fulfilled' ? (resvRes.value.data || []) : [];
          const profiles = profRes.status === 'fulfilled' ? (profRes.value.data || []) : [];

          const map = new Map();
          const norm = (e) => (e && /@/.test(e)) ? String(e).toLowerCase().trim() : null;
          const touch = (email, name, phone, createdAt) => {
            const key = norm(email);
            if (!key) return null;
            let c = map.get(key);
            if (!c) {
              c = { email: key, name: name || '', phone: phone || '', has_account: false,
                    orders: 0, spend: 0, cancelled_orders: 0, reservations: 0, confirmed_reservations: 0,
                    first_seen: createdAt || null, last_seen: createdAt || null, last_order_at: null, last_reservation_at: null };
              map.set(key, c);
            }
            if (name && !c.name) c.name = name;
            if (phone && !c.phone) c.phone = phone;
            if (createdAt) {
              if (!c.first_seen || createdAt < c.first_seen) c.first_seen = createdAt;
              if (!c.last_seen || createdAt > c.last_seen) c.last_seen = createdAt;
            }
            return c;
          };

          for (const o of orders) {
            const c = touch(o.customer_email, o.customer_name, o.customer_phone, o.created_at);
            if (!c) continue;
            if (o.status === 'cancelled' || o.status === 'declined') { c.cancelled_orders++; continue; }
            c.orders++;
            c.spend += Number(o.total) || 0;
            if (!c.last_order_at || o.created_at > c.last_order_at) c.last_order_at = o.created_at;
          }
          for (const r of reservations) {
            const c = touch(r.customer_email, r.customer_name, r.customer_phone, r.created_at);
            if (!c) continue;
            c.reservations++;
            if (r.status === 'confirmed' || r.status === 'completed') c.confirmed_reservations++;
            if (!c.last_reservation_at || r.created_at > c.last_reservation_at) c.last_reservation_at = r.created_at;
          }
          for (const p of profiles) {
            const c = touch(p.email, p.full_name, p.phone, p.created_at);
            if (c) c.has_account = true;
          }

          const customers = [...map.values()].map(c => ({
            ...c,
            visits: c.orders + c.confirmed_reservations,
            last_activity: [c.last_order_at, c.last_reservation_at].filter(Boolean).sort().pop() || c.last_seen,
          })).sort((a, b) => b.spend - a.spend);

          return res.status(200).json({ ok: true, data: customers });
        }
        case 'dashboard': {
          // Command Center snapshot — one round-trip of parallel queries feeding
          // the at-a-glance cards, action queues, and a 14-day revenue sparkline.
          // "Today" is Cairo local (UTC+2, no DST since 2015) so day boundaries
          // match how staff think about the shift, not UTC midnight.
          const CAIRO_OFFSET_MS = 2 * 60 * 60 * 1000;
          const nowMs = Date.now();
          const cairoNow = new Date(nowMs + CAIRO_OFFSET_MS);
          const todayStr = cairoNow.toISOString().split('T')[0];
          const since14 = new Date(nowMs - 13 * 86400000 + CAIRO_OFFSET_MS).toISOString().split('T')[0];

          const [ordRes, resvRes, evRes] = await Promise.allSettled([
            supabase.from('orders').select('id, status, total, created_at, customer_name, order_ref, mode').order('created_at', { ascending: false }).limit(500),
            supabase.from('reservations').select('id, status, res_date, party_size, sunbeds, customer_name, type, created_at').order('created_at', { ascending: false }).limit(500),
            supabase.from('event_bookings').select('id, status, created_at').limit(500),
          ]);
          const orders = ordRes.status === 'fulfilled' ? (ordRes.value.data || []) : [];
          const reservations = resvRes.status === 'fulfilled' ? (resvRes.value.data || []) : [];
          const events = evRes.status === 'fulfilled' ? (evRes.value.data || []) : [];

          const cairoDay = (iso) => iso ? new Date(new Date(iso).getTime() + CAIRO_OFFSET_MS).toISOString().split('T')[0] : null;
          const OPEN_ORDER = new Set(['pending_approval', 'confirmed', 'preparing', 'ready', 'out_for_delivery']);

          const ordersToday = orders.filter(o => cairoDay(o.created_at) === todayStr);
          const revenueToday = ordersToday
            .filter(o => o.status !== 'cancelled' && o.status !== 'declined')
            .reduce((s, o) => s + (Number(o.total) || 0), 0);

          // 14-day revenue sparkline (completed/active orders per Cairo day).
          const revByDay = {};
          for (let i = 0; i < 14; i++) {
            const d = new Date(nowMs - (13 - i) * 86400000 + CAIRO_OFFSET_MS).toISOString().split('T')[0];
            revByDay[d] = 0;
          }
          orders.forEach(o => {
            const d = cairoDay(o.created_at);
            if (d && d >= since14 && o.status !== 'cancelled' && o.status !== 'declined') {
              revByDay[d] = (revByDay[d] || 0) + (Number(o.total) || 0);
            }
          });
          const revenueSpark = Object.keys(revByDay).sort().map(d => ({ date: d, total: revByDay[d] }));

          const reservationsToday = reservations.filter(r => r.res_date === todayStr);
          const coversToday = reservationsToday
            .filter(r => r.status === 'confirmed')
            .reduce((s, r) => s + (Number(r.party_size) || 0), 0);

          // Action queues — the "needs a human" lists, most recent first.
          const pendingReservations = reservations
            .filter(r => r.status === 'pending')
            .slice(0, 8)
            .map(r => ({ id: r.id, name: r.customer_name, type: r.type, date: r.res_date, party: r.party_size, sunbeds: r.sunbeds }));
          const awaitingPayment = reservations.filter(r => r.status === 'awaiting_payment').length;
          const pendingOrders = orders
            .filter(o => o.status === 'pending_approval')
            .slice(0, 8)
            .map(o => ({ id: o.id, ref: o.order_ref, name: o.customer_name, total: o.total, mode: o.mode }));

          return res.status(200).json({
            ok: true,
            data: {
              today: todayStr,
              stats: {
                orders_today: ordersToday.length,
                revenue_today: revenueToday,
                open_orders: orders.filter(o => OPEN_ORDER.has(o.status)).length,
                reservations_today: reservationsToday.length,
                covers_today: coversToday,
                pending_reservations: reservations.filter(r => r.status === 'pending').length,
                awaiting_payment: awaitingPayment,
                pending_events: events.filter(e => e.status === 'pending' || e.status === 'new').length,
              },
              queues: { pendingReservations, pendingOrders },
              revenueSpark,
              statusBreakdown: {
                orders: orders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {}),
                reservations: reservations.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {}),
              },
            },
          });
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
          await writeAudit(supabase, auth, { action: 'create_reservation', target_type: 'reservation', target_id: data.id, summary: `Created ${row.type} reservation for ${name}` });
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
          await writeAudit(supabase, auth, { action: 'send_outreach', target_type: 'outreach', summary: `Sent "${subject}" to ${sent}/${emails.length} recipients` });
          return res.status(200).json({ ok: true, data: { total: emails.length, sent, failed } });
        }
        case 'create_table': {
          const { label, zone, capacity, qr_code } = body;
          if (!label || !zone) return res.status(400).json({ error: 'Label and zone are required' });
          if (!['dining', 'bar', 'daybed'].includes(zone)) return res.status(400).json({ error: 'Invalid zone' });
          const { data, error } = await supabase.from('tables').insert({
            label: String(label).trim(), zone, capacity: parseInt(capacity) || 2, qr_code: qr_code || null,
          }).select('*').single();
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'create_table', target_type: 'table', target_id: data.id, summary: `Added table ${data.label} (${zone})` });
          return res.status(200).json({ ok: true, data });
        }
        case 'update_table': {
          const { id, label, zone, capacity, qr_code, is_active } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          if (zone !== undefined && !['dining', 'bar', 'daybed'].includes(zone)) return res.status(400).json({ error: 'Invalid zone' });
          const updates = {};
          if (label !== undefined) updates.label = String(label).trim();
          if (zone !== undefined) updates.zone = zone;
          if (capacity !== undefined) updates.capacity = parseInt(capacity) || 2;
          if (qr_code !== undefined) updates.qr_code = qr_code || null;
          if (is_active !== undefined) updates.is_active = !!is_active;
          if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });
          const { error } = await supabase.from('tables').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'update_table', target_type: 'table', target_id: id, summary: 'Updated table' });
          return res.status(200).json({ ok: true });
        }
        case 'delete_table': {
          const { id } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const { error } = await supabase.from('tables').delete().eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'delete_table', target_type: 'table', target_id: id, summary: 'Removed table' });
          return res.status(200).json({ ok: true });
        }
        case 'resolve_feedback': {
          const { id, resolved, staff_note } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const updates = {};
          if (resolved !== undefined) {
            updates.resolved = !!resolved;
            updates.resolved_at = resolved ? new Date().toISOString() : null;
          }
          if (staff_note !== undefined) updates.staff_note = String(staff_note);
          if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });
          const { error } = await supabase.from('feedback').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'resolve_feedback', target_type: 'feedback', target_id: id, summary: resolved === false ? 'Reopened feedback' : 'Resolved feedback' });
          return res.status(200).json({ ok: true });
        }
        case 'update_settings': {
          // body.settings = { key: value, ... } — values stored as JSONB verbatim.
          const patch = body.settings || {};
          const keys = Object.keys(patch);
          if (keys.length === 0) return res.status(400).json({ error: 'No settings provided' });
          const now = new Date().toISOString();
          const rows = keys.map(key => ({ key, value: patch[key], updated_at: now }));
          const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'update_settings', target_type: 'settings', summary: `Updated ${keys.join(', ')}`, meta: patch });
          return res.status(200).json({ ok: true });
        }
        case 'create_staff': {
          const { email, name, role, password } = body;
          if (!email || !name || !role || !password) return res.status(400).json({ error: 'Email, name, role and password are required' });
          if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
          const { salt, hash } = hashPassword(password);
          const { data, error } = await supabase.from('staff').insert({
            email: String(email).toLowerCase().trim(), name, role, pw_salt: salt, pw_hash: hash,
          }).select('id, email, name, role, is_active').single();
          if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'A staff member with that email already exists' : error.message });
          await writeAudit(supabase, auth, { action: 'create_staff', target_type: 'staff', target_id: data.id, summary: `Added ${name} (${role})` });
          return res.status(200).json({ ok: true, data });
        }
        case 'update_staff': {
          const { id, name, role, is_active, password } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const updates = { updated_at: new Date().toISOString() };
          if (name !== undefined) updates.name = name;
          if (role !== undefined) updates.role = role;
          if (is_active !== undefined) updates.is_active = !!is_active;
          if (password) {
            if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            const { salt, hash } = hashPassword(password);
            updates.pw_salt = salt; updates.pw_hash = hash;
          }
          const { error } = await supabase.from('staff').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'update_staff', target_type: 'staff', target_id: id, summary: `Updated staff${password ? ' (password reset)' : ''}` });
          return res.status(200).json({ ok: true });
        }
        case 'delete_staff': {
          const { id } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const { error } = await supabase.from('staff').delete().eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          await writeAudit(supabase, auth, { action: 'delete_staff', target_type: 'staff', target_id: id, summary: 'Removed staff member' });
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