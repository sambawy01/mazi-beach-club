const ADMIN_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec';
import { API_BASE } from '../lib/apiConfig';
const STORAGE_KEY = 'bc-admin-pw';
const ROLE_KEY = 'bc-admin-role';

export type Role = 'owner' | 'manager' | 'host' | 'chef' | 'accounting' | 'scanner';

export interface AdminItem {
  id: string; // uuid
  name: string;
  description: string;
  price: number | string;
  category: string;
  image: string;
  dietary: string;
  status: string;
}

export interface OrderItem {
  _rowIndex: number;
  [key: string]: string | number;
}

export function getStoredPassword(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredPassword(pw: string) {
  localStorage.setItem(STORAGE_KEY, pw);
}

export function clearStoredPassword() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getStoredRole(): Role | null {
  return localStorage.getItem(ROLE_KEY) as Role | null;
}

export function setStoredRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role);
}

export function clearStoredRole() {
  localStorage.removeItem(ROLE_KEY);
}

/**
 * All requests use GET to avoid the Google Apps Script 302 redirect problem.
 * POST requests lose their body during the 302 redirect from script.google.com
 * to script.googleusercontent.com. GET params survive the redirect.
 */
async function apiGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${ADMIN_ENDPOINT}?${qs}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Verify a bearer token (break-glass owner password OR staff session token). */
export async function verifyPassword(token: string): Promise<{ valid: boolean; role?: Role; name?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/admin?action=verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      return { valid: true, role: (j.role as Role) || 'owner', name: j.name };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

// ── Staff auth & management (Phase 00) ────────────────────────────────────
export async function staffLogin(email: string, password: string): Promise<{ token: string; role: Role; name: string }> {
  const res = await fetch(`${API_BASE}/api/admin-auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) throw new Error(j.error || 'Login failed');
  return { token: j.token, role: j.staff.role as Role, name: j.staff.name };
}

export type StaffMember = { id: string; email: string; name: string; role: Role; is_active: boolean; created_at: string; last_login_at: string | null };
export async function getStaff(password: string): Promise<StaffMember[]> {
  return adminFetch<StaffMember[]>(password, 'list_staff');
}
export async function createStaff(password: string, s: { email: string; name: string; role: Role; password: string }): Promise<StaffMember> {
  return adminUpdateReturning<StaffMember>(password, 'create_staff', s as unknown as Record<string, unknown>);
}
export async function updateStaff(password: string, id: string, patch: Partial<{ name: string; role: Role; is_active: boolean; password: string }>): Promise<void> {
  return adminUpdate(password, 'update_staff', { id, ...patch });
}
export async function deleteStaff(password: string, id: string): Promise<void> {
  return adminUpdate(password, 'delete_staff', { id });
}

export type AuditEntry = { id: string; actor: string; actor_role: string; action: string; target_type: string | null; target_id: string | null; summary: string | null; created_at: string };
export async function getAuditLog(password: string): Promise<AuditEntry[]> {
  return adminFetch<AuditEntry[]>(password, 'list_audit');
}

// ── Floor & tables (Phase 07) ──────────────────────────────────────────────
export type TableZone = 'dining' | 'bar' | 'daybed';
export type FloorTable = {
  id: string; label: string; zone: TableZone; capacity: number;
  qr_code: string | null; is_active: boolean; created_at: string;
  occupied_by: { order_ref: string; total: number; status: string; since: string } | null;
};
export async function getTables(password: string): Promise<FloorTable[]> {
  return adminFetch<FloorTable[]>(password, 'tables');
}
export async function createTable(password: string, t: { label: string; zone: TableZone; capacity: number; qr_code?: string }): Promise<FloorTable> {
  return adminUpdateReturning<FloorTable>(password, 'create_table', t as unknown as Record<string, unknown>);
}
export async function updateTable(password: string, id: string, patch: Partial<{ label: string; zone: TableZone; capacity: number; qr_code: string; is_active: boolean }>): Promise<void> {
  return adminUpdate(password, 'update_table', { id, ...patch });
}
export async function deleteTable(password: string, id: string): Promise<void> {
  return adminUpdate(password, 'delete_table', { id });
}

// ── Feedback (Phase 06) — reputation queue ─────────────────────────────────
export type FeedbackEntry = {
  id: string; order_ref: string | null; tracking_token: string | null;
  customer_name: string | null; customer_email: string | null;
  rating: number; comment: string; created_at: string;
  resolved?: boolean; resolved_at?: string | null; staff_note?: string;
};
export type FeedbackSummary = { count: number; avg: number; distribution: Record<string, number>; unresolved: number };
export async function getFeedback(password: string): Promise<{ rows: FeedbackEntry[]; summary: FeedbackSummary }> {
  return adminFetch<{ rows: FeedbackEntry[]; summary: FeedbackSummary }>(password, 'feedback');
}
export async function resolveFeedback(password: string, id: string, patch: { resolved?: boolean; staff_note?: string }): Promise<void> {
  return adminUpdate(password, 'resolve_feedback', { id, ...patch });
}

// ── Customers (Phase 05) — Customer 360 CRM ────────────────────────────────
export type Customer = {
  email: string; name: string; phone: string; has_account: boolean;
  orders: number; spend: number; cancelled_orders: number;
  reservations: number; confirmed_reservations: number;
  first_seen: string | null; last_seen: string | null;
  last_order_at: string | null; last_reservation_at: string | null;
  visits: number; last_activity: string | null;
};
export async function getCustomers(password: string): Promise<Customer[]> {
  return adminFetch<Customer[]>(password, 'customers');
}

// ── Dashboard (Phase 02) — Command Center snapshot ─────────────────────────
export type DashboardStats = {
  orders_today: number; revenue_today: number; open_orders: number;
  reservations_today: number; covers_today: number; pending_reservations: number;
  awaiting_payment: number; pending_events: number;
};
export type DashboardData = {
  today: string;
  stats: DashboardStats;
  queues: {
    pendingReservations: { id: string; name: string; type: string; date: string; party: number; sunbeds: number }[];
    pendingOrders: { id: string; ref: string; name: string; total: number; mode: string }[];
  };
  revenueSpark: { date: string; total: number }[];
  statusBreakdown: { orders: Record<string, number>; reservations: Record<string, number> };
};
export async function getDashboard(password: string): Promise<DashboardData> {
  return adminFetch<DashboardData>(password, 'dashboard');
}

// ── Settings (Phase 01) — key/value store, values are JSON ──────────────────
// The API returns a flat { key: value } object; updates upsert one or more keys.
export type SettingsMap = Record<string, unknown>;
export async function getSettings(password: string): Promise<SettingsMap> {
  return adminFetch<SettingsMap>(password, 'settings');
}
export async function updateSettings(password: string, settings: SettingsMap): Promise<void> {
  return adminUpdate(password, 'update_settings', { settings });
}

// ── Native catalog API (api/menu.js) — Menu & Pantry tabs ──────────────────
// Bearer auth, id-based, envelope { ok, data } / { ok, error }.
type CatalogResource = 'menu' | 'pantry';

async function catalogGet(password: string, resource: CatalogResource): Promise<AdminItem[]> {
  const res = await fetch(`${API_BASE}/api/menu?resource=${resource}&action=list`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return (json.data || []) as AdminItem[];
}

async function catalogPost(
  password: string,
  resource: CatalogResource,
  action: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/menu?resource=${resource}&action=${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${password}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
}

export async function getMenuItems(password: string): Promise<AdminItem[]> {
  return catalogGet(password, 'menu');
}

export async function getPantryItems(password: string): Promise<AdminItem[]> {
  return catalogGet(password, 'pantry');
}

export async function addPantryItem(password: string, item: Record<string, string>): Promise<void> {
  return catalogPost(password, 'pantry', 'add', item);
}

export async function editPantryItem(password: string, id: string, item: Record<string, string>): Promise<void> {
  return catalogPost(password, 'pantry', 'edit', { id, ...item });
}

export async function deletePantryItem(password: string, id: string): Promise<void> {
  return catalogPost(password, 'pantry', 'delete', { id });
}

export async function togglePantryVisibility(password: string, id: string, status: string): Promise<void> {
  return catalogPost(password, 'pantry', 'toggle', { id, status });
}

export async function getOrders(password: string): Promise<OrderItem[]> {
  const res = await apiGet<{ success: boolean; orders?: OrderItem[]; error?: string }>({
    action: 'getOrders',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch orders');
  return res.orders || [];
}

export async function addMenuItem(password: string, item: Record<string, string>): Promise<void> {
  return catalogPost(password, 'menu', 'add', item);
}

export async function editMenuItem(password: string, id: string, item: Record<string, string>): Promise<void> {
  return catalogPost(password, 'menu', 'edit', { id, ...item });
}

export async function deleteMenuItem(password: string, id: string): Promise<void> {
  return catalogPost(password, 'menu', 'delete', { id });
}

export async function toggleItemVisibility(password: string, id: string, status: string): Promise<void> {
  return catalogPost(password, 'menu', 'toggle', { id, status });
}

export async function archiveOrder(password: string, rowIndex: number): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'archiveOrder',
    password,
    rowIndex: String(rowIndex),
  });
  if (!res.success) throw new Error(res.error || 'Failed to archive order');
}

// ── CRM Orders (capacity workflow) ──

export type OrderStatus =
  | 'New' // legacy rows
  | 'pending_approval'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'declined'
  | 'cancelled';

export interface CRMOrder {
  _rowIndex: number;
  id: number | string;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  delivery_area: string;
  address: string;
  order_total: number | string;
  order_summary: string;
  item_count: number | string;
  delivery_date: string;
  delivery_slot: string;
  tracking_token: string;
  status: string;
  notes: string;
}

export async function getCRMOrders(password: string): Promise<CRMOrder[]> {
  const res = await apiGet<{ success: boolean; items?: CRMOrder[]; error?: string }>({
    action: 'getCRMOrders',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch orders');
  return res.items || [];
}

export async function setOrderStatus(password: string, rowIndex: number, status: OrderStatus, orderId: string): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'setOrderStatus',
    password,
    rowIndex: String(rowIndex),
    status,
    orderId: String(orderId),
  });
  if (!res.success) throw new Error(res.error || 'Failed to update order status');
}

// ── Supabase-backed admin operations ──────────────────────────────────────
export interface SupabaseOrder {
  id: string;
  order_ref: string;
  mode: 'delivery' | 'dine_in';
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_address: string | null;
  delivery_slot: string | null;
  table_id: string | null;
  table_label: string | null;
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  vat_amount: number;
  service_amount: number;
  total: number;
  payment_method: string;
  tracking_token: string;
  note: string | null;
  created_at: string;
}

export interface SupabaseReservation {
  id: string;
  type: 'beach' | 'restaurant';
  // 'pending' | 'awaiting_payment' | 'confirmed' | 'arrived' | 'declined' | 'cancelled' | 'completed' | 'no_show'
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  res_date: string;
  res_time: string;
  party_size: number;
  sunbeds: number;
  social_link?: string;
  payment_amount?: number | null;
  payment_link?: string | null;
  notes: string;
  created_at: string;
}

export interface SupabaseEvent {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  event_type: string | null;
  event_date: string | null;
  party_size: number | null;
  notes: string;
  quoted_price: number | null;
  paymob_link: string | null;
  created_at: string;
}

async function adminFetch<T>(password: string, action: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/admin?action=${action}`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data as T;
}

async function adminUpdate(password: string, action: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin?action=${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${password}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `HTTP ${res.status}`);
  }
}

/** POST admin action that returns data. */
async function adminUpdateReturning<T>(password: string, action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/admin?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

// ── Outreach + admin-created reservations ────────────────────────────────
export type Contact = { email: string; name: string };
export async function getContacts(password: string): Promise<Contact[]> {
  return adminFetch<Contact[]>(password, 'contacts');
}

export type OutreachPayload = {
  subject: string; title?: string; body: string;
  ctaLabel?: string; ctaUrl?: string; imageUrl?: string;
  recipients: 'all' | string | string[];
};
export async function sendOutreach(password: string, payload: OutreachPayload): Promise<{ total: number; sent: number; failed: number }> {
  return adminUpdateReturning(password, 'send_outreach', payload as unknown as Record<string, unknown>);
}

export type NewReservationPayload = {
  type: 'beach' | 'restaurant'; name: string; phone?: string; email?: string;
  date: string; time: string; partySize?: number | string; sunbeds?: number | string;
  notes?: string; notify?: boolean;
};
export async function createReservationAdmin(password: string, payload: NewReservationPayload): Promise<unknown> {
  return adminUpdateReturning(password, 'create_reservation', payload as unknown as Record<string, unknown>);
}

export async function fetchOrdersFromSupabase(password: string): Promise<SupabaseOrder[]> {
  return adminFetch<SupabaseOrder[]>(password, 'orders');
}

export async function updateOrderStatusInSupabase(password: string, orderId: string, status: string): Promise<void> {
  return adminUpdate(password, 'update_order', { id: orderId, status });
}

export async function fetchReservationsFromSupabase(password: string): Promise<SupabaseReservation[]> {
  return adminFetch<SupabaseReservation[]>(password, 'reservations');
}

export async function updateReservationStatusInSupabase(password: string, id: string, status: string): Promise<void> {
  return adminUpdate(password, 'update_reservation', { id, status });
}

/**
 * Approve a pending reservation and request payment.
 * Moves pending → awaiting_payment on the backend and triggers the payment
 * request email. Reads the bearer password from local storage (same source
 * the other admin calls use via getStoredPassword()).
 */
export async function approveReservation(id: string, payment_link: string, amount: number): Promise<void> {
  const password = getStoredPassword();
  if (!password) throw new Error('Not authenticated');
  return adminUpdate(password, 'approve_reservation', { id, payment_link, amount });
}

/**
 * Mark an awaiting_payment reservation as paid and release the QR ticket.
 * Moves awaiting_payment → confirmed on the backend and triggers the
 * confirmation (QR) email.
 */
export async function markPaidReservation(id: string): Promise<void> {
  const password = getStoredPassword();
  if (!password) throw new Error('Not authenticated');
  return adminUpdate(password, 'mark_paid_reservation', { id });
}

/**
 * Confirm a pending reservation WITHOUT requesting payment.
 * Moves pending → confirmed directly and releases the QR ticket email,
 * skipping the awaiting_payment step. Use when the per-person charge is waived.
 */
export async function confirmReservation(id: string): Promise<void> {
  const password = getStoredPassword();
  if (!password) throw new Error('Not authenticated');
  return adminUpdate(password, 'confirm_reservation', { id });
}

export async function fetchEventsFromSupabase(password: string): Promise<SupabaseEvent[]> {
  return adminFetch<SupabaseEvent[]>(password, 'events');
}

// ── Membership applications (same approval lifecycle as reservations) ──────
export interface MembershipApplication {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  membership_type: string;
  notes: string;
  social_link: string;
  status: string; // pending | approved | declined
  decline_reason: string | null;
  created_at: string;
}
export async function fetchMemberships(password: string): Promise<MembershipApplication[]> {
  return adminFetch<MembershipApplication[]>(password, 'memberships');
}
export async function updateMembership(password: string, id: string, status: 'approved' | 'declined', reason?: string): Promise<void> {
  return adminUpdate(password, 'update_membership', { id, status, ...(reason ? { reason } : {}) });
}

/**
 * Patch an event row. `quoted_price` / `paymob_link` are nullable on the row
 * (SupabaseEvent) and EventsTab passes an explicit `null` to CLEAR them — the
 * price editor sends `parseInt(value) || null` and the link editor sends
 * `value || null`. The param type must therefore admit null, not just the
 * populated types, or clearing a field is a type error.
 */
export async function updateEventInSupabase(
  password: string,
  id: string,
  updates: { status?: string; quoted_price?: number | null; paymob_link?: string | null },
): Promise<void> {
  return adminUpdate(password, 'update_event', { id, ...updates });
}
