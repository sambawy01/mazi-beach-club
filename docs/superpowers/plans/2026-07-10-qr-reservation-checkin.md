# QR Reservation Check-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every reservation a unique QR ticket (downloadable on-screen page + email) that staff scan with a phone camera to check the guest in, assign a table, and notify the floor team.

**Architecture:** Add three columns + one enum value to the existing `reservations` table. The booking API generates an unguessable `checkin_token` and emails a QR ticket. A public read-only page `/r/:token` renders the QR and lets the guest download it. An admin-authed scanner page `/admin/checkin` decodes the QR with the phone camera, calls a check-in endpoint whose validation lives in a pure, unit-tested function, then marks the reservation `arrived` with an assigned `table_id` and posts to Telegram.

**Tech Stack:** Vite + React + TypeScript (SPA), React Router, Vercel serverless functions (`api/*.js`, Node 18), Supabase (service-role), Resend (email), Telegram Bot API, `qrcode` (already a dep, isomorphic — server email + client canvas), `html5-qrcode` (new dep — camera decode), vitest.

## Global Constraints

- Node serverless functions follow the existing style: `export default async function handler(req, res)`, service-role Supabase client, global `fetch`. Copy the client-init and `sendTelegram` patterns from `api/reservation.js`.
- Admin auth = HTTP header `Authorization: Bearer <ADMIN_PASSWORD>`, env `ADMIN_PASSWORD` (default `mazi2025`), same as `api/admin.js:16`. Non-matching → HTTP 401.
- Dev-mode safety: every external dependency degrades silently when its env var is unset (Supabase → skip persist + warn; Resend → skip send; Telegram → skip notify). Mirror the existing guards.
- QR payload is always the guest ticket URL `https://mazibeach.com/r/<token>` — never a raw DB id.
- `checkin_token` is unguessable (>=16 URL-safe chars from node `crypto`). Never reuse the reservation UUID as the QR payload.
- Date-window for check-in = the reservation's `res_date` equals **today in Africa/Cairo**. Single-day window.
- Tests use vitest and live under `tests/`. Run with `npm test` (`vitest run`).
- Reservation status values live in the `reservation_status` enum; the only new value is `arrived`.

---

### Task 1: Database migration — columns + enum value

**Files:**
- Create: `supabase/migrations/20260710120000_reservation_checkin.sql`

**Interfaces:**
- Produces: `reservations.checkin_token text unique`, `reservations.arrived_at timestamptz`, `reservations.table_id uuid references tables(id)`, and enum value `reservation_status.'arrived'`. Every later task depends on these.

- [ ] **Step 1: Write the migration**

```sql
-- 20260710120000_reservation_checkin.sql
-- QR reservation check-in: ticket token, arrival timestamp, assigned table.

-- Enum value must be added in its own statement (Postgres: cannot ALTER TYPE
-- ADD VALUE inside a transaction block that later uses it).
alter type reservation_status add value if not exists 'arrived';

alter table reservations
  add column if not exists checkin_token text,
  add column if not exists arrived_at    timestamptz,
  add column if not exists table_id       uuid references tables(id);

-- Unique index (not inline constraint, so re-run is idempotent).
create unique index if not exists reservations_checkin_token_key
  on reservations (checkin_token)
  where checkin_token is not null;
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset` (or `supabase migration up` against your local/dev project).
Expected: no errors; `\d reservations` shows `checkin_token`, `arrived_at`, `table_id`; `select enum_range(null::reservation_status);` includes `arrived`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260710120000_reservation_checkin.sql
git commit -m "feat(db): add checkin_token, arrived_at, table_id to reservations"
```

---

### Task 2: Check-in token generator (pure, TDD)

**Files:**
- Create: `api/_lib/checkinToken.js`
- Test: `tests/checkinToken.test.ts`

**Interfaces:**
- Produces: `export function generateCheckinToken(): string` — returns `r_` + 22 URL-safe base64 chars from `crypto.randomBytes(16)`. Used by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// tests/checkinToken.test.ts
import { describe, it, expect } from 'vitest';
import { generateCheckinToken } from '../api/_lib/checkinToken.js';

describe('generateCheckinToken', () => {
  it('starts with r_ and is URL-safe', () => {
    const t = generateCheckinToken();
    expect(t).toMatch(/^r_[A-Za-z0-9_-]{16,}$/);
  });
  it('is unique across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateCheckinToken()));
    expect(set.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/checkinToken.test.ts`
Expected: FAIL — cannot find module `../api/_lib/checkinToken.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// api/_lib/checkinToken.js
import crypto from 'node:crypto';

/** Unguessable, URL-safe reservation ticket id. */
export function generateCheckinToken() {
  const raw = crypto.randomBytes(16).toString('base64url'); // 22 chars, no +/=
  return `r_${raw}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkinToken.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/checkinToken.js tests/checkinToken.test.ts
git commit -m "feat(api): add checkin token generator"
```

---

### Task 3: Generate token on booking + return it

**Files:**
- Modify: `api/reservation.js` (insert block near line 48; response near line 152)

**Interfaces:**
- Consumes: `generateCheckinToken()` from Task 2.
- Produces: the reservation row now has `checkin_token`; the POST response includes `checkinToken`. Task 4 (email) and Task 8 (success redirect) consume it.

- [ ] **Step 1: Import the generator and create the token**

At the top of `api/reservation.js` add:
```js
import { generateCheckinToken } from './_lib/checkinToken.js';
```
Immediately before the `if (supabase)` insert block, add:
```js
const checkinToken = generateCheckinToken();
```

- [ ] **Step 2: Add token to the insert**

In the `.insert({ ... })` object (`api/reservation.js:48`), add the field:
```js
          notes: notes || '',
          checkin_token: checkinToken,
```

- [ ] **Step 3: Return the token in the response**

Change the success response (`api/reservation.js:152`) to:
```js
    return res.status(200).json({
      success: true,
      reservationId: resId,
      dbId,
      checkinToken,
    });
```

- [ ] **Step 4: Manual verification (no live DB needed in dev)**

Run the dev server (`npm run dev` / the project's `dev-server.mjs`) and POST a test reservation; confirm the JSON response contains a `checkinToken` matching `/^r_/`. If Supabase is unset it still returns the token (persist is skipped with a warning — that is expected).

- [ ] **Step 5: Commit**

```bash
git add api/reservation.js
git commit -m "feat(api): generate and return checkin_token on booking"
```

---

### Task 4: Reservation confirmation email with QR

**Files:**
- Modify: `api/email.js` (add `sendReservationConfirmationEmail`, reuse internal `sendEmail` at line 22)
- Modify: `api/reservation.js` (call it after a successful insert)
- Test: `tests/reservationEmail.test.ts`

**Interfaces:**
- Consumes: internal `sendEmail(to, subject, html)` (`api/email.js:22`), `qrcode` dep.
- Produces: `export async function sendReservationConfirmationEmail(reservation): Promise<{ sent: boolean, skipped?: string }>` where `reservation = { customer_name, customer_email, type, res_date, res_time, party_size, sunbeds, checkin_token }`. Called by Task 3's handler.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reservationEmail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { delete process.env.RESEND_API_KEY; });

import { sendReservationConfirmationEmail } from '../api/email.js';

describe('sendReservationConfirmationEmail', () => {
  it('skips silently in dev when RESEND_API_KEY is unset', async () => {
    const r = await sendReservationConfirmationEmail({
      customer_name: 'Sara', customer_email: 'sara@example.com',
      type: 'restaurant', res_date: '2026-07-15', res_time: '8:00 PM',
      party_size: 4, sunbeds: 0, checkin_token: 'r_testtoken',
    });
    expect(r.sent).toBe(false);
    expect(r.skipped).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reservationEmail.test.ts`
Expected: FAIL — `sendReservationConfirmationEmail` is not exported.

- [ ] **Step 3: Implement the sender**

Add to `api/email.js` (after `sendOrderConfirmationEmail`):
```js
import QRCode from 'qrcode';

const SITE_URL = process.env.SITE_URL || 'https://mazibeach.com';

/**
 * Email the guest a reservation confirmation with their QR ticket.
 * Dev-safe: returns { sent:false, skipped } when RESEND_API_KEY is unset
 * (sendEmail already guards, but we short-circuit to skip QR work too).
 */
export async function sendReservationConfirmationEmail(reservation) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: 'no RESEND_API_KEY' };
  }
  const ticketUrl = `${SITE_URL}/r/${reservation.checkin_token}`;
  const qrDataUrl = await QRCode.toDataURL(ticketUrl, { width: 260, margin: 2 });
  const partyLine = reservation.type === 'beach'
    ? `${reservation.sunbeds} sunbed(s)`
    : `Party of ${reservation.party_size}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0a0a0a">
      <h2 style="color:#0a4d4d">Mazi — Reservation Confirmed</h2>
      <p>Hi ${reservation.customer_name}, your table is booked.</p>
      <p><strong>${reservation.res_date}</strong> at <strong>${reservation.res_time}</strong><br/>${partyLine}</p>
      <p>Show this QR at the door to check in:</p>
      <img src="${qrDataUrl}" alt="Reservation QR" width="260" height="260" />
      <p><a href="${ticketUrl}">View / download your ticket</a></p>
    </div>`;

  await sendEmail(reservation.customer_email, 'Your Mazi reservation', html);
  return { sent: true };
}
```

- [ ] **Step 4: Call it from the booking handler**

In `api/reservation.js`, after the insert succeeds (inside the `else if (data)` branch where `dbId` is set, or right after the insert block), add a fire-and-forget call that never blocks the response:
```js
    try {
      await sendReservationConfirmationEmail({
        customer_name: name, customer_email: email,
        type: type === 'beach' ? 'beach' : 'restaurant',
        res_date: date, res_time: time,
        party_size: parseInt(partySize) || 0, sunbeds: parseInt(sunbeds) || 0,
        checkin_token: checkinToken,
      });
    } catch (e) { console.error('reservation email failed:', e); }
```
Add the import at the top: `import { sendReservationConfirmationEmail } from './email.js';`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/reservationEmail.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/email.js api/reservation.js tests/reservationEmail.test.ts
git commit -m "feat(api): send reservation confirmation email with QR ticket"
```

---

### Task 5: Public ticket endpoint `GET /api/reservation-ticket`

**Files:**
- Create: `api/reservation-ticket.js`

**Interfaces:**
- Produces: `GET /api/reservation-ticket?token=<t>` → `200 { name, type, res_date, res_time, party_size, sunbeds, status, arrived_at, table_label }` or `404 { error }`. Consumed by the `/r/:token` page (Task 7).

- [ ] **Step 1: Implement the endpoint**

```js
// api/reservation-ticket.js
import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'Missing token' });
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });

  const { data, error } = await supabase
    .from('reservations')
    .select('customer_name, type, res_date, res_time, party_size, sunbeds, status, arrived_at, table_id, tables(label)')
    .eq('checkin_token', token)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Ticket not found' });

  return res.status(200).json({
    name: data.customer_name,
    type: data.type,
    res_date: data.res_date,
    res_time: data.res_time,
    party_size: data.party_size,
    sunbeds: data.sunbeds,
    status: data.status,
    arrived_at: data.arrived_at,
    table_label: data.tables?.label ?? null,
  });
}
```

- [ ] **Step 2: Manual verification**

With a dev/local Supabase seeded with one reservation, run:
`curl "http://localhost:3000/api/reservation-ticket?token=<real token>"`
Expected: JSON with `name`, `status`, etc. Unknown token → HTTP 404. No token → 400.

- [ ] **Step 3: Commit**

```bash
git add api/reservation-ticket.js
git commit -m "feat(api): public reservation ticket lookup by token"
```

---

### Task 6: Check-in decision logic (pure, TDD) + endpoint

**Files:**
- Create: `api/_lib/evaluateCheckin.js`
- Create: `api/reservation-checkin.js`
- Test: `tests/evaluateCheckin.test.ts`

**Interfaces:**
- Produces:
  - `export function evaluateCheckin(reservation, { today, tableId }): { state, reason?, ... }` — pure. `state ∈ 'ok' | 'already' | 'invalid'`. `today` is `YYYY-MM-DD` (Africa/Cairo). Returns `{ state:'invalid', reason:'not_found' }` when `reservation` is null, `{ state:'invalid', reason:'wrong_day' }` when `reservation.res_date !== today`, `{ state:'invalid', reason:'no_table' }` when `!tableId`, `{ state:'already', arrived_at, table_id }` when already arrived, else `{ state:'ok' }`.
  - `POST /api/reservation-checkin` (admin-authed) body `{ token, tableId }` → applies the decision.
- Consumes: nothing from other tasks (pure logic); the endpoint uses Supabase + Telegram patterns from `api/reservation.js`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/evaluateCheckin.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCheckin } from '../api/_lib/evaluateCheckin.js';

const base = { res_date: '2026-07-15', status: 'confirmed', arrived_at: null, table_id: null };

describe('evaluateCheckin', () => {
  it('rejects unknown token', () => {
    expect(evaluateCheckin(null, { today: '2026-07-15', tableId: 't1' }))
      .toEqual({ state: 'invalid', reason: 'not_found' });
  });
  it('rejects wrong day', () => {
    expect(evaluateCheckin(base, { today: '2026-07-16', tableId: 't1' }).reason).toBe('wrong_day');
  });
  it('rejects missing table', () => {
    expect(evaluateCheckin(base, { today: '2026-07-15', tableId: '' }).reason).toBe('no_table');
  });
  it('reports already-arrived', () => {
    const arrived = { ...base, status: 'arrived', arrived_at: '2026-07-15T18:42:00Z', table_id: 'D12' };
    const r = evaluateCheckin(arrived, { today: '2026-07-15', tableId: 't1' });
    expect(r.state).toBe('already');
    expect(r.arrived_at).toBe('2026-07-15T18:42:00Z');
  });
  it('accepts a valid same-day check-in', () => {
    expect(evaluateCheckin(base, { today: '2026-07-15', tableId: 't1' })).toEqual({ state: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evaluateCheckin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

```js
// api/_lib/evaluateCheckin.js
/**
 * Decide what a check-in scan should do. Pure — no I/O.
 * @param reservation row or null (null = token not found)
 * @param ctx { today: 'YYYY-MM-DD' (venue-local), tableId: string }
 */
export function evaluateCheckin(reservation, { today, tableId }) {
  if (!reservation) return { state: 'invalid', reason: 'not_found' };
  if (reservation.status === 'arrived') {
    return { state: 'already', arrived_at: reservation.arrived_at, table_id: reservation.table_id };
  }
  if (reservation.res_date !== today) return { state: 'invalid', reason: 'wrong_day' };
  if (!tableId) return { state: 'invalid', reason: 'no_table' };
  return { state: 'ok' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/evaluateCheckin.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement the endpoint using the pure function**

```js
// api/reservation-checkin.js
import { createClient } from '@supabase/supabase-js';
import { evaluateCheckin } from './_lib/evaluateCheckin.js';

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mazi2025';

function cairoToday() {
  // en-CA yields YYYY-MM-DD; timeZone pins to venue-local calendar day.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function notifyTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('checkin telegram failed:', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth.replace(/^Bearer\s+/i, '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabase) return res.status(503).json({ error: 'Database not configured' });

  const { token, tableId } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const { data: reservation } = await supabase
    .from('reservations')
    .select('id, customer_name, type, res_date, res_time, party_size, sunbeds, status, arrived_at, table_id')
    .eq('checkin_token', token)
    .maybeSingle();

  const decision = evaluateCheckin(reservation, { today: cairoToday(), tableId });
  if (decision.state !== 'ok') return res.status(200).json(decision);

  // Resolve table label for the response + notification.
  const { data: table } = await supabase
    .from('tables').select('label').eq('id', tableId).maybeSingle();
  if (!table) return res.status(400).json({ error: 'Invalid table' });

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('reservations')
    .update({ status: 'arrived', arrived_at: nowIso, table_id: tableId })
    .eq('id', reservation.id);
  if (updErr) return res.status(500).json({ error: 'Check-in failed' });

  const partyLine = reservation.type === 'beach'
    ? `${reservation.sunbeds} sunbed(s)` : `party of ${reservation.party_size}`;
  await notifyTelegram(`✅ <b>${reservation.customer_name}</b>, ${partyLine}, seated at <b>${table.label}</b>`);

  return res.status(200).json({
    state: 'ok',
    reservation: { ...reservation, status: 'arrived', arrived_at: nowIso, table_id: tableId },
    table_label: table.label,
  });
}
```

- [ ] **Step 6: Manual verification**

- No/incorrect bearer → `curl -X POST .../api/reservation-checkin` returns 401.
- Valid bearer + today's reservation token + real tableId → 200 `{ state:'ok', table_label }`, and a second identical call returns `{ state:'already' }`.
- A token whose `res_date` is not today → `{ state:'invalid', reason:'wrong_day' }`.

- [ ] **Step 7: Commit**

```bash
git add api/_lib/evaluateCheckin.js api/reservation-checkin.js tests/evaluateCheckin.test.ts
git commit -m "feat(api): reservation check-in endpoint with pure decision logic"
```

---

### Task 7: Guest ticket page `/r/:token`

**Files:**
- Create: `src/app/pages/ReservationTicket.tsx`
- Modify: `src/app/App.tsx` (add route)

**Interfaces:**
- Consumes: `GET /api/reservation-ticket?token=` (Task 5), `qrcode` dep, `apiConfig` base URL (`src/lib/apiConfig.ts`).
- Produces: route `/r/:token`.

- [ ] **Step 1: Add the route**

In `src/app/App.tsx`, import and register outside the `Layout` wrapper (like `/track`):
```tsx
import ReservationTicketPage from './pages/ReservationTicket';
// ...inside <Routes>, as a sibling of <Route path="/track" ...>:
        <Route path="/r/:token" element={<ReservationTicketPage />} />
```

- [ ] **Step 2: Implement the page**

```tsx
// src/app/pages/ReservationTicket.tsx
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { API_BASE } from '../../lib/apiConfig';

type Ticket = {
  name: string; type: 'beach' | 'restaurant'; res_date: string; res_time: string;
  party_size: number; sunbeds: number; status: string;
  arrived_at: string | null; table_label: string | null;
};

export default function ReservationTicketPage() {
  const { token } = useParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/reservation-ticket?token=${token}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setTicket)
      .catch(() => setError('Ticket not found'));
  }, [token]);

  useEffect(() => {
    if (ticket && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, `https://mazibeach.com/r/${token}`, { width: 240, margin: 2 });
    }
  }, [ticket, token]);

  function download() {
    const url = canvasRef.current?.toDataURL('image/png');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `mazi-reservation-${token}.png`; a.click();
  }

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}>{error}</div>;
  if (!ticket) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;

  const arrived = ticket.status === 'arrived';
  const partyLine = ticket.type === 'beach' ? `${ticket.sunbeds} sunbed(s)` : `Party of ${ticket.party_size}`;

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: 24, textAlign: 'center', fontFamily: 'Montserrat, sans-serif' }}>
      <h1 style={{ color: '#0a4d4d' }}>Mazi</h1>
      <p>Reservation for <strong>{ticket.name}</strong></p>
      <p>{ticket.res_date} · {ticket.res_time} · {partyLine}</p>
      <canvas ref={canvasRef} aria-label="Reservation QR code" />
      <div style={{ margin: '12px 0', fontWeight: 600, color: arrived ? '#0a7d4d' : '#666' }}>
        {arrived ? `Checked in ✓${ticket.table_label ? ` · ${ticket.table_label}` : ''}` : 'Confirmed'}
      </div>
      <button onClick={download} style={{ padding: '10px 20px', background: '#0a4d4d', color: '#fff', border: 0, borderRadius: 8 }}>
        Download ticket
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify in the browser**

Run the dev server. Visit `/r/<a real token>`. Expected: booking details render, QR draws on the canvas, "Download ticket" saves a PNG, status shows `Confirmed` (or `Checked in ✓` after Task 6 runs). Unknown token → "Ticket not found".

- [ ] **Step 4: Commit**

```bash
git add src/app/pages/ReservationTicket.tsx src/app/App.tsx
git commit -m "feat(web): guest reservation ticket page /r/:token with downloadable QR"
```

---

### Task 8: Route to the ticket after booking

**Files:**
- Modify: `src/app/pages/Reservation.tsx` (success handler)

**Interfaces:**
- Consumes: the POST response `checkinToken` from Task 3.

- [ ] **Step 1: Use the returned token**

In `Reservation.tsx`, where the successful POST response is handled, capture `checkinToken` from the JSON and either navigate to `/r/${checkinToken}` or render a "View your ticket" link to it on the existing success screen. Keep the existing success UI; add the link:
```tsx
// after: const data = await res.json();
if (data.checkinToken) setTicketUrl(`/r/${data.checkinToken}`);
// in the success screen JSX, add:
{ticketUrl && <a href={ticketUrl}>View / download your QR ticket</a>}
```
Add `const [ticketUrl, setTicketUrl] = useState('');` with the other state.

- [ ] **Step 2: Verify**

Book a test reservation in the browser; the success screen shows a working "View your ticket" link that lands on `/r/<token>`.

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/Reservation.tsx
git commit -m "feat(web): link booking success to the QR ticket page"
```

---

### Task 9: Admin scanner `/admin/checkin`

**Files:**
- Create: `src/app/pages/admin/CheckinScanner.tsx`
- Modify: `src/app/App.tsx` (add `/admin/checkin` route, gated by existing admin auth)
- Modify: `package.json` (add `html5-qrcode`)

**Interfaces:**
- Consumes: `POST /api/reservation-checkin` (Task 6), admin bearer token from the existing admin session/login, table list from Supabase (reuse `adminService`/`SearchableSelect` patterns).
- Produces: route `/admin/checkin`.

- [ ] **Step 1: Add the dependency**

Run: `npm install html5-qrcode`
Expected: `html5-qrcode` appears in `package.json` dependencies.

- [ ] **Step 2: Add the route (admin-gated)**

In `src/app/App.tsx`, register `/admin/checkin` behind the same auth guard the admin panel uses (mirror how `/admin` is protected). If `/admin` uses an internal auth check inside `AdminPage`, wrap `CheckinScanner` the same way (e.g. render `AdminLogin` when unauthenticated).

- [ ] **Step 3: Implement the scanner**

```tsx
// src/app/pages/admin/CheckinScanner.tsx
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { API_BASE } from '../../../lib/apiConfig';
import { getAdminToken } from '../../../services/adminService'; // reuse existing token accessor
import SearchableSelect from './SearchableSelect';
import { listTables } from '../../../services/adminService'; // add if not present: returns {id,label,zone}[]

type Result =
  | { state: 'ok'; table_label: string; reservation: any }
  | { state: 'already'; arrived_at: string; table_id: string }
  | { state: 'invalid'; reason: string };

function tokenFromScan(text: string): string {
  // QR encodes https://mazibeach.com/r/<token>; also accept a bare token.
  const m = text.match(/\/r\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : text.trim();
}

export default function CheckinScanner() {
  const [scanned, setScanned] = useState('');
  const [manual, setManual] = useState('');
  const [tableId, setTableId] = useState('');
  const [tables, setTables] = useState<{ id: string; label: string; zone: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => { listTables().then(setTables).catch(() => {}); }, []);

  useEffect(() => {
    const scanner = new Html5Qrcode('reader');
    scannerRef.current = scanner;
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 },
      (text) => { setScanned(tokenFromScan(text)); scanner.pause(true); },
      () => {}).catch(() => {});
    return () => { scanner.stop().catch(() => {}); };
  }, []);

  async function checkin(token: string) {
    const res = await fetch(`${API_BASE}/api/reservation-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ token, tableId }),
    });
    setResult(await res.json());
  }

  const activeToken = scanned || manual;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h2>Door check-in</h2>
      <div id="reader" style={{ width: '100%' }} />

      <div style={{ margin: '12px 0' }}>
        <input placeholder="Or type code (r_…)" value={manual}
          onChange={(e) => setManual(e.target.value)} style={{ width: '100%', padding: 8 }} />
      </div>

      <SearchableSelect
        options={tables.map(t => ({ value: t.id, label: `${t.label} (${t.zone})` }))}
        value={tableId} onChange={setTableId} placeholder="Assign a table…" />

      <button disabled={!activeToken || !tableId} onClick={() => checkin(activeToken)}
        style={{ marginTop: 12, width: '100%', padding: 12, background: '#0a4d4d', color: '#fff', border: 0, borderRadius: 8 }}>
        Check in & seat
      </button>

      {result && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8,
          background: result.state === 'ok' ? '#e6f7ee' : result.state === 'already' ? '#fff7e6' : '#fdeaea' }}>
          {result.state === 'ok' && <span>✅ Seated at {result.table_label}</span>}
          {result.state === 'already' && <span>⚠️ Already arrived at {new Date(result.arrived_at).toLocaleTimeString()}</span>}
          {result.state === 'invalid' && <span>❌ {result.reason.replace('_', ' ')}</span>}
        </div>
      )}
    </div>
  );
}
```

Note for the implementer: `getAdminToken` and `listTables` must exist in `src/services/adminService.ts`. If `listTables` is missing, add a small function there that selects `id,label,zone` from the `tables` table (mirror the existing admin queries). If admin auth is stored differently (e.g. in context/localStorage under a known key), use that accessor instead of `getAdminToken`.

- [ ] **Step 4: Verify on a phone / mobile emulation**

Load `/admin/checkin` while logged into admin. Grant camera permission. Point at a ticket QR from Task 7 → the code populates. Pick a table → "Check in & seat" → green ✅ with the table label. Scan the same QR again → amber "already arrived". Type a bogus code → red "not found".

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/admin/CheckinScanner.tsx src/app/App.tsx package.json package-lock.json src/services/adminService.ts
git commit -m "feat(web): admin camera scanner for reservation check-in"
```

---

### Task 10: End-to-end live test + docs

**Files:**
- Modify: `docs/` note or `README` section describing the check-in flow (brief).

- [ ] **Step 1: Full-suite unit run**

Run: `npm test`
Expected: all vitest tests pass, including `checkinToken`, `reservationEmail`, `evaluateCheckin`.

- [ ] **Step 2: Live flow test (requires a working Supabase — see plan prerequisite)**

Using `/browse` against the running app: book a reservation → open the success ticket link → download the QR PNG → open `/admin/checkin` → scan → confirm `arrived` state, table assignment, Telegram payload (if configured), and that a second scan is rejected as already-arrived.

- [ ] **Step 3: Document the flow**

Add a short "Reservation check-in" section to the project docs: the guest ticket URL shape, the admin scanner route, and the required env (`RESEND_API_KEY`, `ADMIN_PASSWORD`, Telegram vars, Supabase).

- [ ] **Step 4: Commit**

```bash
git add docs README.md
git commit -m "docs: reservation check-in flow and env requirements"
```

---

## Prerequisite (before Task 10 live test / production)

The deployed Supabase (`mmjjphgzzhdifvkrokxz.supabase.co`) is dead (NXDOMAIN). Reconnect a working project (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), run the init schema + Task 1 migration, and re-seed `tables`. Tasks 1–9 build and unit-test without production; Task 10's live test needs it.

## Self-Review

- **Spec coverage:** token (T2,T3) ✓; on-screen downloadable ticket (T7) ✓; email delivery (T4) ✓; camera scanner + manual fallback (T9) ✓; mark arrived + details + Telegram + block dup/invalid (T6) ✓; table assignment at check-in (T6,T9) ✓; security/auth + date window (T6, Global Constraints) ✓; Supabase prerequisite (Prerequisite) ✓; out-of-scope items excluded ✓.
- **Placeholders:** none — every code step shows real code; UI tasks note the two accessors (`getAdminToken`, `listTables`) that the implementer must confirm/create against the existing admin service.
- **Type consistency:** `checkin_token` (db) ↔ `checkinToken` (JSON) used consistently; `evaluateCheckin` state values `ok|already|invalid` match the endpoint and scanner; `state:'invalid'` reasons `not_found|wrong_day|no_table` match tests and UI.
