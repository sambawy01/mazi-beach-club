# Consumer accounts (email OTP) — reservations + orders

**Date:** 2026-07-11
**Status:** Approved (brainstorm)

## Goal

Add consumer accounts so guests register once and never re-enter their info.
Signed-in users get their **QR tickets** and **order history** in-app, and
reserving/ordering **requires an account**. Works identically on the website and
in the Capacitor native app (same codebase).

## Decisions (from brainstorm)

- **Auth:** Supabase Auth, **email OTP code** (passwordless; no magic-link
  redirect — codes work cleanly in the Capacitor webview).
- **Persistent sessions:** once signed in, the user **stays logged in** across
  app restarts until they explicitly sign out (persistSession + autoRefreshToken;
  long refresh-token lifetime).
- **Account required** to reserve and to order (dine-in). Not signed in ⇒
  sign-in screen first.
- **Full scope:** link BOTH reservations and orders to the account; provide
  "My Reservations / QR Tickets" and "My Orders" in-app; prefill forms from the
  saved profile.
- **Email delivery:** Supabase Auth sends OTP via **Resend SMTP** (domain
  `mazibeach.com` already verified). Configure now.

## Supabase Auth configuration (prerequisite — via Management API/dashboard)

- Enable the **Email** provider with **OTP** (`mailer_otp_enabled`), 6-digit code.
- **Custom SMTP → Resend:** host `smtp.resend.com`, port `465` (SSL) or `587`,
  user `resend`, password = Resend API key, sender `Mazi <hello@mazibeach.com>`.
- Session/JWT: keep default 1h access token; ensure **refresh tokens** enabled
  and long-lived (default ~30-day rolling / reuse) so users stay logged in.
- Customize the OTP email template subject/body to Mazi branding (optional).
- Leave sign-ups enabled (`disable_signup=false`) — first OTP verify creates the user.

## Data model (migration + schema.sql)

- New table **`profiles`**:
  - `user_id uuid primary key references auth.users(id) on delete cascade`
  - `full_name text`, `phone text`, `email text`, `created_at`, `updated_at`
  - **RLS:** enabled; policy `user can select/insert/update where user_id = auth.uid()`.
- Add **`user_id uuid references auth.users(id)`** to `reservations` and `orders`
  (nullable — existing guest rows stay null; new rows set it).
- **RLS** on `reservations` and `orders`: add a SELECT policy
  `user_id = auth.uid()` so a signed-in user reads only their own rows via the
  anon client. Service-role (admin APIs) bypass RLS and are unaffected. (Note:
  confirm RLS is enabled on these tables; existing admin reads use the service
  role so they keep working. If RLS was previously disabled, enabling it + adding
  the user policy must not break admin/service-role access — service role bypasses
  RLS by design.)

## Frontend

- **Supabase client:** switch the shared client (`src/lib/supabase.ts`) to
  `persistSession: true, autoRefreshToken: true`, `detectSessionInUrl: false`
  (OTP-code flow, not URL redirect). Default localStorage storage works in the
  Capacitor webview and persists across restarts.
- **AuthProvider** (React context): exposes `session`, `user`, `profile`,
  `signInWithOtp(email)`, `verifyOtp(email, code)`, `signOut()`, `loading`.
  Loads session on mount; subscribes to `onAuthStateChange`.
- **Sign-in screen** (`/signin` or a modal): step 1 enter email →
  `supabase.auth.signInWithOtp({ email, options:{ shouldCreateUser:true }})`;
  step 2 enter 6-digit code → `supabase.auth.verifyOtp({ email, token, type:'email' })`.
  Errors (bad code, expired, rate-limit) surfaced clearly.
- **Profile completion:** after first verify, if no `profiles` row, prompt for
  `full_name` + `phone`; upsert to `profiles`.
- **Route guards:** `/reserve` and the dine-in order route require a session ⇒
  redirect to sign-in (preserving intended destination). Guest path is removed
  for these (account required).
- **Prefill:** reservation + order forms read the profile and prefill
  name/phone/email (email = the account email, read-only).
- **Account area** (`/account`): profile view/edit, **My Reservations / QR
  Tickets** (their reservations with links to the QR ticket pages), **My Orders**
  (history + live status via existing tracking). Queries the anon client
  (RLS-scoped) or the existing per-token endpoints.
- **Header/nav:** show signed-in state + sign-out; "Sign in" when logged out.

## Backend (APIs set user_id from the verified token — never trust the client)

- `api/reservation.js` and the dine-in order create endpoint: read the Supabase
  **access token** from an `Authorization: Bearer <jwt>` header, verify it
  (`supabase.auth.getUser(jwt)` with the anon client, or verify the JWT), and set
  `user_id` from the verified user. If account is required and the token is
  missing/invalid → 401. Do NOT accept a client-supplied `user_id`.
- Everything else in those endpoints (validation, Telegram, emails, payment gate)
  stays as-is; `user_id` is an added column on insert.

## Security (Security Engineer review required)

- RLS policies scoped to `auth.uid()`; verify no policy exposes other users' rows.
- Server-side JWT verification for user association; reject spoofed ids.
- Anon key + RLS is the read path for "my data"; service role stays server-only.
- OTP rate-limiting handled by Supabase; ensure SMTP creds are server-side only.
- Confirm enabling RLS on reservations/orders doesn't inadvertently block the
  public reservation/order INSERT path — inserts go through service-role APIs, so
  they bypass RLS; the browser never inserts directly.

## Out of scope (later phases)

- Social login (Google/Apple), phone OTP (needs live Twilio).
- **Claiming pre-existing guest reservations/orders** by email match (existing
  rows have null `user_id`). Note as a follow-up; for now history shows only
  rows created while signed in.
- In-app push notifications.

## Build sequencing (within this feature)

1. **Foundation:** Supabase Auth config (SMTP + email OTP) · `profiles` table +
   RLS + `user_id` columns migration · client persistSession · AuthProvider ·
   sign-in + profile-completion UI · account nav/sign-out.
2. **Reservations:** gate `/reserve` behind auth · prefill · set `user_id`
   (JWT-verified) on create · "My Reservations / QR Tickets".
3. **Orders:** gate dine-in order behind auth · prefill · set `user_id` on create
   · "My Orders" history.

## Testing

- Unit: any pure helpers (e.g. session/profile mappers).
- E2E (post-deploy): sign up with a real email → receive OTP from Mazi (Resend)
  → verify → complete profile → reserve (prefilled) → see it under My Tickets →
  order → see it under My Orders → sign out → sign back in (still recognized,
  info retained). Verify a second user cannot see the first user's rows (RLS).
- Backward compat: existing guest reservations/orders (null user_id) unaffected;
  admin panel + Telegram + payment gate still work.
