// Phase 00 — staff password hashing + signed session tokens.
// Uses only Node built-ins (crypto): scrypt for passwords, HMAC-SHA256 for a
// compact stateless session token (mini-JWT). No external deps.
import crypto from 'node:crypto';

const SECRET = process.env.STAFF_JWT_SECRET || process.env.ADMIN_PASSWORD || 'mazi-dev-secret';
const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h staff session

// ── Passwords (scrypt) ────────────────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) return false;
  try {
    const derived = crypto.scryptSync(String(password), salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

// ── Session token (HMAC-signed) ───────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

/** payload: { sub, email, name, role } — exp is added automatically. */
export function signToken(payload) {
  const full = { ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

/** Returns the payload if valid + unexpired, else null. */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
