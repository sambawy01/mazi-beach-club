/**
 * Customer-facing order API — sends orders to our Vercel serverless endpoint
 * which forwards to Telegram. No more dead backend.
 */
import { API_BASE } from '../lib/apiConfig';
import { supabase } from '../lib/supabase';

/**
 * Build request headers for a create call. Always JSON; when a Supabase
 * session is present we attach the bearer token so the created row links to
 * the signed-in account. Guests (no session) send no Authorization header,
 * preserving the existing anonymous flow.
 */
async function authedJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = 'Bearer ' + session.access_token;
    }
  } catch {
    // No session / storage unavailable — fall through as a guest.
  }
  return headers;
}

export interface SlotInfo {
  time: string;
  status: 'open' | 'busy';
}

export interface Availability {
  paused: boolean;
  date: string;
  slots: SlotInfo[];
  asap: string | null;
}

export interface TrackedOrder {
  name: string;
  status: string;
  deliveryDate: string;
  deliverySlot: string;
  orderSummary: string;
  orderTotal: number | string;
}

export function slotLabel(time: string): string {
  const [hStr, mStr] = String(time).split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

// Fallback availability — always open, simple time slots
export async function getAvailability(): Promise<Availability | null> {
  const now = new Date();
  const minTime = new Date(now.getTime() + 30 * 60000);
  const slots: SlotInfo[] = [];
  for (let h = 14; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 20 && m > 0) continue;
      const slot = new Date();
      slot.setHours(h, m, 0, 0);
      if (slot > minTime) {
        slots.push({ time: `${h}:${m === 0 ? '00' : '30'}`, status: 'open' });
      }
    }
  }
  const asap = slots.length > 0 ? slots[0].time : null;
  return { paused: false, date: now.toISOString().split('T')[0], slots, asap };
}

export async function getOrderStatus(token: string): Promise<TrackedOrder | null> {
  try {
    const res = await fetch(`${API_BASE}/api/track?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    return {
      name: data.name,
      status: data.status,
      deliveryDate: data.deliveryDate,
      deliverySlot: data.deliverySlot,
      orderSummary: data.orderSummary,
      orderTotal: data.orderTotal,
    };
  } catch {
    return null;
  }
}

export type OnSitePaymentMethod = 'cod' | 'card_on_delivery' | 'instapay';

export interface OnSiteOrderInput {
  items: { name: string; quantity: number; price: number }[];
  name: string;
  phone: string;
  email: string;
  address: string;
  location?: string;
  note?: string;
  deliverySlot: string;
  expectedStatus: 'open' | 'busy';
  paymentMethod: OnSitePaymentMethod;
}

export type OnSiteOrderResult =
  | { ok: true; status: 'confirmed' | 'pending_approval'; trackingToken: string; deliverySlot: string; paymentMethod: OnSitePaymentMethod }
  | { ok: false; code?: 'slot_full' | 'slot_unavailable' | 'busy_retry' | 'daily_limit'; error?: string };

export async function placeOrderOnSite(input: OnSiteOrderInput): Promise<OnSiteOrderResult> {
  try {
    const res = await fetch(`${API_BASE}/api/order`, {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      return {
        ok: true,
        status: json.status || 'confirmed',
        trackingToken: json.trackingToken || '',
        deliverySlot: json.deliverySlot || input.deliverySlot,
        paymentMethod: input.paymentMethod,
      };
    }
    return { ok: false, error: json.error || 'Network error. Please try again.' };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

// ── Dine-in ordering (QR at table) ────────────────────────────────────────
export interface DineInOrderInput {
  tableId: string;
  items: { name: string; quantity: number; price: number }[];
  note?: string;
  guestName?: string;
  guestPhone?: string;
  paymentMethod?: string;
}

/**
 * Machine-readable failure codes from /api/order-dinein.
 *
 * `phone_not_verified` — the 30-minute TTL on the diner's OTP verification
 * lapsed (they sat with the menu open), so the server rejected the submit with
 * 403. It is recoverable: re-run the OTP gate and re-submit. Callers MUST
 * branch on this rather than dead-ending on the raw error string.
 *
 * `verification_unavailable` — the server couldn't run the verification check
 * (infra: no service-role client, or the query errored). NOT recoverable by
 * re-verifying, so callers must surface a terminal "contact staff" state rather
 * than re-opening the OTP gate.
 */
export type DineInOrderErrorCode = 'phone_not_verified' | 'verification_unavailable';

export interface DineInOrderResult {
  ok: boolean;
  orderId?: string;
  trackingToken?: string;
  tableLabel?: string;
  total?: number;
  code?: DineInOrderErrorCode;
  error?: string;
}

export async function placeDineInOrder(input: DineInOrderInput): Promise<DineInOrderResult> {
  try {
    const res = await fetch(`${API_BASE}/api/order-dinein`, {
      method: 'POST',
      headers: await authedJsonHeaders(),
      body: JSON.stringify({
        ...input,
        paymentMethod: input.paymentMethod || 'cash_on_site',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      return {
        ok: true,
        orderId: json.orderId || '',
        trackingToken: json.trackingToken || '',
        tableLabel: json.tableLabel || '',
        total: json.total || 0,
      };
    }
    // Surface the server's error CODE, not just its prose. The dine-in page
    // needs `phone_not_verified` to re-open the OTP gate instead of dead-ending
    // the diner on a toast they cannot act on.
    return { ok: false, code: json.code, error: json.error || 'Network error. Please try again.' };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}