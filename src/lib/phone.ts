/**
 * Phone normalization — the single source of truth for the E.164 form our SMS /
 * OTP endpoints accept (`api/otp-send.js` enforces `/^\+\d{8,15}$/`).
 *
 * Anything that stores a phone number (the account profile) or sends one to the
 * OTP gate MUST run it through `normalizePhone` first. Do not re-declare this
 * regex elsewhere — a stored local-format number (e.g. `01555550123`) sent
 * verbatim to `/api/otp-send` returns 400 and dead-ends the user.
 */

/** The exact shape `api/otp-send.js` accepts: `+` followed by 8–15 digits. */
export const E164_RE = /^\+\d{8,15}$/;

/** Shown under phone inputs so the expected format is never a guess. */
export const PHONE_PLACEHOLDER = '+201XXXXXXXXX or 01XXXXXXXXX';

/** User-facing message for a number we can't parse. Keep it actionable. */
export const PHONE_FORMAT_HINT =
  'Enter a valid phone number — e.g. 01XXXXXXXXX or +201XXXXXXXXX (include the country code for non-Egyptian numbers).';

/** True when `value` is already in the E.164 form the API accepts. */
export function isE164(value: string | null | undefined): boolean {
  return !!value && E164_RE.test(value);
}

function toE164OrNull(candidate: string): string | null {
  return E164_RE.test(candidate) ? candidate : null;
}

/**
 * Normalize a user-entered phone number to E.164, or return `null` when it
 * can't be parsed (callers surface an inline error rather than silently
 * sending something the API will reject).
 *
 * Handles: `+20 122 128 8804`, `00201221288804`, `01555550123`,
 * `1555550123`, `201221288804`, and separators (spaces, dashes, dots, parens).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Already international: `+…`
  if (hasPlus) return toE164OrNull('+' + digits);

  // International written with the `00` exit code.
  if (digits.startsWith('00')) return toE164OrNull('+' + digits.slice(2));

  // Egyptian country code typed without a `+` (e.g. 201221288804).
  if (digits.startsWith('20')) return toE164OrNull('+' + digits);

  // Egyptian local mobile format: 01XXXXXXXXX → +201XXXXXXXXX.
  if (digits.startsWith('01')) return toE164OrNull('+20' + digits.slice(1));

  // Egyptian mobile without the trunk `0`: 1XXXXXXXXX → +201XXXXXXXXX.
  if (digits.startsWith('1') && digits.length === 10) return toE164OrNull('+20' + digits);

  // Anything else has no country code we can infer — reject rather than guess.
  return null;
}
