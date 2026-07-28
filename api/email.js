/**
 * Email service for Mazi — sends a single order confirmation email.
 * Uses Resend (https://resend.com) — free tier: 100 emails/day.
 *
 * The confirmation email includes:
 *   - Order summary (items, totals, delivery info)
 *   - Tracking link (/track?token=...)
 *   - Feedback link (/feedback?token=...&ref=...)
 *
 * No separate status-update emails are sent. The customer uses the
 * tracking link to see live status updates on the /track page.
 *
 * Env vars needed on Vercel:
 *   RESEND_API_KEY = re_...        (get from resend.com)
 *   MAZI_EMAIL_FROM = Mazi <orders@mazibeach.com>
 *
 * If RESEND_API_KEY is not set, emails are skipped silently (fail open).
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/** Prevent user-supplied strings from injecting HTML into email bodies. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[email] Resend error:', data);
      return null;
    }
    console.log('[email] Sent to', to, '— id:', data.id);
    return data.id;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return null;
  }
}

// ── Order confirmation (the only email sent to the customer) ──────────────
export async function sendOrderConfirmationEmail(order) {
  const { customer_email, customer_name, order_ref, total, delivery_slot, delivery_address, items, tracking_token, mode, table_label } = order;

  if (!customer_email) return null;

  const itemList = (items || []).map(it =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">${it.quantity}x ${it.name}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">EGP ${it.price * it.quantity}</td></tr>`
  ).join('');

  const subject = mode === 'dine_in'
    ? `Order received — Table ${table_label || ''} (${order_ref})`
    : `Order received — ${order_ref}`;

  const trackingUrl = `https://mazibeach.com/track?token=${tracking_token}`;
  const feedbackUrl = `https://mazibeach.com/feedback?token=${tracking_token}&ref=${order_ref}`;

  // Logo hosted on the deployed site — referenced by absolute URL so it
  // renders inside email clients. Using the Vercel domain (stable).
  const logoUrl = 'https://mazi-app.vercel.app/mazi-logo-header-white.png';

  const html = `
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
    <div style="background:#1b2350;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <img src="${logoUrl}" alt="Mazi" style="max-width:180px;height:auto;margin:0 auto 4px;display:block;" />
      <p style="color:#12207e;margin:0;font-size:14px;">Mediterranean · Ras El Hekma</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
      <h2 style="font-size:18px;margin:0 0 4px;">${mode === 'dine_in' ? '🍽️ Order sent to kitchen!' : '🛒 Order received!'}</h2>
      <p style="color:#666;margin:0 0 16px;font-size:14px;">Hi ${customer_name}, we've received your order${mode === 'dine_in' ? ' at Table ' + (table_label || '') : ''}.</p>

      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        ${itemList}
        <tr><td style="padding:8px 0;color:#666;">Subtotal</td><td style="padding:8px 0;text-align:right;">EGP ${order.subtotal}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">VAT (14%)</td><td style="padding:4px 0;text-align:right;">EGP ${order.vat_amount}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Service (12%)</td><td style="padding:4px 0;text-align:right;">EGP ${order.service_amount}</td></tr>
        <tr><td style="padding:8px 0;border-top:2px solid #12207e;font-weight:700;color:#12207e;">Total</td><td style="padding:8px 0;border-top:2px solid #12207e;text-align:right;font-weight:700;color:#12207e;font-size:18px;">EGP ${total}</td></tr>
      </table>

      ${mode === 'delivery' && delivery_address ? `<p style="color:#666;font-size:13px;margin:12px 0;">📍 <strong>Delivery to:</strong> ${delivery_address}</p>` : ''}
      ${mode === 'delivery' && delivery_slot ? `<p style="color:#666;font-size:13px;margin:4px 0;">⏰ <strong>Time:</strong> ${delivery_slot}</p>` : ''}

      <!-- Tracking + Feedback buttons -->
      <div style="margin:24px 0 8px;">
        <a href="${trackingUrl}" style="display:block;text-align:center;background:#12207e;color:#fff;text-decoration:none;padding:14px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:10px;">Track your order →</a>
        <a href="${feedbackUrl}" style="display:block;text-align:center;background:#fff;color:#12207e;text-decoration:none;padding:14px;border:2px solid #12207e;border-radius:8px;font-weight:600;font-size:14px;">⭐ Leave feedback</a>
      </div>

      <p style="color:#999;font-size:12px;text-align:center;margin:16px 0 0;">
        Order ref: ${order_ref}<br/>
        Use the tracking link to follow your order status in real time.
      </p>
    </div>
  </div>`;

  return sendEmail(customer_email, subject, html);
}

// ── Reservation confirmation email with QR ticket ─────────────────────────
const SITE_URL = process.env.SITE_URL || 'https://mazibeach.com';

/**
 * Email the guest a reservation confirmation with their QR ticket.
 * Dev-safe: returns { sent:false, skipped } when RESEND_API_KEY is unset
 * (sendEmail already guards, but we short-circuit to skip QR work too).
 */
export async function sendReservationConfirmationEmail(reservation) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: 'no RESEND_API_KEY' };
  }
  const ticketUrl = `${SITE_URL}/r/${reservation.checkin_token}`;
  const qrImgUrl = `${SITE_URL}/api/reservation-qr?token=${reservation.checkin_token}`;
  const partyLine = reservation.type === 'beach'
    ? `${reservation.sunbeds} sunbed(s)`
    : `Party of ${reservation.party_size}`;

  const safeName = escapeHtml(reservation.customer_name);
  const safeDate = escapeHtml(reservation.res_date);
  const safeTime = escapeHtml(reservation.res_time);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b2350">
      <div style="background-color:#12207e; padding:24px 16px; text-align:center; border-radius:12px; margin-bottom:20px;">
        <img src="${SITE_URL}/mazi-logo-full-white.png" alt="Mazi" width="150" style="display:inline-block; width:150px; max-width:70%; height:auto;" />
      </div>
      <h2 style="color:#12207e;text-align:center">Reservation Confirmed</h2>
      <p>Hi ${safeName}, your table is booked.</p>
      <p><strong>${safeDate}</strong> at <strong>${safeTime}</strong><br/>${partyLine}</p>
      <p>Show this QR at the door to check in:</p>
      <img src="${qrImgUrl}" alt="Reservation QR" width="260" height="260" style="display:block;margin:0 auto;" />
      <div style="margin:20px 0;text-align:center;">
        <a href="${ticketUrl}" style="display:inline-block;background:#12207e;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">View / download your ticket →</a>
      </div>
    </div>`;

  const id = await sendEmail(reservation.customer_email, 'Your Mazi reservation', html);
  return { sent: !!id };
}

// ── Payment request email (approval → awaiting_payment) ───────────────────
/**
 * Email the guest a payment request once their reservation is approved. No QR
 * is exposed here — the QR check-in ticket is emailed only after payment is
 * confirmed (sendReservationConfirmationEmail on awaiting_payment → confirmed).
 * Fails safe: returns null and never throws (matching the other emails).
 */
export async function sendPaymentRequestEmail({
  customer_name,
  customer_email,
  type,
  res_date,
  res_time,
  party_size,
  sunbeds,
  amount,
  payment_link,
}) {
  try {
    if (!customer_email) return null;

    const partyLine = type === 'beach'
      ? `${sunbeds} sunbed(s)`
      : `Party of ${party_size}`;

    const safeName = escapeHtml(customer_name);
    const safeDate = escapeHtml(res_date);
    const safeTime = escapeHtml(res_time);
    // Format money with thousands separators (e.g. 1,000). Guard non-numeric
    // input by falling back to the raw value rather than rendering "NaN".
    const amountNum = Number(amount);
    const safeAmount = escapeHtml(
      Number.isFinite(amountNum) ? amountNum.toLocaleString('en-US') : amount
    );
    const safeLink = escapeHtml(payment_link);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b2350">
        <div style="background-color:#12207e; padding:24px 16px; text-align:center; border-radius:12px; margin-bottom:20px;">
          <img src="${SITE_URL}/mazi-logo-full-white.png" alt="Mazi" width="150" style="display:inline-block; width:150px; max-width:70%; height:auto;" />
        </div>
        <h2 style="color:#12207e;text-align:center">Reservation Approved</h2>
        <p>Hi ${safeName}, your reservation has been approved. Complete your payment below to secure the booking.</p>
        <p><strong>${safeDate}</strong> at <strong>${safeTime}</strong><br/>${partyLine}</p>
        <p style="font-size:20px;font-weight:700;color:#12207e;text-align:center;margin:20px 0 4px;">EGP ${safeAmount}</p>
        <div style="margin:20px 0;text-align:center;">
          <a href="${safeLink}" style="display:inline-block;background:#12207e;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">Pay now →</a>
        </div>
        <p style="color:#666;font-size:13px;text-align:center;">Your QR check-in ticket will be emailed once your payment is confirmed.</p>
      </div>`;

    const id = await sendEmail(customer_email, 'Complete your Mazi reservation payment', html);
    return { sent: !!id };
  } catch (err) {
    console.error('[email] sendPaymentRequestEmail failed:', err.message);
    return null;
  }
}
