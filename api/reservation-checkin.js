// api/reservation-checkin.js
import { createClient } from '@supabase/supabase-js';
import { evaluateCheckin } from './_lib/evaluateCheckin.js';
import { resolveAuth } from './_lib/adminAuth.js';

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

function cairoToday() {
  // en-CA yields YYYY-MM-DD; timeZone pins to venue-local calendar day.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function notifyTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('checkin telegram failed:', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!resolveAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });

  const { token: rawToken, tableId } = req.body || {};
  if (!rawToken) return res.status(400).json({ error: 'Missing token' });
  const token = String(rawToken).slice(0, 128);

  const { data: reservation } = await supabase
    .from('reservations')
    .select('id, customer_name, type, res_date, res_time, party_size, sunbeds, status, arrived_at, table_id')
    .eq('checkin_token', token)
    .maybeSingle();

  const decision = evaluateCheckin(reservation, { today: cairoToday(), tableId });
  if (decision.state !== 'ok') return res.status(200).json(decision);

  // Resolve table label for the response + notification.
  const { data: table } = await supabase
    .from('tables').select('label').eq('id', tableId).maybeSingle();
  if (!table) return res.status(400).json({ error: 'Invalid table' });

  const nowIso = new Date().toISOString();
  const { data: updatedRows, error: updErr } = await supabase
    .from('reservations')
    .update({ status: 'arrived', arrived_at: nowIso, table_id: tableId })
    .eq('id', reservation.id)
    .neq('status', 'arrived')
    .select();
  if (updErr) return res.status(500).json({ error: 'Check-in failed' });

  // Zero rows updated means another concurrent scan won the race — already arrived.
  if (!updatedRows || updatedRows.length === 0) {
    const { data: fresh } = await supabase
      .from('reservations')
      .select('arrived_at, table_id')
      .eq('id', reservation.id)
      .maybeSingle();
    return res.status(200).json({
      state: 'already',
      arrived_at: fresh?.arrived_at ?? null,
      table_id: fresh?.table_id ?? null,
    });
  }

  const partyLine = reservation.type === 'beach'
    ? `${reservation.sunbeds} sunbed(s)` : `party of ${reservation.party_size}`;
  await notifyTelegram(`✅ <b>${reservation.customer_name}</b>, ${partyLine}, seated at <b>${table.label}</b>`);

  return res.status(200).json({
    state: 'ok',
    reservation: { ...reservation, status: 'arrived', arrived_at: nowIso, table_id: tableId },
    table_label: table.label,
  });
}
