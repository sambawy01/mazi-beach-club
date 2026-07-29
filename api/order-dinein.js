import https from 'https';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendOrderConfirmationEmail } from './email.js';
import { getUserIdFromRequest } from './_lib/getUserFromRequest.js';

// ── Supabase client (server-side) ─────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

/**
 * Check whether `phone` was verified within the last 30 minutes.
 * Returns { verified: boolean } on a definitive answer, or { unavailable: true }
 * when the check itself couldn't run (no client, or the query errored). The
 * caller MUST NOT report "unavailable" as phone_not_verified — a fresh OTP can
 * never clear an infra error, so doing so traps the diner in a re-verify loop.
 */
async function checkPhoneVerified(phone) {
  if (!supabase) return { unavailable: true };
  const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
  const { data, error } = await supabase
    .from('verified_phones')
    .select('phone, verified_at')
    .eq('phone', phoneClean)
    .gte('verified_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .maybeSingle();
  if (error) {
    console.error('[DineIn] phone verification check failed:', error.message);
    return { unavailable: true };
  }
  return { verified: !!data };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const {
      tableId,
      items,
      note,
      paymentMethod,
      // The client (src/services/orderService.ts → placeDineInOrder) sends the
      // customer identity as guestName / guestPhone. These are AUTHORITATIVE.
      guestName,
      guestPhone,
      guestEmail,
      // Legacy/alternate spellings, kept only as a fallback so an older client
      // (or a direct API caller) still lands its identity on the row.
      name: legacyName,
      phone: legacyPhone,
      email: legacyEmail,
    } = body;

    // Normalise to trimmed strings; anything non-string becomes ''.
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const customerName = str(guestName) || str(legacyName);
    const customerPhone = str(guestPhone) || str(legacyPhone);
    const customerEmail = str(guestEmail) || str(legacyEmail);

    if (!tableId) {
      return res.status(400).json({ ok: false, error: 'Missing table ID' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items in order' });
    }

    // ── Phone verification gate ──────────────────────────────────────────
    // NOTE: until the guestPhone fix above, `phone` was always undefined here,
    // so this gate never actually ran. It is live now. The dine-in UI forces an
    // OTP (OtpGate → /api/otp-verify) before the menu, and otp-verify stores the
    // phone under the SAME normalisation checkPhoneVerified() applies, so a genuine
    // flow always passes. Anonymous guests send no phone and skip the gate.
    if (customerPhone) {
      const check = await checkPhoneVerified(customerPhone);
      if (check.unavailable) {
        // Couldn't run the check (infra) — distinct from a genuine expiry so the
        // client shows a "contact staff" terminal state, never loops the OTP gate.
        return res.status(503).json({
          ok: false,
          code: 'verification_unavailable',
          error: "We couldn't confirm your phone right now. Please ask a staff member for help.",
        });
      }
      if (!check.verified) {
        return res.status(403).json({
          ok: false,
          code: 'phone_not_verified',
          error: 'Phone number not verified. Please complete OTP verification first.',
        });
      }
    }

    // ── Look up the table ────────────────────────────────────────────────
    let tableLabel = 'Unknown Table';
    let tableZone = 'dining';
    if (supabase) {
      const { data: tableData, error: tableError } = await supabase
        .from('tables')
        .select('label, zone')
        .eq('id', tableId)
        .single();

      if (!tableError && tableData) {
        tableLabel = tableData.label;
        tableZone = tableData.zone;
      }
    }

    // ── Calculate totals (same as delivery: subtotal + 14% VAT + 12% service) ──
    const subtotal = items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
    const vat = Math.round(subtotal * 0.14);
    const service = Math.round(subtotal * 0.12);
    const total = subtotal + vat + service;

    const orderId = `D${Date.now().toString(36).toUpperCase()}`;
    const trackingToken = crypto.randomUUID();

    // Link to the signed-in account when a verified bearer token is present.
    // Guests (no/invalid token) → null. Never read user_id from req.body.
    const userId = await getUserIdFromRequest(req);

    // ── Save to Supabase ──────────────────────────────────────────────────
    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          order_ref: orderId,
          mode: 'dine_in',
          status: 'pending_approval',
          customer_name: customerName || `Table ${tableLabel} guest`,
          customer_phone: customerPhone,
          customer_email: customerEmail,  // dine-in rarely collects one → ''
          table_id: tableId,
          items: items.map(it => ({
            name: it.name,
            price: it.price,
            quantity: it.quantity,
          })),
          subtotal,
          vat_amount: vat,
          service_amount: service,
          total,
          payment_method: paymentMethod || 'cash_on_site',
          tracking_token: trackingToken,
          user_id: userId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Supabase insert error:', error.message);
      } else if (data) {
        dbId = data.id;
      }
    }

    // POS sync (Golden Soft) is handled out-of-band; no push from here.

    // ── Telegram notification ─────────────────────────────────────────────
    const itemList = items.map(it =>
      `  • ${it.quantity}x ${it.name} — EGP ${it.price * it.quantity}`
    ).join('\n');

    const zoneEmoji = tableZone === 'bar' ? '🍸' : tableZone === 'daybed' ? '🏖️' : '🍽️';

    const message = [
      `${zoneEmoji} DINE-IN ORDER — ${orderId}`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `Table: ${tableLabel} (${tableZone})`,
      customerName ? `👤 ${customerName}` : '',
      customerPhone ? `📞 ${customerPhone}` : '',
      ``,
      `Items:`,
      itemList,
      ``,
      `Subtotal: EGP ${subtotal}`,
      `VAT (14%): EGP ${vat}`,
      `Service (12%): EGP ${service}`,
      `Total: EGP ${total}`,
      note ? `📝 Notes: ${note}` : '',
    ].filter(Boolean).join('\n');

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || '1412831908';

    if (botToken) {
      try {
        await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            chat_id: chatId,
            text: message,
          });

          const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${botToken}/sendMessage`,
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
      } catch (tgErr) {
        console.error('Telegram send error:', tgErr);
      }
    }

    // ── Confirmation email ────────────────────────────────────────────────
    // Dine-in doesn't collect an email today (customerEmail is ''), so there is
    // nothing to send. Wire sendOrderConfirmationEmail() here if/when it does.

    return res.status(200).json({
      ok: true,
      status: 'confirmed',
      trackingToken,
      orderId,
      dbId,
      tableLabel,
      total,
      paymentMethod: paymentMethod || 'cash_on_site',
    });
  } catch (err) {
    console.error('Dine-in order API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
}