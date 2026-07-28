// api/_lib/checkinToken.js
import crypto from 'node:crypto';

/** Unguessable, URL-safe reservation ticket id. */
export function generateCheckinToken() {
  const raw = crypto.randomBytes(16).toString('base64url'); // 22 chars, no +/=
  return `r_${raw}`;
}
