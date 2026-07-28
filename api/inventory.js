// api/inventory.js
// Native admin backend for the Stock, Recipes, and Requisitions tabs
// (replaces Google Apps Script).
//   resource=stock        -> inventory_stock
//   resource=recipes      -> recipes
//   resource=requisitions -> requisitions
//
// Auth: Authorization: Bearer <ADMIN_PASSWORD>. Success -> { ok:true, data? };
// error -> { ok:false, error }. Records expose `id` (uuid), never a row index.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD;

// Build the client only when both URL and service-role key are present; never
// default to a hardcoded (possibly dead) project URL.
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function checkAuth(req) {
  // Fail closed: an unset/empty ADMIN_PASSWORD denies every request rather than
  // authenticating against a default.
  if (!adminPassword) return false;
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return Boolean(token) && token === adminPassword;
}

// Writable columns per resource (id/created_at are never client-set).
// `status` is intentionally NOT writable via add/edit — it may only change
// through the approve/reject/out_of_stock handlers/RPCs.
const STOCK_FIELDS = ['name', 'category', 'unit', 'qty_on_hand', 'min_level', 'cost_per_unit', 'supplier', 'last_restocked', 'notes'];
const RECIPE_FIELDS = ['menu_item', 'ingredient', 'qty_needed', 'unit'];
const REQUISITION_FIELDS = ['date', 'type', 'item_name', 'quantity', 'direction', 'performed_by', 'notes'];

// NUMERIC columns that must not receive '' (empty string) — omit them so the
// column DEFAULT applies instead of sending an invalid value to Postgres.
const NUMERIC_FIELDS = new Set([
  'price', 'cost_per_unit', 'qty_on_hand', 'min_level', 'qty_needed', 'quantity',
]);

function normalizeNumeric(obj) {
  for (const key of Object.keys(obj)) {
    if (!NUMERIC_FIELDS.has(key)) continue;
    const v = obj[key];
    if (v === '' || v === null || v === undefined) { delete obj[key]; continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) { delete obj[key]; continue; }
    obj[key] = n;
  }
  return obj;
}

// Escape LIKE/ILIKE metacharacters so caller input is matched literally.
function escapeLike(s) {
  return String(s).replace(/([\\%_])/g, '\\$1');
}

function pickFields(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

// Generic id-based CRUD used by every resource.
async function crud(res, table, fields, action, body) {
  switch (action) {
    case 'add': {
      const { data, error } = await supabase
        .from(table)
        .insert(normalizeNumeric(pickFields(body, fields)))
        .select()
        .single();
      if (error) { console.error('Inventory add error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
      return res.status(200).json({ ok: true, data });
    }
    case 'edit': {
      const { id } = body;
      if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
      const { data, error } = await supabase
        .from(table)
        .update(normalizeNumeric(pickFields(body, fields)))
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) { console.error('Inventory edit error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
      if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.status(200).json({ ok: true, data });
    }
    case 'delete': {
      const { id } = body;
      if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) { console.error('Inventory delete error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
      return res.status(200).json({ ok: true });
    }
    default:
      return res.status(400).json({ ok: false, error: 'Unknown action' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!adminPassword) {
    return res.status(500).json({ ok: false, error: 'Server auth not configured' });
  }
  if (!checkAuth(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (!supabase) {
    return res.status(500).json({ ok: false, error: 'Database not configured' });
  }

  const resource = String(req.query.resource || '');
  const action = String(req.query.action || '');
  const body = req.body || {};

  try {
    // ── STOCK ───────────────────────────────────────────────────────────
    if (resource === 'stock') {
      if (req.method === 'GET') {
        if (action === 'list') {
          const { data, error } = await supabase
            .from('inventory_stock')
            .select('*')
            .order('created_at', { ascending: false });
          if (error) { console.error('Stock list error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        return res.status(400).json({ ok: false, error: 'Unknown action' });
      }
      if (req.method === 'POST') {
        if (action === 'restock') {
          const { id, quantity, performed_by } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          const qty = Number(quantity);
          if (!Number.isFinite(qty)) return res.status(400).json({ ok: false, error: 'Invalid quantity' });
          if (qty <= 0) return res.status(400).json({ ok: false, error: 'Invalid quantity' });
          const { data, error } = await supabase.rpc('restock_item', {
            p_id: id,
            p_quantity: qty,
            p_performed_by: performed_by || '',
          });
          if (error) { console.error('Restock error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        return crud(res, 'inventory_stock', STOCK_FIELDS, action, body);
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // ── RECIPES ─────────────────────────────────────────────────────────
    if (resource === 'recipes') {
      if (req.method === 'GET') {
        if (action === 'list') {
          const { data, error } = await supabase
            .from('recipes')
            .select('*')
            .order('created_at', { ascending: false });
          if (error) { console.error('Recipes list error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        if (action === 'for') {
          const menuItem = String(req.query.menu_item || '');
          if (!menuItem) return res.status(400).json({ ok: false, error: 'Missing menu_item' });
          // Case-insensitive exact match on menu_item. Escape LIKE metacharacters
          // so a value like '%' matches literally instead of every row.
          const { data, error } = await supabase
            .from('recipes')
            .select('*')
            .ilike('menu_item', escapeLike(menuItem));
          if (error) { console.error('Recipes for error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        return res.status(400).json({ ok: false, error: 'Unknown action' });
      }
      if (req.method === 'POST') {
        return crud(res, 'recipes', RECIPE_FIELDS, action, body);
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // ── REQUISITIONS ────────────────────────────────────────────────────
    if (resource === 'requisitions') {
      if (req.method === 'GET') {
        if (action === 'list') {
          const { data, error } = await supabase
            .from('requisitions')
            .select('*')
            .order('created_at', { ascending: false });
          if (error) { console.error('Requisitions list error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        return res.status(400).json({ ok: false, error: 'Unknown action' });
      }
      if (req.method === 'POST') {
        if (action === 'approve') {
          const { id } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          const { data, error } = await supabase.rpc('approve_requisition', { p_id: id });
          if (error) { console.error('Approve requisition error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          // RPC returns jsonb {ok, warning?|error?}; surface it under data.
          return res.status(200).json({ ok: true, data });
        }
        if (action === 'reject' || action === 'out_of_stock') {
          const { id } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          const newStatus = action === 'reject' ? 'Rejected' : 'Out of Stock';
          const { data, error } = await supabase
            .from('requisitions')
            .update({ status: newStatus })
            .eq('id', id)
            .select()
            .maybeSingle();
          if (error) { console.error('Requisition status error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
          return res.status(200).json({ ok: true, data });
        }
        return crud(res, 'requisitions', REQUISITION_FIELDS, action, body);
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    return res.status(400).json({ ok: false, error: 'Unknown resource' });
  } catch (err) {
    console.error('Inventory API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
