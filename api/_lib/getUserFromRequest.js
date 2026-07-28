import { createClient } from '@supabase/supabase-js';

// ── Consumer Supabase client (ANON key) ───────────────────────────────────
// Used ONLY to verify a caller's access token via auth.getUser(token). We use
// the anon/publishable key (never the service role key) because getUser must
// validate the JWT as the token's own subject, not as an elevated actor.
const supabaseUrl =
  process.env.VITE_SUPABASE_URL || 'https://YOUR-MAZI-PROJECT.supabase.co';
const envAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  envAnonKey || 'sb_publishable_REPLACE_WITH_MAZI_ANON_KEY';

// VITE_SUPABASE_ANON_KEY is a client-build convention, so it is easy to define
// for the build but NOT for the serverless function runtime. When that happens
// we silently fall back to the hardcoded key — which will drift from the project
// URL sooner or later, and then EVERY authenticated request degrades to guest.
// Surface which source we're on so a broken deploy is debuggable from the logs.
const anonKeySource = envAnonKey
  ? 'env:VITE_SUPABASE_ANON_KEY'
  : 'hardcoded-fallback (VITE_SUPABASE_ANON_KEY not set in the function env)';

/**
 * Resolve the signed-in user's id from a request's Authorization header.
 *
 * Security model: the bearer token is verified SERVER-SIDE against Supabase
 * (auth.getUser). A forged, tampered, or expired token yields no user → null.
 * We never trust a body-supplied user id. A missing/invalid token simply means
 * the caller is treated as a guest (returns null → row's user_id stays null).
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string|null>} the authenticated user's uuid, or null (guest)
 */
export async function getUserIdFromRequest(req) {
  // No bearer token at all → an ordinary guest. This is the normal, expected
  // path; do NOT warn here or every anonymous order becomes log noise.
  const authHeader = req?.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;

  const token = match[1].trim();

  // From here on a token WAS presented. Any failure to turn it into a user is
  // a real signal — the caller believes they are signed in, and the row is
  // about to be written as a guest (user_id null) anyway. Never stay silent.
  if (!token) {
    warnAuthFailed('empty bearer token in Authorization header');
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      warnAuthFailed(error.message || 'auth.getUser returned an error', error.status);
      return null;
    }
    if (!data?.user) {
      warnAuthFailed('auth.getUser returned no user for the token');
      return null;
    }

    return data.user.id;
  } catch (err) {
    // Never throw — any failure still falls back to guest (user_id null) — but
    // a thrown error here (bad key, DNS, network) must not vanish.
    warnAuthFailed(`auth.getUser threw: ${err?.message || String(err)}`);
    return null;
  }
}

/**
 * Log a failed verification of a token that WAS presented.
 * Deliberately logs no token contents and no PII — only the reason and the
 * config provenance needed to tell a bad token apart from a bad deploy.
 */
function warnAuthFailed(reason, status) {
  console.warn(
    '[auth] Bearer token present but verification FAILED — request falls back to guest ' +
      '(user_id will be null).',
    JSON.stringify({
      reason,
      ...(status ? { status } : {}),
      supabaseUrl,
      anonKeySource,
    })
  );
}
