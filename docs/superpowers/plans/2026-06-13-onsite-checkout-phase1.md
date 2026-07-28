# On-Site Confirmed Checkout (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WhatsApp checkout handoff with an on-site confirmed sale: a new Vercel/Next.js backend validates the order (mandatory email), reuses the existing Apps Script `placeOrder` for capacity + storage + calendar + customer email, fans out a Telegram push with one-tap owner status buttons, and the React site shows a done screen with per-method payment instructions (Cash / Card-on-delivery / Instapay).

**Architecture:** Approach A — Vercel orchestrates, Apps Script stays the capacity + storage authority (Google Sheets remains the single source of truth). The Vercel backend is intentionally thin: a `/api/order` proxy that calls Apps Script and fires Telegram, plus a `/api/telegram/webhook` that turns button taps into Apps Script status changes via a new token-keyed setter. No payment gateway anywhere — card is paid on the driver's POS at delivery.

**Tech Stack:** New Next.js 16 (App Router, nodejs runtime) backend in `vercel-app/` with vitest; existing Apps Script (`apps-script/admin-api.gs`) + Google Sheets; existing React 18 + Vite frontend.

**Spec:** `docs/superpowers/specs/2026-06-13-onsite-checkout-phase1-design.md`

---

## Critical context for the implementer

1. **Two backends, one source of truth.** Order data lives in Google Sheets via Apps Script. The Vercel backend NEVER stores orders — it calls Apps Script. Capacity, the admin OrdersTab, and the kitchen calendar are unchanged and keep working.
2. **Apps Script call style.** The Apps Script web app is called with **GET** and query params (POST bodies are lost in Google's 302 redirect). Server-side `fetch(url, { redirect: 'follow' })` works. The existing deployment URL is in `src/services/orderService.ts` (`CRM_ENDPOINT`). The admin password for gated actions is `Bistro001` (admin role) — in Vercel it comes from `APPS_SCRIPT_ADMIN_PASSWORD`.
3. **Existing `placeOrder` contract** (`apps-script/admin-api.gs`, function `orderPlace`): GET params `action=placeOrder, name, phone, email, address, deliveryArea, orderTotal, orderSummary, itemCount, deliverySlot, expectedStatus`. Returns `{success:true, status:'confirmed'|'pending_approval', trackingToken, deliverySlot, deliveryDate}` or `{success:false, code:'slot_full'|'slot_unavailable'|'busy_retry'|'daily_limit', availability?}`. This task set ADDS a `channel` param and an `id` to the success return.
4. **Telegram `callback_data` ≤ 64 bytes.** We use `"<action>:<trackingToken>"` (action ≤ 10 chars + a 36-char UUID = ≤ 47 bytes). Fine.
5. **CORS.** The frontend (`https://bistro-cloud.com`) calls the Vercel backend cross-origin. `/api/order` must answer `OPTIONS` preflight and send `Access-Control-Allow-Origin`. The Telegram webhook is server-to-server (no CORS needed).
6. **The Vercel app is a separate npm project** with its own `package.json` and `node_modules` under `vercel-app/`. Its tests run from inside `vercel-app/` (`cd vercel-app && npm test`). The repo root's vitest (20 tests) is unaffected.
7. **Reuse source:** the cloned reference is at `/tmp/holistic-beauty/vercel-app` (Telegram client, webhook security, validation regexes). Port patterns, simplify — do NOT port its AI assistant, Blob storage, or Resend email.
8. **Deploy is manual/user-assisted** (Task 12): a Vercel project, env vars, and a Telegram `setWebhook` registration. All code tasks are TDD'd locally first.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `vercel-app/package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore` | Create | New Next.js project scaffold + test runner. |
| `vercel-app/src/lib/validation.ts` | Create | Pure payload validation (mandatory email, fields). Unit-tested. |
| `vercel-app/src/lib/appsScript.ts` | Create | Server-side client for Apps Script `placeOrder` + `setOrderStatusByToken`. |
| `vercel-app/src/lib/telegram.ts` | Create | Minimal Telegram Bot API client (sendMessage, editMessageText, answerCallbackQuery, inline keyboard). |
| `vercel-app/src/lib/orderMessage.ts` | Create | Build the Telegram order text + status inline keyboard. Unit-tested. |
| `vercel-app/src/lib/cors.ts` | Create | CORS headers + preflight helper. |
| `vercel-app/src/app/api/order/route.ts` | Create | POST: validate → Apps Script placeOrder → Telegram push → result. |
| `vercel-app/src/app/api/telegram/webhook/route.ts` | Create | POST: verify secret → callback button → setOrderStatusByToken → edit message. |
| `apps-script/admin-api.gs` | Modify | `channel=web` flag on `orderPlace` (skip internal owner email; add `id` to result); new `orderSetStatusByToken` + `setOrderStatusByToken` action. |
| `src/services/orderService.ts` | Modify | Add `placeOrderOnSite(input)` posting to the Vercel backend + types. |
| `src/app/components/CartDrawer.tsx` | Modify | Mandatory email; 3 payment methods; "Place Order" → POST; done view. |
| `src/config.ts` | Create | Frontend config: the Vercel API base URL. |

---

# PART A — Vercel backend

### Task 1: Scaffold the Vercel/Next.js project

**Files:**
- Create: `vercel-app/package.json`, `vercel-app/tsconfig.json`, `vercel-app/next.config.ts`, `vercel-app/vitest.config.ts`, `vercel-app/.env.example`, `vercel-app/.gitignore`, `vercel-app/src/app/api/health/route.ts`

- [ ] **Step 1: Create `vercel-app/package.json`**

```json
{
  "name": "bistro-cloud-orders",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "16.2.9",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create `vercel-app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `vercel-app/next.config.ts`**

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: Create `vercel-app/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 5: Create `vercel-app/.env.example`**

```
# Apps Script web app (existing Bistro Cloud CRM API)
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec
APPS_SCRIPT_ADMIN_PASSWORD=Bistro001
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
# Instapay bank details shown to the customer (free text)
INSTAPAY_DETAILS=Bistro Cloud — Bank: CIB, Account: 100012345678, Name: Bistro Cloud
# Allowed browser origin for CORS
ALLOWED_ORIGIN=https://bistro-cloud.com
```

- [ ] **Step 6: Create `vercel-app/.gitignore`**

```
/node_modules
/.next
/out
.env*.local
.vercel
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 7: Create a health route `vercel-app/src/app/api/health/route.ts`**

```ts
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, service: "bistro-cloud-orders" });
}
```

- [ ] **Step 8: Install and verify**

Run: `cd vercel-app && npm install`
Expected: installs without error.

Run: `cd vercel-app && npm test`
Expected: vitest runs, "No test files found" (exit 1 is fine — no tests yet).

- [ ] **Step 9: Commit**

```bash
git add vercel-app/package.json vercel-app/package-lock.json vercel-app/tsconfig.json vercel-app/next.config.ts vercel-app/vitest.config.ts vercel-app/.env.example vercel-app/.gitignore vercel-app/src/app/api/health/route.ts
git commit -m "feat(vercel): scaffold orders backend (Next.js + vitest)"
```

---

### Task 2: Payload validation (`lib/validation.ts`) — TDD

**Files:**
- Create: `vercel-app/src/lib/validation.ts`
- Test: `vercel-app/src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `vercel-app/src/lib/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateOrderPayload } from "./validation";

const valid = {
  items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
  name: "Sara Ali",
  phone: "+201001234567",
  email: "sara@example.com",
  address: "12 West Golf, El Gouna",
  deliverySlot: "14:30",
  expectedStatus: "open",
  paymentMethod: "cod",
  note: "",
};

describe("validateOrderPayload", () => {
  it("accepts a valid payload and normalizes it", () => {
    const r = validateOrderPayload(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("sara@example.com");
      expect(r.value.itemCount).toBe(2);
      expect(r.value.orderTotal).toBe(400);
      expect(r.value.orderSummary).toContain("2x Grilled Chicken");
      expect(r.value.paymentMethod).toBe("cod");
    }
  });

  it("REQUIRES email (the key Phase 1 rule)", () => {
    expect(validateOrderPayload({ ...valid, email: "" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, email: "not-an-email" }).ok).toBe(false);
    const { email, ...noEmail } = valid;
    expect(validateOrderPayload(noEmail).ok).toBe(false);
  });

  it("rejects missing/short name, bad phone, short address", () => {
    expect(validateOrderPayload({ ...valid, name: "" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, name: "A" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, phone: "abc" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, address: "x" }).ok).toBe(false);
  });

  it("rejects an empty cart and an over-large cart", () => {
    expect(validateOrderPayload({ ...valid, items: [] }).ok).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ name: "x", quantity: 1, price: 1 }));
    expect(validateOrderPayload({ ...valid, items: many }).ok).toBe(false);
  });

  it("only allows the three Phase-1 payment methods", () => {
    expect(validateOrderPayload({ ...valid, paymentMethod: "cod" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "card_on_delivery" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "instapay" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "bitcoin" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, paymentMethod: "card_online" }).ok).toBe(false);
  });

  it("validates deliverySlot format and expectedStatus", () => {
    expect(validateOrderPayload({ ...valid, deliverySlot: "2pm" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, expectedStatus: "maybe" }).ok).toBe(false);
  });

  it("clamps item quantities and rejects non-positive", () => {
    expect(validateOrderPayload({ ...valid, items: [{ name: "x", quantity: 0, price: 5 }] }).ok).toBe(false);
    const r = validateOrderPayload({ ...valid, items: [{ name: "x", quantity: 1000, price: 5 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.itemCount).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/validation.test.ts`
Expected: FAIL — cannot resolve `./validation`.

- [ ] **Step 3: Implement `vercel-app/src/lib/validation.ts`**

```ts
/**
 * Pure validation for the on-site order payload. Mandatory email is the
 * headline Phase 1 rule. Mirrors the field rules from the Holistic Beauty
 * reference, adapted for restaurant orders + the 3 settle-on-delivery
 * payment methods. No payment gateway: paymentMethod is informational.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{8,17}$/;
const SLOT_RE = /^\d{1,2}:\d{2}$/;
const MAX_DISTINCT_ITEMS = 50;
const MAX_EMAIL_LEN = 120;
const MAX_ITEM_COUNT = 200;

export type PaymentMethod = "cod" | "card_on_delivery" | "instapay";
const PAYMENT_METHODS: PaymentMethod[] = ["cod", "card_on_delivery", "instapay"];

export interface ValidatedOrder {
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  deliverySlot: string;
  expectedStatus: "open" | "busy";
  paymentMethod: PaymentMethod;
  itemCount: number;
  orderTotal: number;
  orderSummary: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedOrder }
  | { ok: false; error: string };

interface RawItem { name?: unknown; quantity?: unknown; price?: unknown }

export function validateOrderPayload(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const rawItems = b.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "Cart is empty." };
  }
  if (rawItems.length > MAX_DISTINCT_ITEMS) {
    return { ok: false, error: "Too many distinct items." };
  }
  let itemCount = 0;
  let orderTotal = 0;
  const summaryLines: string[] = [];
  for (const raw of rawItems as RawItem[]) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const qty = Math.floor(Number(raw.quantity));
    const price = Number(raw.price);
    if (!name || !Number.isFinite(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
      return { ok: false, error: "Invalid cart item." };
    }
    itemCount += qty;
    orderTotal += qty * price;
    summaryLines.push(`${qty}x ${name} (${qty * price} EGP)`);
  }
  if (itemCount > MAX_ITEM_COUNT) itemCount = MAX_ITEM_COUNT;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Name is required." };

  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  if (!PHONE_RE.test(phone)) return { ok: false, error: "A valid phone number is required." };

  // MANDATORY email — the Phase 1 rule.
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email is required for order updates." };
  }

  const address = typeof b.address === "string" ? b.address.trim() : "";
  if (address.length < 5 || address.length > 400) return { ok: false, error: "A delivery address is required." };

  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";

  const deliverySlot = typeof b.deliverySlot === "string" ? b.deliverySlot.trim() : "";
  if (!SLOT_RE.test(deliverySlot)) return { ok: false, error: "Pick a delivery time." };

  const expectedStatus = b.expectedStatus === "busy" ? "busy" : b.expectedStatus === "open" ? "open" : null;
  if (!expectedStatus) return { ok: false, error: "Invalid slot state." };

  const paymentMethod = b.paymentMethod as PaymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) return { ok: false, error: "Pick a payment method." };

  return {
    ok: true,
    value: { name, phone, email, address, note, deliverySlot, expectedStatus, paymentMethod, itemCount, orderTotal, orderSummary: summaryLines.join("\n") },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/validation.ts vercel-app/src/lib/validation.test.ts
git commit -m "feat(vercel): order payload validation with mandatory email (TDD)"
```

---

### Task 3: Apps Script client (`lib/appsScript.ts`)

**Files:**
- Create: `vercel-app/src/lib/appsScript.ts`
- Test: `vercel-app/src/lib/appsScript.test.ts`

- [ ] **Step 1: Write the failing test** (mocks global fetch)

Create `vercel-app/src/lib/appsScript.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { placeOrder, setOrderStatusByToken } from "./appsScript";

const ORIG = { ...process.env };

beforeEach(() => {
  process.env.APPS_SCRIPT_URL = "https://script.example/exec";
  process.env.APPS_SCRIPT_ADMIN_PASSWORD = "secret";
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

function mockFetchOnce(json: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("placeOrder", () => {
  it("calls Apps Script with channel=web and returns the parsed result", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed", trackingToken: "tok-1", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 123 });
    const res = await placeOrder({
      name: "Sara", phone: "+201001234567", email: "s@e.com", address: "12 West Golf",
      orderTotal: 400, orderSummary: "2x X", itemCount: 2, deliverySlot: "14:30", expectedStatus: "open",
    });
    expect(res.success).toBe(true);
    const calledUrl = (spy.mock.calls[0][0] as string);
    expect(calledUrl).toContain("action=placeOrder");
    expect(calledUrl).toContain("channel=web");
    expect(calledUrl).toContain("deliverySlot=14%3A30");
  });

  it("passes through a failure code", async () => {
    mockFetchOnce({ success: false, code: "slot_full" });
    const res = await placeOrder({
      name: "S", phone: "+201001234567", email: "s@e.com", address: "addr addr",
      orderTotal: 1, orderSummary: "x", itemCount: 1, deliverySlot: "14:30", expectedStatus: "open",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.code).toBe("slot_full");
  });
});

describe("setOrderStatusByToken", () => {
  it("calls the gated action with password, token and status", async () => {
    const spy = mockFetchOnce({ success: true, status: "confirmed" });
    const res = await setOrderStatusByToken("tok-1", "confirmed");
    expect(res.success).toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("action=setOrderStatusByToken");
    expect(url).toContain("token=tok-1");
    expect(url).toContain("status=confirmed");
    expect(url).toContain("password=secret");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: FAIL — cannot resolve `./appsScript`.

- [ ] **Step 3: Implement `vercel-app/src/lib/appsScript.ts`**

```ts
/**
 * Server-side client for the existing Bistro Cloud Apps Script web app.
 * GET-only (POST bodies are lost in Google's 302 redirect). The Apps Script
 * remains the capacity + storage + calendar + customer-email authority;
 * this client just drives it.
 */

export interface PlaceOrderInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  orderTotal: number;
  orderSummary: string;
  itemCount: number;
  deliverySlot: string;
  expectedStatus: "open" | "busy";
}

export type PlaceOrderResult =
  | { success: true; status: "confirmed" | "pending_approval"; trackingToken: string; deliverySlot: string; deliveryDate: string; id?: number }
  | { success: false; code: "slot_full" | "slot_unavailable" | "busy_retry" | "daily_limit"; error?: string };

function endpoint(): string {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error("APPS_SCRIPT_URL is not configured");
  return url;
}

async function appsScriptGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${endpoint()}?${qs}`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  return appsScriptGet<PlaceOrderResult>({
    action: "placeOrder",
    channel: "web",
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    deliveryArea: "El Gouna",
    orderTotal: String(input.orderTotal),
    orderSummary: input.orderSummary,
    itemCount: String(input.itemCount),
    deliverySlot: input.deliverySlot,
    expectedStatus: input.expectedStatus,
  });
}

export type OrderStatus =
  | "pending_approval" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "declined" | "cancelled";

export async function setOrderStatusByToken(token: string, status: OrderStatus): Promise<{ success: boolean; status?: string; error?: string }> {
  const password = process.env.APPS_SCRIPT_ADMIN_PASSWORD;
  if (!password) throw new Error("APPS_SCRIPT_ADMIN_PASSWORD is not configured");
  return appsScriptGet({ action: "setOrderStatusByToken", password, token, status });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/appsScript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/appsScript.ts vercel-app/src/lib/appsScript.test.ts
git commit -m "feat(vercel): Apps Script client (placeOrder channel=web, setOrderStatusByToken)"
```

---

### Task 4: Telegram client (`lib/telegram.ts`)

**Files:**
- Create: `vercel-app/src/lib/telegram.ts`

(No unit test — it's a thin fetch wrapper; it is exercised via the route tests with fetch mocked.)

- [ ] **Step 1: Implement `vercel-app/src/lib/telegram.ts`** (ported + simplified from the reference)

```ts
/**
 * Minimal Telegram Bot API client (ported/simplified from the Holistic
 * Beauty reference). Plain-text messages (no parse_mode) so unbalanced
 * entities can never bounce. Every call returns a result object or throws on
 * transport error — callers decide what is fatal. For order pushes, failure
 * is non-fatal (the order is already placed).
 */

const API_BASE = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function botUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return `${API_BASE}/bot${token}/${method}`;
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramResult {
  ok: boolean;
  status: number;
  result?: unknown;
  description?: string;
}

async function call(method: string, payload: Record<string, unknown>): Promise<TelegramResult> {
  const res = await fetch(botUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`[telegram] ${method} failed (${res.status}): ${String(data.description).slice(0, 300)}`);
  }
  return { ok: Boolean(data.ok), status: res.status, result: data.result, description: data.description };
}

export function sendMessage(chatId: string | number, text: string, keyboard?: InlineKeyboard): Promise<TelegramResult> {
  const payload: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  return call("sendMessage", payload);
}

export function editMessageText(chatId: string | number, messageId: number, text: string): Promise<TelegramResult> {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramResult> {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}
```

- [ ] **Step 2: Type-check**

Run: `cd vercel-app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vercel-app/src/lib/telegram.ts
git commit -m "feat(vercel): minimal Telegram Bot API client"
```

---

### Task 5: Order Telegram message + keyboard (`lib/orderMessage.ts`) — TDD

**Files:**
- Create: `vercel-app/src/lib/orderMessage.ts`
- Test: `vercel-app/src/lib/orderMessage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `vercel-app/src/lib/orderMessage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOrderMessage, keyboardForStatus, actionToStatus, slotLabel } from "./orderMessage";

const order = {
  name: "Sara Ali",
  phone: "+201001234567",
  email: "sara@example.com",
  address: "12 West Golf",
  orderSummary: "2x Grilled Chicken (400 EGP)",
  orderTotal: 400,
  itemCount: 2,
  deliverySlot: "14:30",
  paymentMethod: "card_on_delivery" as const,
  trackingToken: "abc-123",
  status: "confirmed" as const,
};

describe("buildOrderMessage", () => {
  it("includes name, slot label, total, payment, and items", () => {
    const t = buildOrderMessage(order);
    expect(t).toContain("Sara Ali");
    expect(t).toContain("2:30 PM");
    expect(t).toContain("400 EGP");
    expect(t).toContain("Card on delivery");
    expect(t).toContain("Grilled Chicken");
    expect(t).toContain("+201001234567");
  });
});

describe("keyboardForStatus", () => {
  it("offers Approve/Decline for pending_approval, carrying the token", () => {
    const k = keyboardForStatus("pending_approval", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "approve:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "decline:abc-123")).toBe(true);
  });

  it("offers Preparing + Cancel for confirmed", () => {
    const k = keyboardForStatus("confirmed", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "preparing:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "cancel:abc-123")).toBe(true);
  });

  it("offers Delivered for out_for_delivery and no buttons for terminal states", () => {
    expect(keyboardForStatus("out_for_delivery", "t").inline_keyboard.flat().some((b) => b.callback_data === "delivered:t")).toBe(true);
    expect(keyboardForStatus("delivered", "t").inline_keyboard.flat().length).toBe(0);
  });
});

describe("actionToStatus", () => {
  it("maps each button action to a status", () => {
    expect(actionToStatus("approve")).toBe("confirmed");
    expect(actionToStatus("decline")).toBe("declined");
    expect(actionToStatus("preparing")).toBe("preparing");
    expect(actionToStatus("otd")).toBe("out_for_delivery");
    expect(actionToStatus("delivered")).toBe("delivered");
    expect(actionToStatus("cancel")).toBe("cancelled");
    expect(actionToStatus("bogus")).toBeNull();
  });
});

describe("slotLabel", () => {
  it("formats 24h to 12h", () => {
    expect(slotLabel("14:30")).toBe("2:30 PM");
    expect(slotLabel("20:00")).toBe("8:00 PM");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd vercel-app && npx vitest run src/lib/orderMessage.test.ts`
Expected: FAIL — cannot resolve `./orderMessage`.

- [ ] **Step 3: Implement `vercel-app/src/lib/orderMessage.ts`**

```ts
import type { InlineKeyboard } from "./telegram";
import type { OrderStatus } from "./appsScript";

export interface OrderForMessage {
  name: string;
  phone: string;
  email: string;
  address: string;
  orderSummary: string;
  orderTotal: number;
  itemCount: number;
  deliverySlot: string;
  paymentMethod: "cod" | "card_on_delivery" | "instapay";
  trackingToken: string;
  status: OrderStatus;
}

const PAYMENT_LABEL: Record<OrderForMessage["paymentMethod"], string> = {
  cod: "Cash on delivery",
  card_on_delivery: "Card on delivery (POS)",
  instapay: "Instapay (bank transfer)",
};

export function slotLabel(slot: string): string {
  const [hStr, mStr] = slot.split(":");
  const h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

export function buildOrderMessage(o: OrderForMessage): string {
  const header = o.status === "pending_approval"
    ? "🟠 NEW ORDER (busy slot — needs approval)"
    : "🟢 NEW ORDER (confirmed)";
  return [
    header,
    "",
    `👤 ${o.name}  ·  ${o.phone}`,
    `✉️ ${o.email}`,
    `📍 ${o.address}`,
    `🕒 ${slotLabel(o.deliverySlot)} today`,
    `💳 ${PAYMENT_LABEL[o.paymentMethod]}`,
    "",
    o.orderSummary,
    "",
    `Total: ${o.orderTotal} EGP  ·  ${o.itemCount} item(s)`,
  ].join("\n");
}

const ACTION_STATUS: Record<string, OrderStatus> = {
  approve: "confirmed",
  decline: "declined",
  preparing: "preparing",
  otd: "out_for_delivery",
  delivered: "delivered",
  cancel: "cancelled",
};

export function actionToStatus(action: string): OrderStatus | null {
  return ACTION_STATUS[action] ?? null;
}

function btn(text: string, action: string, token: string) {
  return { text, callback_data: `${action}:${token}` };
}

export function keyboardForStatus(status: OrderStatus, token: string): InlineKeyboard {
  switch (status) {
    case "pending_approval":
      return { inline_keyboard: [[btn("✅ Approve", "approve", token), btn("❌ Decline", "decline", token)]] };
    case "confirmed":
      return { inline_keyboard: [[btn("👨‍🍳 Preparing", "preparing", token), btn("🚫 Cancel", "cancel", token)]] };
    case "preparing":
      return { inline_keyboard: [[btn("🛵 Out for delivery", "otd", token), btn("🚫 Cancel", "cancel", token)]] };
    case "out_for_delivery":
      return { inline_keyboard: [[btn("📦 Delivered", "delivered", token)]] };
    default:
      return { inline_keyboard: [] };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd vercel-app && npx vitest run src/lib/orderMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/lib/orderMessage.ts vercel-app/src/lib/orderMessage.test.ts
git commit -m "feat(vercel): Telegram order message + status keyboard (TDD)"
```

---

### Task 6: CORS helper (`lib/cors.ts`)

**Files:**
- Create: `vercel-app/src/lib/cors.ts`

- [ ] **Step 1: Implement `vercel-app/src/lib/cors.ts`**

```ts
/** CORS for the browser-facing /api/order endpoint. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://bistro-cloud.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function jsonWithCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `cd vercel-app && npx tsc --noEmit`
Expected: no errors.

```bash
git add vercel-app/src/lib/cors.ts
git commit -m "feat(vercel): CORS helper for the order endpoint"
```

---

### Task 7: `/api/order` route — TDD

**Files:**
- Create: `vercel-app/src/app/api/order/route.ts`
- Test: `vercel-app/src/app/api/order/route.test.ts`

- [ ] **Step 1: Write the failing test** (mocks appsScript + telegram modules)

Create `vercel-app/src/app/api/order/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/telegram", () => ({ telegramConfigured: vi.fn(() => true), sendMessage: vi.fn(async () => ({ ok: true, status: 200 })) }));

import { POST, OPTIONS } from "./route";
import { placeOrder } from "@/lib/appsScript";
import { sendMessage } from "@/lib/telegram";

function req(body: unknown): Request {
  return new Request("https://api.test/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
  name: "Sara Ali", phone: "+201001234567", email: "sara@example.com",
  address: "12 West Golf, El Gouna", deliverySlot: "14:30", expectedStatus: "open", paymentMethod: "instapay",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  process.env.INSTAPAY_DETAILS = "Bank: CIB, Acct: 100012345678";
});

describe("POST /api/order", () => {
  it("rejects a payload without email (mandatory) and never calls Apps Script", async () => {
    const res = await POST(req({ ...validBody, email: "" }));
    expect(res.status).toBe(400);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("places a confirmed order, fires Telegram, returns instapay details", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "tok-9", deliverySlot: "14:30", deliveryDate: "2026-06-13", id: 1 });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("confirmed");
    expect(json.trackingToken).toBe("tok-9");
    expect(json.instapay).toContain("CIB");
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("does NOT include instapay details for non-instapay methods", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    const res = await POST(req({ ...validBody, paymentMethod: "cod" }));
    const json = await res.json();
    expect(json.instapay).toBeUndefined();
  });

  it("relays a capacity failure code as 409 and does not fire Telegram", async () => {
    (placeOrder as any).mockResolvedValue({ success: false, code: "slot_full" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("slot_full");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("survives a Telegram failure (order already placed → still 200)", async () => {
    (placeOrder as any).mockResolvedValue({ success: true, status: "confirmed", trackingToken: "t", deliverySlot: "14:30", deliveryDate: "2026-06-13" });
    (sendMessage as any).mockRejectedValue(new Error("telegram down"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 502 if Apps Script throws", async () => {
    (placeOrder as any).mockRejectedValue(new Error("network"));
    const res = await POST(req(validBody));
    expect(res.status).toBe(502);
  });

  it("answers OPTIONS preflight with CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd vercel-app && npx vitest run src/app/api/order/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `vercel-app/src/app/api/order/route.ts`**

```ts
import { validateOrderPayload } from "@/lib/validation";
import { placeOrder } from "@/lib/appsScript";
import { telegramConfigured, sendMessage } from "@/lib/telegram";
import { buildOrderMessage, keyboardForStatus } from "@/lib/orderMessage";
import { preflight, jsonWithCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ ok: false, error: "Invalid JSON." }, 400);
  }

  const v = validateOrderPayload(body);
  if (!v.ok) {
    return jsonWithCors({ ok: false, error: v.error }, 400);
  }
  const order = v.value;

  let result;
  try {
    result = await placeOrder({
      name: order.name, phone: order.phone, email: order.email, address: order.address,
      orderTotal: order.orderTotal, orderSummary: order.orderSummary, itemCount: order.itemCount,
      deliverySlot: order.deliverySlot, expectedStatus: order.expectedStatus,
    });
  } catch (err) {
    console.error("[order] Apps Script call failed:", err);
    return jsonWithCors({ ok: false, error: "We couldn't reach our ordering system. Please try again." }, 502);
  }

  if (!result.success) {
    // Capacity/availability rejection — relay the code so the UI reacts.
    return jsonWithCors({ ok: false, code: result.code }, 409);
  }

  // Fan-out: Telegram push to the owner (non-fatal).
  if (telegramConfigured() && process.env.TELEGRAM_OWNER_CHAT_ID) {
    try {
      const text = buildOrderMessage({
        name: order.name, phone: order.phone, email: order.email, address: order.address,
        orderSummary: order.orderSummary, orderTotal: order.orderTotal, itemCount: order.itemCount,
        deliverySlot: order.deliverySlot, paymentMethod: order.paymentMethod,
        trackingToken: result.trackingToken, status: result.status,
      });
      await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID, text, keyboardForStatus(result.status, result.trackingToken));
    } catch (err) {
      console.error("[order] Telegram push failed (non-fatal):", err);
    }
  }

  const response: Record<string, unknown> = {
    ok: true,
    status: result.status,
    trackingToken: result.trackingToken,
    deliverySlot: result.deliverySlot,
    paymentMethod: order.paymentMethod,
  };
  if (order.paymentMethod === "instapay") {
    response.instapay = process.env.INSTAPAY_DETAILS || "Ask us for bank transfer details.";
  }
  return jsonWithCors(response, 200);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd vercel-app && npx vitest run src/app/api/order/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel-app/src/app/api/order/route.ts vercel-app/src/app/api/order/route.test.ts
git commit -m "feat(vercel): /api/order — validate, place via Apps Script, Telegram fan-out (TDD)"
```

---

### Task 8: `/api/telegram/webhook` route — TDD

**Files:**
- Create: `vercel-app/src/app/api/telegram/webhook/route.ts`
- Test: `vercel-app/src/app/api/telegram/webhook/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `vercel-app/src/app/api/telegram/webhook/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/appsScript", () => ({ setOrderStatusByToken: vi.fn(async () => ({ success: true, status: "confirmed" })) }));
vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: vi.fn(async () => ({ ok: true, status: 200 })),
  editMessageText: vi.fn(async () => ({ ok: true, status: 200 })),
}));

import { POST } from "./route";
import { setOrderStatusByToken } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram";

const SECRET = "hook-secret";

function update(data: string) {
  return {
    update_id: 1,
    callback_query: { id: "cb1", data, message: { message_id: 55, chat: { id: 999 }, text: "NEW ORDER" } },
  };
}

function req(body: unknown, secret = SECRET): Request {
  return new Request("https://api.test/api/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "tok";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

describe("POST /api/telegram/webhook", () => {
  it("rejects a bad secret with 401 and changes nothing", async () => {
    const res = await POST(req(update("approve:tok-1"), "wrong-secret"));
    expect(res.status).toBe(401);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("maps an Approve tap to setOrderStatusByToken(confirmed) and edits the message", async () => {
    const res = await POST(req(update("approve:tok-abc")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).toHaveBeenCalledWith("tok-abc", "confirmed");
    expect(editMessageText).toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it("maps cancel and delivered actions", async () => {
    await POST(req(update("cancel:t1")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t1", "cancelled");
    await POST(req(update("delivered:t2")));
    expect(setOrderStatusByToken).toHaveBeenCalledWith("t2", "delivered");
  });

  it("ignores an unknown action but still answers 200 (no redelivery)", async () => {
    const res = await POST(req(update("bogus:t1")));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });

  it("answers 200 for a non-callback update (e.g. a plain message)", async () => {
    const res = await POST(req({ update_id: 2, message: { message_id: 1, chat: { id: 1 }, text: "hi" } }));
    expect(res.status).toBe(200);
    expect(setOrderStatusByToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `vercel-app/src/app/api/telegram/webhook/route.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { setOrderStatusByToken } from "@/lib/appsScript";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram";
import { actionToStatus } from "@/lib/orderMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgCallback {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}
interface TgUpdate {
  update_id?: number;
  callback_query?: TgCallback;
  message?: unknown;
}

function secretOk(received: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // constant-time even on length mismatch
    return false;
  }
  return timingSafeEqual(a, b);
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: "✅ Confirmed",
  declined: "❌ Declined",
  preparing: "👨‍🍳 Being prepared",
  out_for_delivery: "🛵 Out for delivery",
  delivered: "📦 Delivered",
  cancelled: "🚫 Cancelled",
};

export async function POST(request: Request): Promise<Response> {
  if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("ok", { status: 200 }); // never make Telegram redeliver
  }

  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) {
    return new Response("ok", { status: 200 });
  }

  const [action, token] = cb.data.split(":");
  const status = actionToStatus(action || "");
  if (!status || !token) {
    await answerCallbackQuery(cb.id, "Unknown action").catch(() => {});
    return new Response("ok", { status: 200 });
  }

  try {
    const r = await setOrderStatusByToken(token, status);
    if (r.success) {
      const original = cb.message.text || "Order";
      await editMessageText(cb.message.chat.id, cb.message.message_id, `${original}\n\n— ${STATUS_LABEL[status] || status}`);
      await answerCallbackQuery(cb.id, STATUS_LABEL[status] || status);
    } else {
      await answerCallbackQuery(cb.id, r.error || "Update failed");
    }
  } catch (err) {
    console.error("[webhook] status update failed:", err);
    await answerCallbackQuery(cb.id, "Update failed").catch(() => {});
  }

  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd vercel-app && npx vitest run src/app/api/telegram/webhook/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Full type-check + test suite**

Run: `cd vercel-app && npx tsc --noEmit && npm test`
Expected: tsc clean; all vitest files pass.

- [ ] **Step 6: Commit**

```bash
git add vercel-app/src/app/api/telegram/webhook/route.ts vercel-app/src/app/api/telegram/webhook/route.test.ts
git commit -m "feat(vercel): Telegram webhook — secret verify + button → status by token (TDD)"
```

---

# PART B — Apps Script changes

### Task 9: `channel=web` on placeOrder + `setOrderStatusByToken`

**Files:**
- Modify: `apps-script/admin-api.gs`

No local unit test (touches SpreadsheetApp); verified by syntax check + live QA (Task 12). The repo's root `npm test` (20 tests on capacity.gs) must still pass.

- [ ] **Step 1: Add `channel` handling + `id` to the placeOrder result**

In `apps-script/admin-api.gs`, in `orderPlace`, find the internal-notification call (inside the post-lock side effects, after the confirmed-order block):

```js
  sendInternalNotification({ name: params.name, phone: params.phone, deliverySlot: slotLabel12h(slotParam), status: outcome, orderTotal: params.orderTotal, orderSummary: params.orderSummary }, 'order');
```

Replace it with a channel guard (Telegram covers owner alerts when channel=web):

```js
  if (String(params.channel || '') !== 'web') {
    sendInternalNotification({ name: params.name, phone: params.phone, deliverySlot: slotLabel12h(slotParam), status: outcome, orderTotal: params.orderTotal, orderSummary: params.orderSummary }, 'order');
  }
```

Then find the success return of `orderPlace`:

```js
  return { success: true, status: outcome, trackingToken: token, deliverySlot: slotParam, deliveryDate: avail.date };
```

Add the order id:

```js
  return { success: true, status: outcome, trackingToken: token, deliverySlot: slotParam, deliveryDate: avail.date, id: id };
```

- [ ] **Step 2: Add `orderSetStatusByToken`**

Immediately after the `orderSetStatus` function, insert:

```js
/**
 * Token-keyed wrapper around orderSetStatus, for callers (the Telegram
 * webhook) that know the order's tracking_token but not its sheet row index
 * (row indices shift when rows are deleted). Looks up the row by
 * tracking_token, then applies the existing orderSetStatus logic + side
 * effects (confirm/decline/status emails, kitchen calendar, Pipeline sync,
 * cache invalidation, the order-id stale guard).
 */
function orderSetStatusByToken(token, newStatus) {
  if (!token) throw new Error('Missing token');
  var sheet = crmGetSheet('Orders');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) throw new Error('No orders');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var tokCol = headers.indexOf('tracking_token');
  var idCol = headers.indexOf('id');
  if (tokCol < 0) throw new Error('tracking_token column not found');
  var tokens = sheet.getRange(2, tokCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < tokens.length; i++) {
    if (String(tokens[i][0]) === String(token)) {
      var rowIndex = i + 2;
      var orderId = idCol >= 0 ? sheet.getRange(rowIndex, idCol + 1).getValue() : undefined;
      return orderSetStatus(rowIndex, newStatus, orderId);
    }
  }
  return { success: false, error: 'Order not found' };
}
```

- [ ] **Step 3: Wire the gated action into `doGet`**

In the password-protected `switch (action)` in `doGet`, find:

```js
      case 'setOrderStatus':
        return jsonpResponse(callback, orderSetStatus(parseInt(params.rowIndex), params.status, params.orderId));
```

Immediately after it add:

```js
      case 'setOrderStatusByToken':
        return jsonpResponse(callback, orderSetStatusByToken(params.token, params.status));
```

- [ ] **Step 4: Verify syntax + repo tests**

Run: `node -e "new Function(require('fs').readFileSync('apps-script/admin-api.gs','utf8')); console.log('OK')"`
Expected: `OK`.

Run (from repo root): `npm test`
Expected: 20 passed.

- [ ] **Step 5: Commit**

```bash
git add apps-script/admin-api.gs
git commit -m "feat(apps-script): channel=web (skip owner email) + setOrderStatusByToken for Telegram"
```

---

# PART C — React frontend

### Task 10: Frontend config + `orderService.placeOrderOnSite`

**Files:**
- Create: `src/config.ts`
- Modify: `src/services/orderService.ts`

- [ ] **Step 1: Create `src/config.ts`**

```ts
// Base URL of the Vercel orders backend. Override at build time with
// VITE_ORDERS_API_BASE; falls back to the production deployment.
export const ORDERS_API_BASE: string =
  (import.meta.env.VITE_ORDERS_API_BASE as string | undefined) ||
  "https://bistro-cloud-orders.vercel.app";
```

- [ ] **Step 2: Add `placeOrderOnSite` to `src/services/orderService.ts`**

Append to `src/services/orderService.ts`:

```ts
import { ORDERS_API_BASE } from "../config";

export type OnSitePaymentMethod = "cod" | "card_on_delivery" | "instapay";

export interface OnSiteOrderInput {
  items: { name: string; quantity: number; price: number }[];
  name: string;
  phone: string;
  email: string;
  address: string;
  note?: string;
  deliverySlot: string; // 'HH:mm'
  expectedStatus: "open" | "busy";
  paymentMethod: OnSitePaymentMethod;
}

export type OnSiteOrderResult =
  | { ok: true; status: "confirmed" | "pending_approval"; trackingToken: string; deliverySlot: string; paymentMethod: OnSitePaymentMethod; instapay?: string }
  | { ok: false; code?: "slot_full" | "slot_unavailable" | "busy_retry" | "daily_limit"; error?: string };

/** POST the order to the Vercel backend (the on-site confirmed-sale flow). */
export async function placeOrderOnSite(input: OnSiteOrderInput): Promise<OnSiteOrderResult> {
  try {
    const res = await fetch(`${ORDERS_API_BASE}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as OnSiteOrderResult;
    if (res.ok && (json as { ok?: boolean }).ok) return json;
    // 400/409/502 → carry the structured error/code if present
    const fail = json as { code?: 'slot_full' | 'slot_unavailable' | 'busy_retry' | 'daily_limit'; error?: string };
    return { ok: false, code: fail.code, error: fail.error };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}
```

- [ ] **Step 3: Verify the build**

Run (repo root): `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/services/orderService.ts
git commit -m "feat(web): orderService.placeOrderOnSite + ORDERS_API_BASE config"
```

---

### Task 11: CartDrawer — mandatory email, 3 payment methods, on-site checkout + done view

**Files:**
- Modify: `src/app/components/CartDrawer.tsx`

This replaces the WhatsApp-handoff checkout with an on-site POST and a done view. The capacity-aware slot picker (availability fetch, ASAP, busy markers) is unchanged — only the customer fields, payment options, the submit handler, and the post-submit view change.

- [ ] **Step 1: Make email required, switch payment options, add result state**

Near the other `useState` hooks at the top of `CartDrawer`, add a result state:

```tsx
  const [orderResult, setOrderResult] = React.useState<import('../../services/orderService').OnSiteOrderResult | null>(null);
```

Change the payment method state default and the options. Find the payment `<select>` options array:

```tsx
                    {['Cash on Delivery', 'Instapay', 'Credit/Debit Card'].map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
```

Replace with value/label pairs for the three settle-on-delivery methods:

```tsx
                    {[
                      { value: 'cod', label: 'Cash on Delivery' },
                      { value: 'card_on_delivery', label: 'Card on Delivery (card machine at your door)' },
                      { value: 'instapay', label: 'Instapay (bank transfer)' },
                    ].map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
```

And change the payment state initial value from `'Cash on Delivery'` to `'cod'`:

```tsx
  const [paymentMethod, setPaymentMethod] = React.useState('cod');
```

Make the email input required (it currently is optional). Change the email field block label and input:

```tsx
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Email <span className="text-[#D94E28]">*</span> <span className="font-normal text-gray-500">(for order & delivery updates)</span></h3>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                  />
                </div>
```

- [ ] **Step 2: Replace `handleCheckout` with the on-site POST**

Replace the entire `handleCheckout` function body with this (it no longer opens WhatsApp on the happy path; it POSTs and sets `orderResult`):

```tsx
  const handleCheckout = async () => {
    if (isSubmitting || checkoutBlocked) return;
    setIsSubmitting(true);
    try {
      const email = customerEmail.trim();
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!customerName.trim() || !customerPhone.trim()) {
        alert('Please enter your name and phone number.');
        return;
      }
      if (!EMAIL_RE.test(email)) {
        alert('Please enter a valid email — we use it to send your order and delivery updates.');
        return;
      }
      localStorage.setItem('bc_name', customerName.trim());
      localStorage.setItem('bc_phone', customerPhone.trim());
      localStorage.setItem('bc_email', email);

      // Resolve the chosen slot (ASAP → earliest open) and its expected state.
      const slotTime = selectedSlot === 'asap' ? availability?.asap : selectedSlot;
      if (!slotTime) {
        alert('Please pick a delivery time.');
        return;
      }
      const expectedStatus: 'open' | 'busy' =
        selectedSlot === 'asap' ? 'open' : (selectedSlotInfo?.status ?? 'open');

      const { placeOrderOnSite } = await import('../../services/orderService');
      const result = await placeOrderOnSite({
        items: items.map((it) => ({ name: it.name, quantity: it.quantity, price: it.price })),
        name: customerName.trim(),
        phone: customerPhone.trim(),
        email,
        address: address || orderNotes,
        note: orderNotes,
        deliverySlot: slotTime,
        expectedStatus,
        paymentMethod: paymentMethod as 'cod' | 'card_on_delivery' | 'instapay',
      });

      if (result.ok) {
        setOrderResult(result);
        clearCart();
      } else if (result.code === 'slot_full' || result.code === 'slot_unavailable') {
        await getAvailability().then(applyAvailability);
        toast.error('That delivery time just filled up — please pick another.');
      } else if (result.code === 'busy_retry') {
        toast.error("We're receiving a lot of orders right now — please try again in a few seconds.");
      } else if (result.code === 'daily_limit') {
        toast.error("We've reached today's order limit — please WhatsApp us directly.");
      } else {
        toast.error(result.error || "Couldn't place your order. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };
```

- [ ] **Step 3: Render the done view when `orderResult` is set**

At the top of the drawer's inner content (inside the `motion.div` drawer, right after the header `</div>`), add a branch that shows the confirmation instead of the cart when `orderResult?.ok`. Insert this just before the existing `<div className="flex-1 overflow-y-auto p-6 space-y-6">`:

```tsx
            {orderResult && orderResult.ok ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-3xl">✓</div>
                  <h3 className="font-montserrat font-bold text-xl text-gray-800 mb-1">
                    {orderResult.status === 'pending_approval' ? 'Order received!' : 'Order confirmed!'}
                  </h3>
                  <p className="text-gray-500 text-sm">
                    {orderResult.status === 'pending_approval'
                      ? "That time is busy — we'll confirm your delivery time shortly."
                      : `Scheduled for ${slotLabel(orderResult.deliverySlot)} today.`}
                  </p>
                </div>
                <div className="bg-[#F9F5F0] rounded-xl p-4 mb-4 text-sm text-gray-700">
                  {orderResult.paymentMethod === 'cod' && <p>💵 <strong>Pay cash on delivery.</strong></p>}
                  {orderResult.paymentMethod === 'card_on_delivery' && <p>💳 <strong>Pay by card on delivery</strong> — our driver brings a card machine.</p>}
                  {orderResult.paymentMethod === 'instapay' && (
                    <div>
                      <p className="mb-1">🏦 <strong>Instapay / bank transfer:</strong></p>
                      <p className="whitespace-pre-line">{orderResult.instapay}</p>
                      <p className="mt-1 text-gray-500">Transfer the total and we'll confirm your order.</p>
                    </div>
                  )}
                </div>
                <a
                  href={`/track?token=${orderResult.trackingToken}`}
                  className="block text-center bg-[#D94E28] text-white font-bold rounded-xl py-3 mb-3"
                >
                  Track your order
                </a>
                <button onClick={() => { setOrderResult(null); toggleCart(); }} className="block w-full text-center text-gray-500 text-sm py-2">
                  Done
                </button>
              </div>
            ) : (
```

Then find the matching close of the cart/form region — the existing structure is `<div className="flex-1 ...">…</div>` (the items list) followed by the `{items.length > 0 && (...)}` footer block, all inside the drawer. Wrap BOTH of those existing blocks so they render only in the `else` branch: add `)}` immediately AFTER the footer block's closing `)}` and before the drawer `motion.div` closes. (The implementer should place the opening `? (` from this step before the items `<div>` and the closing `) : (...existing two blocks...)}` around them — verify the JSX balances by building.)

> Implementer note: because this is a structural JSX wrap, after editing run the build immediately (Step 4). If the ternary is unbalanced, `vite build` fails with a clear JSX error pointing at the line — fix the parenthesis placement until it builds. Keep the items list + footer exactly as they are; only wrap them.

- [ ] **Step 4: Make sure `slotLabel` is imported**

`slotLabel` is already imported from `orderService` in this file (used by the picker). Confirm the import line includes it; if not, add it.

- [ ] **Step 5: Build + dev sanity**

Run (repo root): `npm run build`
Expected: builds clean.

Run: `npm run dev`, add an item, open cart. Expected: email shows a required `*`; payment options are the three new ones; submitting without a valid email alerts; (with the backend not yet deployed, a submit will show a network error toast — that's fine pre-deploy).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/CartDrawer.tsx
git commit -m "feat(web): on-site confirmed checkout — mandatory email, 3 pay methods, done view"
```

---

# PART D — Deploy & live QA

### Task 12: Deploy + live QA (MANUAL — requires the user)

This needs the user's Vercel account, a Telegram bot, and an Apps Script redeploy.

- [ ] **Step 1: Deploy the updated Apps Script**

From `apps-script/`: `clasp push --force` then `clasp deploy -i AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA --description "V19: channel=web + setOrderStatusByToken"`. (User-approved production deploy.)

Smoke-test the new action:
```bash
curl -sL '<APPS_SCRIPT_URL>?action=setOrderStatusByToken&password=Bistro001&token=bogus&status=confirmed'
```
Expected: `{"success":false,"error":"Order not found"}`.

- [ ] **Step 2: Create the Telegram bot + owner chat id**

Via @BotFather create a bot → get `TELEGRAM_BOT_TOKEN`. Send the bot a message, then read the owner chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` (the `chat.id`). Choose any random string for `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 3: Deploy the Vercel backend**

From `vercel-app/`: `vercel` (link/create project), set env vars (`APPS_SCRIPT_URL`, `APPS_SCRIPT_ADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `INSTAPAY_DETAILS`, `ALLOWED_ORIGIN=https://bistro-cloud.com`), then `vercel --prod`. Note the production URL.

Register the Telegram webhook:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<VERCEL_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
Expected: `{"ok":true,...}`.

Smoke-test order endpoint:
```bash
curl -s -X POST '<VERCEL_URL>/api/order' -H 'Content-Type: application/json' \
  -d '{"items":[{"name":"QA Test","quantity":1,"price":1}],"name":"ZZ QA","phone":"+201000000000","email":"qa@example.com","address":"QA address line","deliverySlot":"14:00","expectedStatus":"open","paymentMethod":"cod"}'
```
Expected: `{"ok":true,"status":"confirmed","trackingToken":"...",...}` AND a Telegram message arrives with Preparing/Cancel buttons.

- [ ] **Step 4: Point the frontend at the Vercel URL and ship**

Set `VITE_ORDERS_API_BASE=<VERCEL_URL>` in the GitHub Actions build env (or update the fallback in `src/config.ts`), then push `main` so Pages rebuilds.

- [ ] **Step 5: Live QA (browser, use /browse)**

- Add an item, open cart, confirm email is required and the three payment methods show.
- Place a COD order → done view says "Pay cash on delivery", tracking link works, order appears in the Orders sheet, kitchen calendar event created, customer confirmation email arrives, Telegram push arrives.
- Tap **Preparing** in Telegram → order status advances in the sheet + the tracking page updates + a status email arrives; the Telegram message edits to show the new status.
- Place an Instapay order → done view shows the bank details.
- Place an order into a busy slot (seed the hour to 4 orders/6 items) → done view says pending; Telegram shows Approve/Decline; tap Approve → confirms.
- **Cleanup:** delete the QA orders from the Orders + Pipeline sheets and remove test calendar events.

- [ ] **Step 6: Final commit/tag if all green.**

---

## Out of scope (Phase 1)

Loyverse POS + real Kitchen Display System (Phase 2). No online payment gateway anywhere — card is paid on the driver's POS at delivery. No Instapay receipt upload/reconciliation. No Resend/new email service — Apps Script keeps sending customer confirmation + status emails.
