// api/_lib/parsePaymentReply.js
//
// Pure parser for the admin's Telegram reply that supplies a payment link and
// an amount (EGP) for a reservation being approved. No side effects.
//
// Rule (per spec): extract the FIRST `https?://…` token as the link and the
// FIRST positive number as the amount. Amounts may carry thousands separators
// (`1,000`) and decimals (`500.00`). On invalid input — missing URL or no
// positive amount — return `{ error }` so the caller can prompt a retry.

/**
 * @param {string} text - raw message text from the admin's reply.
 * @returns {{ link: string, amount: number } | { error: string }}
 */
export function parsePaymentReply(text) {
  const input = typeof text === 'string' ? text : '';

  // First URL token (stops at whitespace) — this is the payment link.
  const linkMatch = input.match(/https?:\/\/\S+/i);
  if (!linkMatch) {
    return { error: 'No payment link found. Include a link starting with http:// or https://.' };
  }
  const link = linkMatch[0];

  // Find the first positive number anywhere in the text that is NOT part of ANY
  // URL. Strip out EVERY http(s) URL first (global, not just the captured link)
  // so digits in a second URL's path/query (e.g. .../order/2) can't be misread
  // as the amount.
  const withoutLink = input.replace(/https?:\/\/\S+/gi, ' ');

  // Match integers/decimals with optional comma thousands separators:
  //   500 | 500.00 | 1,000 | 1,000.50
  const numRegex = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  let amount = null;
  let m;
  while ((m = numRegex.exec(withoutLink)) !== null) {
    // A leading minus sign makes the number negative (not positive) — skip it.
    const signed = withoutLink[m.index - 1] === '-';
    const value = Number(m[0].replace(/,/g, '')) * (signed ? -1 : 1);
    if (Number.isFinite(value) && value > 0) {
      amount = value;
      break;
    }
  }

  if (amount === null) {
    return { error: 'No valid amount found. Include a positive amount in EGP, e.g. 500.' };
  }

  return { link, amount };
}
