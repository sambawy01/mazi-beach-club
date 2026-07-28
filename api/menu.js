// api/menu.js
// Native admin backend for the Menu and Pantry tabs (replaces Google Apps Script).
// Resource maps: menu -> admin_menu_items, pantry -> pantry_products.
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

// resource -> table. Anything else is rejected.
const TABLE_BY_RESOURCE = {
  menu: 'admin_menu_items',
  pantry: 'pantry_products',
};

// Whitelist of writable columns (id/created_at are never client-set).
const ITEM_FIELDS = ['name', 'description', 'price', 'category', 'image', 'dietary', 'status'];

function pickFields(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
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
  const table = TABLE_BY_RESOURCE[resource];
  if (!table) {
    return res.status(400).json({ ok: false, error: 'Unknown resource' });
  }

  const action = String(req.query.action || '');
  const body = req.body || {};

  try {
    // ── GET: list ─────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (action === 'list') {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .order('created_at', { ascending: false });
        if (error) { console.error('Menu list error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
        return res.status(200).json({ ok: true, data });
      }
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    // ── POST: mutations ───────────────────────────────────────────────────
    if (req.method === 'POST') {
      switch (action) {
        case 'add': {
          const insert = normalizeNumeric(pickFields(body, ITEM_FIELDS));
          const { data, error } = await supabase
            .from(table)
            .insert(insert)
            .select()
            .single();
          if (error) { console.error('Menu add error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true, data });
        }
        case 'edit': {
          const { id } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          const updates = normalizeNumeric(pickFields(body, ITEM_FIELDS));
          const { data, error } = await supabase
            .from(table)
            .update(updates)
            .eq('id', id)
            .select()
            .maybeSingle();
          if (error) { console.error('Menu edit error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
          return res.status(200).json({ ok: true, data });
        }
        case 'delete': {
          const { id } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          const { error } = await supabase.from(table).delete().eq('id', id);
          if (error) { console.error('Menu delete error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          return res.status(200).json({ ok: true });
        }
        case 'toggle': {
          const { id, status } = body;
          if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
          if (!status) return res.status(400).json({ ok: false, error: 'Missing status' });
          const { data, error } = await supabase
            .from(table)
            .update({ status })
            .eq('id', id)
            .select()
            .maybeSingle();
          if (error) { console.error('Menu toggle error:', error); return res.status(500).json({ ok: false, error: 'Request failed' }); }
          if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
          return res.status(200).json({ ok: true, data });
        }
        default:
          return res.status(400).json({ ok: false, error: 'Unknown action' });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Menu API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
