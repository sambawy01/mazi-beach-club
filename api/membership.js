import https from 'https';
import { createClient } from '@supabase/supabase-js';
import { getUserIdFromRequest } from './_lib/getUserFromRequest.js';

// ── Supabase client (server-side, service role) ───────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fullName, email, phone, membershipType, notes, social } = req.body || {};
    if (!fullName || !email || !phone) {
      return res.status(400).json({ error: 'Please provide your name, email and phone.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(String(email))) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Applying does not require an account, but link to one if signed in.
    const userId = await getUserIdFromRequest(req);

    const appId = `M${Date.now().toString(36).toUpperCase()}`;
    const type = ['individual', 'couple', 'family'].includes(membershipType) ? membershipType : 'individual';

    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('membership_applications')
        .insert({
          full_name: fullName,
          email,
          phone,
          membership_type: type,
          notes: notes || '',
          social_link: (social || '').trim(),
          status: 'pending',
          user_id: userId,
        })
        .select('id')
        .single();
      if (error) console.error('Membership insert error:', error.message);
      else if (data) dbId = data.id;
    } else {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — membership not saved to DB');
    }

    // ── Telegram notification with approve/decline (same pattern as reservations) ──
    const message = [
      `🪪 NEW MEMBERSHIP APPLICATION`,
      `#${appId}`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `👤 ${fullName}`,
      `✉️ ${email}`,
      `📞 ${phone}`,
      `🎟️ Type: ${type}`,
      (social || '').trim() ? `📱 ${(social || '').trim()}` : '📱 Social: — (not provided)',
      notes ? `📝 ${notes}` : '',
      ``,
      `⚠️ Approve or decline below.`,
    ].filter(Boolean).join('\n');

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1412831908';

    if (BOT_TOKEN) {
      try {
        const inlineKeyboard = dbId
          ? [[
              { text: '✅ Approve', callback_data: `mconfirm:${dbId}` },
              { text: '❌ Decline', callback_data: `mreject:${dbId}` },
            ]]
          : null;
        await new Promise((resolve, reject) => {
          const body = { chat_id: CHAT_ID, text: message };
          if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
          const payload = JSON.stringify(body);
          const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          }, (response) => {
            let d = '';
            response.on('data', c => { d += c; });
            response.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
          });
          request.on('error', reject);
          request.write(payload);
          request.end();
        });
      } catch (tgErr) {
        console.error('Membership Telegram send error:', tgErr);
      }
    }

    return res.status(200).json({ success: true, applicationId: appId, dbId });
  } catch (err) {
    console.error('Membership API error:', err);
    return res.status(500).json({ error: 'Failed to submit application' });
  }
}
