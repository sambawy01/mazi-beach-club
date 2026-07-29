// Phase 00 — shared admin authorization + audit for the API layer.
// Two ways to authenticate:
//   1. Break-glass: bearer token === ADMIN_PASSWORD  → role 'owner' (always works,
//      so the live admin can never lock out even before staff accounts exist).
//   2. Staff session: a signed token from api/admin-auth → role from the token.
import { verifyToken } from './staffAuth.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // no hardcoded fallback (fail closed)

export const ROLES = ['owner', 'manager', 'host', 'chef', 'accounting'];

// Per-action allowed roles. 'owner' is implicitly allowed everywhere.
// Anything not listed defaults to owner+manager.
const PERMISSIONS = {
  // reads
  verify: ROLES,
  orders: ['manager', 'host', 'chef', 'accounting'],
  reservations: ['manager', 'host'],
  events: ['manager', 'accounting'],
  contacts: ['manager'],
  list_staff: ['manager'],
  list_audit: ['manager'],
  dashboard: ['manager', 'host', 'accounting'],
  feedback: ['manager', 'accounting'],
  resolve_feedback: ['manager', 'accounting'],
  customers: ['manager', 'host'],
  settings: ['manager'],
  tables: ['manager', 'host'],
  create_table: ['manager'],
  update_table: ['manager'],
  delete_table: ['manager'],
  // reservation ops
  update_order: ['manager', 'host', 'chef'],
  update_reservation: ['manager', 'host'],
  approve_reservation: ['manager', 'host'],
  mark_paid_reservation: ['manager', 'host', 'accounting'],
  confirm_reservation: ['manager', 'host'],
  create_reservation: ['manager', 'host'],
  // events / marketing
  update_event: ['manager', 'accounting'],
  send_outreach: ['manager'],
  // payments (Phase 03)
  refund: ['accounting'],
  // settings (Phase 01) — owner/manager only (default), listed for clarity
  update_settings: ['manager'],
  // staff management — owner only (not in the list → owner-only)
  create_staff: [],
  update_staff: [],
  delete_staff: [],
};

/** Resolve the caller. Returns { role, actor, actorRole, staffId, name } or null. */
export function resolveAuth(req) {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;
  if (ADMIN_PASSWORD && raw === ADMIN_PASSWORD) {
    return { role: 'owner', actor: 'owner (break-glass)', actorRole: 'owner', staffId: null, name: 'Owner' };
  }
  const payload = verifyToken(raw);
  if (payload && payload.role && ROLES.includes(payload.role)) {
    return { role: payload.role, actor: payload.email || payload.name || 'staff', actorRole: payload.role, staffId: payload.sub || null, name: payload.name || '' };
  }
  return null;
}

/** Is this role allowed to perform this action? Owner may do anything. */
export function can(role, action) {
  if (role === 'owner') return true;
  const allowed = PERMISSIONS[action];
  if (!allowed) return role === 'manager'; // unlisted → manager (+owner) only
  return allowed.includes(role);
}

/** Append an audit-log row. Best-effort: never throws into the request path. */
export async function writeAudit(supabase, auth, { action, target_type = null, target_id = null, summary = null, meta = null }) {
  if (!supabase || !auth) return;
  try {
    await supabase.from('audit_log').insert({
      actor: auth.actor, actor_role: auth.actorRole,
      action, target_type, target_id, summary, meta,
    });
  } catch (e) {
    console.error('[audit] write failed:', e.message);
  }
}
