/**
 * Email service for Mazi — reservation + order emails via Resend.
 * Free tier: 100 emails/day. https://resend.com
 *
 * Env vars (Vercel):
 *   RESEND_API_KEY  = re_...
 *   MAZI_EMAIL_FROM = Mazi <hello@mazibeach.com>   (domain must be verified in Resend)
 *   SITE_URL        = https://mazi-beach-club.vercel.app   (assets + links; flip to
 *                     https://mazibeach.com at go-live once DNS points at Vercel)
 *
 * If RESEND_API_KEY is not set, emails are skipped silently (fail open).
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

// Base URL for hosted assets (logo, QR) AND human-facing links (track, ticket).
// Must point at the deployment that actually serves the app + /public assets.
const SITE_URL = process.env.SITE_URL || 'https://mazi-beach-club.vercel.app';

// ── Brand tokens (email-safe: inline styles, serif stack ≈ the site's display) ──
const INK = '#0e1533';
const COBALT = '#12207e';
const GOLD = '#c9a24a';
const GOLD_LT = '#e3c878';
const CREAM = '#f1ece0';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

/** Prevent user-supplied strings from injecting HTML into email bodies. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cobalt CTA button (primary action). */
function ctaButton(href, label) {
  return `<a href="${href}" style="display:inline-block;background:${COBALT};color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:999px;font-family:${SANS};font-weight:600;font-size:14px;letter-spacing:.06em;text-transform:uppercase;">${label}</a>`;
}

/** Wrap inner content in the branded Mazi frame. */
function brandedShell(inner, preheader = '') {
  const logo = `${SITE_URL}/mazi-logo-full-white.png`;
  return `<div style="background:${CREAM};padding:28px 12px;font-family:${SANS};">
  ${preheader ? `<div style="display:none!important;max-height:0;overflow:hidden;opacity:0;color:${CREAM};">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;border-collapse:separate;">
    <tr><td style="background:${INK};border-radius:18px 18px 0 0;padding:36px 24px 26px;text-align:center;">
      <img src="${logo}" alt="Mazi" width="150" style="width:150px;max-width:58%;height:auto;display:inline-block;margin-bottom:12px;" />
      <div style="color:${GOLD_LT};font-family:${SERIF};font-style:italic;font-size:16px;letter-spacing:.4px;">— together by the sea —</div>
    </td></tr>
    <tr><td style="height:3px;line-height:3px;font-size:0;background:${GOLD};">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:34px 30px;color:#2a2f45;">
      ${inner}
    </td></tr>
    <tr><td style="background:${INK};border-radius:0 0 18px 18px;padding:24px;text-align:center;">
      <div style="color:${GOLD};font-family:${SERIF};font-size:16px;letter-spacing:4px;">M A Z I</div>
      <div style="color:#8b96c0;font-size:12px;margin-top:8px;">Mediterranean Beach Club &middot; Ras El Hekma, North Coast</div>
      <div style="color:#8b96c0;font-size:12px;margin-top:3px;"><a href="mailto:hello@mazibeach.com" style="color:${GOLD_LT};text-decoration:none;">hello@mazibeach.com</a></div>
    </td></tr>
  </table>
  <div style="text-align:center;color:#b3ab98;font-family:${SERIF};font-style:italic;font-size:13px;margin-top:16px;">kali orexi — enjoy</div>
</div>`;
}

/** Small caps gold eyebrow above a heading. */
function eyebrow(text) {
  return `<div style="text-align:center;color:${GOLD};font-size:11px;letter-spacing:.28em;text-transform:uppercase;font-weight:600;margin-bottom:6px;">${text}</div>`;
}
function heading(text) {
  return `<h1 style="text-align:center;font-family:${SERIF};color:${COBALT};font-size:28px;font-weight:600;margin:0 0 6px;line-height:1.15;">${text}</h1>`;
}
function goldRule() {
  return `<div style="width:56px;height:2px;background:${GOLD};margin:14px auto 22px;"></div>`;
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set — skipping email to', to);
    return null;
  }
  const from = process.env.MAZI_EMAIL_FROM || 'Mazi <noreply@resend.dev>';
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('[email] Resend error:', data); return null; }
    console.log('[email] Sent to', to, '— id:', data.id);
    return data.id;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return null;
  }
}

// ── Order confirmation ────────────────────────────────────────────────────
export async function sendOrderConfirmationEmail(order) {
  const { customer_email, customer_name, order_ref, total, delivery_slot, delivery_address, items, tracking_token, mode, table_label } = order;
  if (!customer_email) return null;

  const itemList = (items || []).map(it =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;font-size:14px;">${escapeHtml(String(it.quantity))}&times; ${escapeHtml(it.name)}</td><td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;font-size:14px;">EGP ${it.price * it.quantity}</td></tr>`
  ).join('');

  const subject = mode === 'dine_in'
    ? `Order received — Table ${table_label || ''} (${order_ref})`
    : `Order received — ${order_ref}`;

  const trackingUrl = `${SITE_URL}/track?token=${tracking_token}`;
  const feedbackUrl = `${SITE_URL}/feedback?token=${tracking_token}&ref=${order_ref}`;

  const inner = `
    ${eyebrow(mode === 'dine_in' ? 'Sent to the kitchen' : 'Order received')}
    ${heading(mode === 'dine_in' ? 'Your order is in' : 'Thank you for your order')}
    ${goldRule()}
    <p style="text-align:center;color:#5a6072;font-size:15px;margin:0 0 22px;">Hi ${escapeHtml(customer_name || 'there')}, we've received your order${mode === 'dine_in' ? ' at Table ' + escapeHtml(table_label || '') : ''}.</p>
    <table style="width:100%;border-collapse:collapse;">
      ${itemList}
      <tr><td style="padding:9px 0;color:#5a6072;font-size:14px;">Subtotal</td><td style="padding:9px 0;text-align:right;font-size:14px;">EGP ${order.subtotal}</td></tr>
      <tr><td style="padding:3px 0;color:#5a6072;font-size:13px;">VAT (14%)</td><td style="padding:3px 0;text-align:right;font-size:13px;">EGP ${order.vat_amount}</td></tr>
      <tr><td style="padding:3px 0;color:#5a6072;font-size:13px;">Service (12%)</td><td style="padding:3px 0;text-align:right;font-size:13px;">EGP ${order.service_amount}</td></tr>
      <tr><td style="padding:12px 0 0;border-top:2px solid ${GOLD};font-family:${SERIF};font-weight:700;color:${COBALT};font-size:17px;">Total</td><td style="padding:12px 0 0;border-top:2px solid ${GOLD};text-align:right;font-family:${SERIF};font-weight:700;color:${COBALT};font-size:20px;">EGP ${total}</td></tr>
    </table>
    ${mode === 'delivery' && delivery_address ? `<p style="color:#5a6072;font-size:13px;margin:16px 0 2px;">📍 <strong>Delivery to:</strong> ${escapeHtml(delivery_address)}</p>` : ''}
    ${mode === 'delivery' && delivery_slot ? `<p style="color:#5a6072;font-size:13px;margin:2px 0;">⏰ <strong>Time:</strong> ${escapeHtml(delivery_slot)}</p>` : ''}
    <div style="text-align:center;margin:28px 0 8px;">
      ${ctaButton(trackingUrl, 'Track your order')}
    </div>
    <div style="text-align:center;margin:0 0 4px;">
      <a href="${feedbackUrl}" style="color:${COBALT};font-size:13px;text-decoration:none;border-bottom:1px solid ${GOLD};padding-bottom:1px;">Leave feedback ✦</a>
    </div>
    <p style="color:#9aa;font-size:12px;text-align:center;margin:20px 0 0;">Order ref: ${escapeHtml(order_ref)}</p>`;

  return sendEmail(customer_email, subject, brandedShell(inner, `Your Mazi order ${order_ref} is confirmed`));
}

// ── Reservation confirmation (with QR ticket) ─────────────────────────────
export async function sendReservationConfirmationEmail(reservation) {
  if (!process.env.RESEND_API_KEY) return { sent: false, skipped: 'no RESEND_API_KEY' };

  const ticketUrl = `${SITE_URL}/r/${reservation.checkin_token}`;
  const qrImgUrl = `${SITE_URL}/api/reservation-qr?token=${reservation.checkin_token}`;
  const partyLine = reservation.type === 'beach'
    ? `${escapeHtml(String(reservation.sunbeds))} sunbed(s)`
    : `Party of ${escapeHtml(String(reservation.party_size))}`;

  const safeName = escapeHtml(reservation.customer_name);
  const safeDate = escapeHtml(reservation.res_date);
  const safeTime = escapeHtml(reservation.res_time);

  const inner = `
    ${eyebrow('You\'re booked')}
    ${heading('Reservation Confirmed')}
    ${goldRule()}
    <p style="text-align:center;color:#5a6072;font-size:15px;margin:0 0 18px;">Hi ${safeName}, your table by the sea is reserved.</p>
    <div style="background:${CREAM};border-radius:14px;padding:20px;text-align:center;margin-bottom:22px;">
      <div style="font-family:${SERIF};color:${COBALT};font-size:22px;font-weight:600;">${safeDate}</div>
      <div style="color:#5a6072;font-size:15px;margin-top:4px;">${safeTime} &middot; ${partyLine}</div>
    </div>
    <p style="text-align:center;color:#5a6072;font-size:13px;margin:0 0 14px;">Show this QR at the door to check in</p>
    <div style="text-align:center;"><img src="${qrImgUrl}" alt="Reservation QR" width="220" height="220" style="display:inline-block;border:8px solid ${CREAM};border-radius:14px;" /></div>
    <div style="text-align:center;margin:26px 0 4px;">${ctaButton(ticketUrl, 'View / download ticket')}</div>`;

  const id = await sendEmail(reservation.customer_email, 'Your Mazi reservation is confirmed', brandedShell(inner, 'Your Mazi reservation is confirmed — QR ticket inside'));
  return { sent: !!id };
}

// ── Payment request (approval → awaiting_payment) ─────────────────────────
export async function sendPaymentRequestEmail({
  customer_name, customer_email, type, res_date, res_time, party_size, sunbeds, amount, payment_link,
}) {
  try {
    if (!customer_email) return null;

    const partyLine = type === 'beach'
      ? `${escapeHtml(String(sunbeds))} sunbed(s)`
      : `Party of ${escapeHtml(String(party_size))}`;
    const safeName = escapeHtml(customer_name);
    const safeDate = escapeHtml(res_date);
    const safeTime = escapeHtml(res_time);
    const amountNum = Number(amount);
    const safeAmount = escapeHtml(Number.isFinite(amountNum) ? amountNum.toLocaleString('en-US') : amount);
    const safeLink = escapeHtml(payment_link);

    const inner = `
      ${eyebrow('Reservation approved')}
      ${heading('One step to secure it')}
      ${goldRule()}
      <p style="text-align:center;color:#5a6072;font-size:15px;margin:0 0 18px;">Hi ${safeName}, your reservation is approved. Complete payment below to secure your booking.</p>
      <div style="background:${CREAM};border-radius:14px;padding:20px;text-align:center;margin-bottom:20px;">
        <div style="font-family:${SERIF};color:${COBALT};font-size:20px;font-weight:600;">${safeDate}</div>
        <div style="color:#5a6072;font-size:15px;margin-top:4px;">${safeTime} &middot; ${partyLine}</div>
        <div style="font-family:${SERIF};color:${COBALT};font-size:30px;font-weight:700;margin-top:14px;">EGP ${safeAmount}</div>
      </div>
      <div style="text-align:center;margin:22px 0 6px;">${ctaButton(safeLink, 'Pay now')}</div>
      <p style="color:#9aa;font-size:12px;text-align:center;margin:16px 0 0;">Your QR check-in ticket is emailed once payment is confirmed.</p>`;

    const id = await sendEmail(customer_email, 'Complete your Mazi reservation payment', brandedShell(inner, 'Complete your Mazi reservation payment'));
    return { sent: !!id };
  } catch (err) {
    console.error('[email] sendPaymentRequestEmail failed:', err.message);
    return null;
  }
}
