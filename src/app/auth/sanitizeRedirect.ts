/**
 * Sanitize a post-sign-in redirect target.
 *
 * Only same-origin, absolute *paths* are allowed (e.g. `/reserve`, `/account`).
 * This blocks open-redirect vectors like protocol-relative URLs (`//evil.com`),
 * absolute URLs (`https://evil.com`), and backslash tricks (`/\evil`) that some
 * browsers normalise to a network path.
 *
 * @param raw The untrusted `?redirect=` value (may be null/empty).
 * @returns The value if it is a safe internal path, otherwise `'/account'`.
 */
export function sanitizeRedirect(raw: string | null): string {
  // Must start with a single `/` — not `//` (protocol-relative) and not `/\`
  // (backslash variant that normalises to `//`).
  if (raw && /^\/(?![/\\])/.test(raw)) {
    return raw;
  }
  return '/account';
}

export default sanitizeRedirect;
