// Phase 00 — staff login. POST { email, password } → signed session token.
// The break-glass ADMIN_PASSWORD still works directly as a bearer token on the
// admin API (see _lib/adminAuth), so this endpoint is only for named staff.
import { createClient } from '@supabase/supabase-js';
import { verifyPassword, signToken } from './_lib/staffAuth.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://xwfsjfwgmwddfuxbjlzu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) : null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: staff, error } = await supabase
    .from('staff')
    .select('*')
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();

  // Uniform error to avoid leaking which emails exist.
  if (error || !staff || !staff.is_active || !verifyPassword(password, staff.pw_salt, staff.pw_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await supabase.from('staff').update({ last_login_at: new Date().toISOString() }).eq('id', staff.id);

  const token = signToken({ sub: staff.id, email: staff.email, name: staff.name, role: staff.role });
  return res.status(200).json({ ok: true, token, staff: { name: staff.name, email: staff.email, role: staff.role } });
}
