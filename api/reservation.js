import https from 'https';
import { createClient } from '@supabase/supabase-js';
import { generateCheckinToken } from './_lib/checkinToken.js';
import { getUserIdFromRequest } from './_lib/getUserFromRequest.js';

// ── Supabase client (server-side, uses service role key) ──────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://cdlcovqtltfwqrnpdstn.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      type, name, phone, email, date, time,
      partySize, sunbeds, notes,
      social, rulesAccepted,
    } = req.body;

    if (!name || !phone || !email || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!rulesAccepted) return res.status(400).json({ error: 'Reservation rules must be accepted' });

    const dateObj = new Date(date);
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const typeLabel = type === 'beach' ? '🏖️ Beach (Umbrella + Sunbeds)' : '🍽️ Restaurant';

    // Beach now carries BOTH a people count and a sunbed count; restaurant keeps
    // a single party size line. These become individual lines in the message.
    const sizeLines = type === 'beach'
      ? [
          `👥 People: ${parseInt(partySize) || 0}`,
          `⛱️ Sunbeds: ${parseInt(sunbeds) || 0}`,
        ]
      : [`👥 Party Size: ${parseInt(partySize) || 0}`];

    // Social link is soft-required: staff need to notice when it's missing so
    // they can vet booking eligibility manually.
    const socialValue = (social || '').trim();
    // The form now sends one social link per guest, newline-joined. Store the
    // raw string as-is (DB insert unchanged) but present each guest on its own
    // numbered line in the Telegram notification for readability.
    const socialLinks = socialValue
      ? socialValue.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    const socialLine = socialLinks.length
      ? `📱 Socials:\n${socialLinks.map((link, i) => `• Guest ${i + 1}: ${link}`).join('\n')}`
      : `📱 Social: — (not provided — check eligibility)`;

    const resId = `R${Date.now().toString(36).toUpperCase()}`;
    const checkinToken = generateCheckinToken();

    // Link to the signed-in account when a verified bearer token is present.
    // Never read user_id from req.body.
    const userId = await getUserIdFromRequest(req);
    // Members-only: reservations require a signed-in account (server-side gate,
    // mirrors the client SignInGate so a direct API call can't bypass it).
    if (!userId) return res.status(401).json({ error: 'Please sign in to make a reservation.' });

    // ── Save to Supabase ──────────────────────────────────────────────────
    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('reservations')
        .insert({
          type: type === 'beach' ? 'beach' : 'restaurant',
          status: 'pending',
          customer_name: name,
          customer_phone: phone,
          customer_email: email,
          res_date: date,
          res_time: time,
          party_size: parseInt(partySize) || 0,
          sunbeds: type === 'beach' ? parseInt(sunbeds) || 0 : 0,
          notes: notes || '',
          social_link: socialValue,
          rules_accepted_at: rulesAccepted ? new Date().toISOString() : null,
          checkin_token: checkinToken,
          user_id: userId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Supabase insert error:', error.message);
      } else if (data) {
        dbId = data.id;
      }
    } else {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — reservation not saved to DB');
    }

    // ── Send Telegram notification (keep existing behavior) ───────────────
    // Note: the QR confirmation email is intentionally NOT sent here. The
    // check-in token is stored on the row and the QR email is sent only after
    // an admin confirms the reservation (Telegram bot or admin panel).
    const message = [
      `🌵 NEW RESERVATION REQUEST`,
      `#${resId}`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `📋 Type: ${typeLabel}`,
      `👤 Name: ${name}`,
      `📞 Phone: ${phone}`,
      `✉️ Email: ${email}`,
      `📅 Date: ${dateLabel}`,
      `⏰ Time: ${time}`,
      ...sizeLines,
      socialLine,
      notes ? `📝 Notes: ${notes}` : '',
      ``,
      `⚠️ Tap a button below to action this request.`,
    ].filter(Boolean).join('\n');

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1412831908';

    let telegramResult = { skipped: true, reason: 'no token' };

    if (BOT_TOKEN) {
      try {
        // Telegram limits callback_data to 64 bytes. Carry ONLY the Supabase
        // reservation id (uuid, 36 chars) so the webhook can look the row up.
        // `confirm:<uuid>` / `reject:<uuid>` ≈ 44 bytes — safely under 64.
        // If the DB insert failed (dbId null) we have no id to act on, so we
        // send the notification WITHOUT inline buttons (never invalid button data).
        const inlineKeyboard = dbId
          ? [
              [
                { text: '✅ Approve', callback_data: `confirm:${dbId}` },
                { text: '❌ Cannot Accommodate', callback_data: `reject:${dbId}` },
              ],
            ]
          : null;

        const tgData = await new Promise((resolve, reject) => {
          const messageBody = {
            chat_id: CHAT_ID,
            text: message,
          };
          if (inlineKeyboard) {
            messageBody.reply_markup = { inline_keyboard: inlineKeyboard };
          }
          const payload = JSON.stringify(messageBody);

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

        telegramResult = tgData;

        if (!tgData.ok) {
          console.error('Telegram API error:', tgData);
        }
      } catch (tgErr) {
        console.error('Telegram send error:', tgErr);
        telegramResult = { error: String(tgErr) };
      }
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not set — reservation not sent to Telegram');
    }

    return res.status(200).json({
      success: true,
      reservationId: resId,
      dbId,
    });
  } catch (err) {
    console.error('Reservation API error:', err);
    return res.status(500).json({ error: 'Failed to process reservation' });
  }
}
