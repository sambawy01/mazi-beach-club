// api/reservation-qr.js
// Serves a reservation's check-in QR code as a real hosted PNG image.
// Email clients (Gmail et al.) strip inline `data:` URI images, so the
// confirmation email references this endpoint by absolute URL instead.
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const SITE_URL = process.env.SITE_URL || 'https://mazibeach.com';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'Missing token' });
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });

  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('status, checkin_token')
      .eq('checkin_token', token)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Ticket not found' });

    // Gate: only expose a QR for reservations that have earned a check-in
    // ticket. Never leak a QR for pending/awaiting_payment/declined/cancelled.
    if (data.status !== 'confirmed' && data.status !== 'arrived') {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticketUrl = `${SITE_URL}/r/${token}`;
    const png = await QRCode.toBuffer(ticketUrl, { type: 'png', width: 300, margin: 2 });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(png);
  } catch (err) {
    console.error('[reservation-qr] failed:', err.message);
    return res.status(500).json({ error: 'Failed to generate QR' });
  }
}
