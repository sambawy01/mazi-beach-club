// Native admin inventory service — talks to api/inventory.js (Supabase-backed).
// Bearer auth (admin password), id-based, envelope { ok, data } / { ok, error }.
import { API_BASE } from '../lib/apiConfig';
import { getStoredPassword } from './adminService';

function pw(): string {
  const p = getStoredPassword();
  if (!p) throw new Error('Not authenticated');
  return p;
}

async function invGet<T>(resource: string, action: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ resource, action, ...params }).toString();
  const res = await fetch(`${API_BASE}/api/inventory?${qs}`, {
    headers: { Authorization: `Bearer ${pw()}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

async function invPost<T = unknown>(resource: string, action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/inventory?resource=${resource}&action=${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pw()}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

// ── Inventory Interfaces ──

export interface StockItem {
  id: string; // uuid
  name: string;
  category: string;
  unit: string;
  qty_on_hand: number;
  min_level: number;
  cost_per_unit: number;
  supplier: string;
  last_restocked: string | null;
  notes: string;
}

export interface Recipe {
  id: string; // uuid
  menu_item: string;
  ingredient: string;
  qty_needed: number;
  unit: string;
}

export interface Requisition {
  id: string; // uuid
  date: string | null;
  type: string;
  item_name: string;
  quantity: number;
  direction: string;
  performed_by: string;
  notes: string;
  status: string;
}

/** RPC result of approve_requisition (returned under `data`). */
interface ApproveResult {
  ok: boolean;
  warning?: string;
  error?: string;
}

// ── Stock CRUD ──

export async function getInventory(): Promise<StockItem[]> {
  return (await invGet<StockItem[]>('stock', 'list')) || [];
}

export async function addInventoryItem(item: Record<string, string>): Promise<void> {
  await invPost('stock', 'add', item);
}

export async function editInventoryItem(id: string, item: Record<string, string>): Promise<void> {
  await invPost('stock', 'edit', { id, ...item });
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await invPost('stock', 'delete', { id });
}

/**
 * Restock: single atomic call. The server increments qty_on_hand, stamps
 * last_restocked, and logs an approved IN requisition.
 */
export async function restockItem(id: string, quantity: number, performedBy: string): Promise<void> {
  await invPost('stock', 'restock', { id, quantity, performed_by: performedBy });
}

// ── Recipe CRUD ──

export async function getRecipes(): Promise<Recipe[]> {
  return (await invGet<Recipe[]>('recipes', 'list')) || [];
}

export async function getRecipeFor(menuItem: string): Promise<Recipe[]> {
  return (await invGet<Recipe[]>('recipes', 'for', { menu_item: menuItem })) || [];
}

export async function addRecipe(item: Record<string, string>): Promise<void> {
  await invPost('recipes', 'add', item);
}

export async function editRecipe(id: string, item: Record<string, string>): Promise<void> {
  await invPost('recipes', 'edit', { id, ...item });
}

export async function deleteRecipe(id: string): Promise<void> {
  await invPost('recipes', 'delete', { id });
}

// ── Requisitions ──

export async function getRequisitions(): Promise<Requisition[]> {
  return (await invGet<Requisition[]>('requisitions', 'list')) || [];
}

export async function addRequisition(item: Record<string, string>): Promise<void> {
  await invPost('requisitions', 'add', item);
}

export async function editRequisition(id: string, item: Record<string, string>): Promise<void> {
  await invPost('requisitions', 'edit', { id, ...item });
}

export async function deleteRequisition(id: string): Promise<void> {
  await invPost('requisitions', 'delete', { id });
}

/**
 * Approve a requisition: server-side deducts stock + sets status to Approved.
 * The HTTP call always succeeds; the business outcome lives in data.ok — a
 * `false` result (e.g. "already approved") is surfaced as a thrown error.
 */
export async function approveRequisition(id: string): Promise<void> {
  const result = await invPost<ApproveResult>('requisitions', 'approve', { id });
  if (result && result.ok === false) {
    throw new Error(result.error || 'Failed to approve requisition');
  }
}

/**
 * Reject a requisition: sets status to Rejected, no stock change.
 */
export async function rejectRequisition(id: string): Promise<void> {
  await invPost('requisitions', 'reject', { id });
}

/**
 * Mark requisition as Out of Stock: sets status, no stock change.
 */
export async function outOfStockRequisition(id: string): Promise<void> {
  await invPost('requisitions', 'out_of_stock', { id });
}

/**
 * Chef submits recipe requisition: creates Pending entries, NO stock deduction.
 */
export async function submitRecipeRequisition(
  menuItem: string,
  portions: number,
  performedBy: string,
): Promise<void> {
  const ingredients = await getRecipeFor(menuItem);
  if (ingredients.length === 0) throw new Error('No recipe found for "' + menuItem + '"');

  const today = new Date().toISOString().split('T')[0];

  for (const ing of ingredients) {
    const totalNeeded = Number(ing.qty_needed) * portions;
    await addRequisition({
      date: today,
      type: 'Recipe',
      item_name: String(ing.ingredient),
      quantity: String(totalNeeded),
      direction: 'OUT',
      performed_by: performedBy,
      notes: menuItem + ' x' + portions,
      status: 'Pending',
    });
  }
}

/**
 * Chef submits manual requisition: creates a Pending entry, NO stock deduction.
 */
export async function submitManualRequisition(
  itemName: string,
  quantity: number,
  reason: string,
  performedBy: string,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await addRequisition({
    date: today,
    type: 'Manual',
    item_name: itemName,
    quantity: String(quantity),
    direction: 'OUT',
    performed_by: performedBy,
    notes: reason,
    status: 'Pending',
  });
}
