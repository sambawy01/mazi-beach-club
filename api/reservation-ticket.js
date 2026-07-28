// api/reservation-ticket.js
import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'Missing token' });
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });

  const { data, error } = await supabase
    .from('reservations')
    .select('customer_name, type, res_date, res_time, party_size, sunbeds, status, arrived_at, table_id, tables(label), payment_amount, paymob_link')
    .eq('checkin_token', token)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Ticket not found' });

  return res.status(200).json({
    name: data.customer_name,
    type: data.type,
    res_date: data.res_date,
    res_time: data.res_time,
    party_size: data.party_size,
    sunbeds: data.sunbeds,
    status: data.status,
    arrived_at: data.arrived_at,
    table_label: data.tables?.label ?? null,
    payment_amount: data.payment_amount,
    payment_link: data.paymob_link,
  });
}
