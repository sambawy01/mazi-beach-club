# Order Capacity & Tracking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce kitchen capacity (max 4 orders AND 6 items per hour, 2–8 PM Cairo time) on bistro-cloud.com orders, with an admin approval queue for over-capacity orders, a kitchen Google Calendar, confirmation/decline/status emails, and a customer tracking page.

**Architecture:** A new pure-JS capacity module (`apps-script/capacity.gs`) is unit-tested in Node via vitest, then loaded into the existing Google Apps Script project alongside `admin-api.gs`, which gains public JSONP/fetch actions (`getAvailability`, `placeOrder`, `getOrderStatus`) and a password-gated `setOrderStatus`. The React cart fetches live availability, shows busy slots as "subject to confirmation," and submits orders through the capacity-checked endpoint. The Orders tab of the CRM Google Sheet is the single source of truth; `LockService` serializes capacity checks.

**Tech Stack:** React 18 + Vite + Tailwind (existing), react-router-dom 7 (existing), Google Apps Script + Google Sheets + CalendarApp + MailApp (existing project), vitest (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-06-12-order-capacity-design.md`

---

## Critical context for the implementer

1. **How the frontend talks to Apps Script.** All admin calls use plain `fetch` GET with `redirect: 'follow'` against the web-app URL (see `src/services/adminService.ts:54-59`). This works in production daily. GET only — POST bodies are lost in Google's 302 redirect. The new order endpoints use the same pattern.
2. **Password gate.** `doGet` in `apps-script/admin-api.gs` requires a role password for all `action=` calls (line ~101). The three new public actions MUST be handled *before* the role check.
3. **Apps Script deploys are manual.** The repo's `apps-script/admin-api.gs` is a mirror; the live code runs in the user's Apps Script project. Code changes here only take effect after the user pastes them into script.google.com and deploys a new version (Task 11). All `.gs` tasks are still TDD'd locally via the vitest harness.
4. **Sheets auto-converts strings like `14:30` and `2026-06-12` to time/date values**, which would corrupt reads. The migration (Task 3) sets the new columns' number format to plain text (`@`).
5. **WhatsApp popup rule.** `window.open` must be called synchronously in the click handler or mobile browsers block it. The new checkout opens a blank tab synchronously, awaits the API, then sets `location.href` on the tab (or closes it on failure).
6. **Timezone.** Egypt observes DST since 2023 (UTC+2/+3). Never hardcode an offset. Backend uses `Utilities.formatDate(date, 'Africa/Cairo', ...)` and `Utilities.parseDate(..., 'Africa/Cairo', ...)`. The pure capacity functions take `dateStr` and `nowMinutes` as inputs so they stay timezone-agnostic and testable.
7. **Capacity semantics.** A 30-min slot consumes capacity from its parent hour bucket (slot `14:30` → hour 14). Statuses `confirmed`, `preparing`, `out_for_delivery`, `delivered` consume capacity; `pending_approval`, `declined`, `cancelled`, and legacy `New` rows (no `delivery_slot`) do not.
8. **Run tests with:** `npm test` (added in Task 1). Run a single file with `npx vitest run tests/capacity.test.ts`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps-script/capacity.gs` | Create | Pure capacity/slot logic, no Apps Script APIs. Unit-tested in Node. |
| `apps-script/admin-api.gs` | Modify | Wire new actions, sheet schema + settings, lock-protected order placement, calendar, emails. |
| `tests/capacity.test.ts` | Create | Vitest suite for capacity.gs via eval harness. |
| `tests/slotUtils.test.ts` | Create | Vitest suite for frontend slot label helper. |
| `src/services/orderService.ts` | Create | Typed fetch client for availability/placeOrder/getOrderStatus + `slotLabel`. |
| `src/app/components/CartDrawer.tsx` | Modify (full rewrite of file) | Live slot picker, ASAP confirm, email field, capacity-checked checkout. |
| `src/services/adminService.ts` | Modify | Add `CRMOrder` type, `getCRMOrders`, `setOrderStatus`. |
| `src/app/pages/admin/OrdersTab.tsx` | Modify (full rewrite of file) | CRM orders with status workflow: Approve/Decline/advance/Cancel. |
| `src/app/pages/Track.tsx` | Create (Phase 2) | Customer tracking timeline, polls status. |
| `src/app/App.tsx` | Modify (Phase 2) | Add `/track` route. |
| `package.json` | Modify | Add vitest + `test` script. |

---

# PHASE 1 — Capacity + approval queue

### Task 1: Test infrastructure (vitest)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

Run: `npm install --save-dev vitest`
Expected: exits 0, `vitest` appears in `devDependencies`.

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run"
```

so scripts reads:

```json
"scripts": {
  "build": "vite build",
  "dev": "vite",
  "deploy": "bash scripts/deploy.sh",
  "test": "vitest run"
}
```

- [ ] **Step 3: Verify the runner works**

Run: `npm test`
Expected: vitest runs and reports "No test files found" (exit code 1 is fine at this step — there are no tests yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for capacity logic tests"
```

---

### Task 2: Pure capacity logic (`capacity.gs`) — TDD

**Files:**
- Create: `apps-script/capacity.gs`
- Test: `tests/capacity.test.ts`

The `.gs` file is plain JavaScript with no imports/exports (Apps Script merges all project files into one global scope). The test harness reads the file and evaluates it with `new Function`.

- [ ] **Step 1: Write the failing tests**

Create `tests/capacity.test.ts` with exactly:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// capacity.gs is plain script (Apps Script style, no exports) — load it
// into a Function scope and return its public names.
function loadCapacity() {
  const code = readFileSync(new URL('../apps-script/capacity.gs', import.meta.url), 'utf8');
  const factory = new Function(`${code}
    return { CAPACITY_DEFAULTS, parseCapacitySettings, slotToMinutes, minutesToSlot,
             slotLabel12h, countCapacityByHour, computeAvailability, decideOrderOutcome };
  `);
  return factory();
}

const cap = loadCapacity();

const SETTINGS = {
  maxOrdersPerHour: 4,
  maxItemsPerHour: 6,
  openHour: 14,
  closeHour: 20,
  leadTimeMins: 30,
  blackoutDates: '',
  paused: false,
};

const DATE = '2026-06-12';

function order(slot: string, items = 1, status = 'confirmed', date = DATE) {
  return { delivery_date: date, delivery_slot: slot, item_count: items, status };
}

describe('parseCapacitySettings', () => {
  it('returns defaults for empty rows', () => {
    expect(cap.parseCapacitySettings([])).toEqual(SETTINGS);
  });

  it('applies overrides and parses paused as boolean', () => {
    const s = cap.parseCapacitySettings([
      ['maxOrdersPerHour', '6'],
      ['paused', 'TRUE'],
      ['blackoutDates', '2026-06-15, 2026-06-16'],
      ['unknownKey', '99'],
    ]);
    expect(s.maxOrdersPerHour).toBe(6);
    expect(s.paused).toBe(true);
    expect(s.blackoutDates).toBe('2026-06-15, 2026-06-16');
    expect(s.maxItemsPerHour).toBe(6); // untouched default
    expect('unknownKey' in s).toBe(false);
  });
});

describe('slot helpers', () => {
  it('converts both directions', () => {
    expect(cap.slotToMinutes('14:30')).toBe(870);
    expect(cap.minutesToSlot(870)).toBe('14:30');
    expect(cap.minutesToSlot(600)).toBe('10:00');
  });

  it('formats 12-hour labels', () => {
    expect(cap.slotLabel12h('14:30')).toBe('2:30 PM');
    expect(cap.slotLabel12h('12:00')).toBe('12:00 PM');
    expect(cap.slotLabel12h('20:00')).toBe('8:00 PM');
  });
});

describe('countCapacityByHour', () => {
  it('buckets 30-min slots into their parent hour and sums items', () => {
    const byHour = cap.countCapacityByHour(
      [order('14:00', 2), order('14:30', 3), order('15:00', 1)],
      DATE,
    );
    expect(byHour[14]).toEqual({ orders: 2, items: 5 });
    expect(byHour[15]).toEqual({ orders: 1, items: 1 });
  });

  it('ignores non-consuming statuses, other dates, and slotless legacy rows', () => {
    const byHour = cap.countCapacityByHour(
      [
        order('14:00', 2, 'pending_approval'),
        order('14:00', 2, 'declined'),
        order('14:00', 2, 'cancelled'),
        order('14:00', 2, 'confirmed', '2026-06-11'),
        { delivery_date: DATE, delivery_slot: '', item_count: 2, status: 'New' },
      ],
      DATE,
    );
    expect(byHour[14]).toBeUndefined();
  });

  it('treats missing/zero item_count as 1 item', () => {
    const byHour = cap.countCapacityByHour(
      [{ delivery_date: DATE, delivery_slot: '14:00', item_count: '', status: 'confirmed' }],
      DATE,
    );
    expect(byHour[14]).toEqual({ orders: 1, items: 1 });
  });
});

describe('computeAvailability', () => {
  it('generates all 13 slots from 14:00 to 20:00 when the day is empty', () => {
    const a = cap.computeAvailability([], SETTINGS, DATE, 600); // 10:00 AM
    expect(a.paused).toBe(false);
    expect(a.slots.length).toBe(13);
    expect(a.slots[0]).toEqual({ time: '14:00', status: 'open' });
    expect(a.slots[12]).toEqual({ time: '20:00', status: 'open' });
    expect(a.asap).toBe('14:00');
  });

  it('hides slots inside the lead-time window', () => {
    // 14:10 now + 30min lead = 14:40 → first offered slot is 15:00
    const a = cap.computeAvailability([], SETTINGS, DATE, 850);
    expect(a.slots[0].time).toBe('15:00');
  });

  it('marks an hour busy at 4 orders (orders cap)', () => {
    const orders = [order('14:00'), order('14:00'), order('14:30'), order('14:30')];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '14:00')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '14:30')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '15:00')!.status).toBe('open');
    expect(a.asap).toBe('15:00');
  });

  it('marks an hour busy at 6 items (items cap), even with fewer orders', () => {
    const orders = [order('16:00', 4), order('16:30', 2)];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '16:00')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '16:30')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '17:00')!.status).toBe('open');
  });

  it('pending_approval orders do not consume capacity', () => {
    const orders = [
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
    ];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '14:00')!.status).toBe('open');
  });

  it('returns paused for paused setting and for blackout dates', () => {
    expect(cap.computeAvailability([], { ...SETTINGS, paused: true }, DATE, 600))
      .toEqual({ paused: true, date: DATE, slots: [], asap: null });
    const blackout = { ...SETTINGS, blackoutDates: '2026-06-12' };
    expect(cap.computeAvailability([], blackout, DATE, 600).paused).toBe(true);
  });

  it('asap is null when every remaining slot is busy', () => {
    const orders: object[] = [];
    for (let h = 14; h <= 20; h++) {
      for (let i = 0; i < 4; i++) orders.push(order(`${h}:00`));
    }
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.asap).toBeNull();
    expect(a.slots.every(s => s.status === 'busy')).toBe(true);
  });
});

describe('decideOrderOutcome', () => {
  const avail = {
    paused: false,
    date: DATE,
    slots: [
      { time: '15:00', status: 'open' },
      { time: '15:30', status: 'busy' },
    ],
    asap: '15:00',
  };

  it('confirms an open slot', () => {
    expect(cap.decideOrderOutcome(avail, '15:00', 'open')).toBe('confirmed');
  });

  it('queues a knowingly-busy slot as pending_approval', () => {
    expect(cap.decideOrderOutcome(avail, '15:30', 'busy')).toBe('pending_approval');
  });

  it('returns slot_full when the customer expected open but the slot filled (race loser)', () => {
    expect(cap.decideOrderOutcome(avail, '15:30', 'open')).toBe('slot_full');
  });

  it('returns slot_unavailable for unknown slots and paused days', () => {
    expect(cap.decideOrderOutcome(avail, '21:00', 'open')).toBe('slot_unavailable');
    expect(cap.decideOrderOutcome({ paused: true, date: DATE, slots: [], asap: null }, '15:00', 'open'))
      .toBe('slot_unavailable');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/capacity.test.ts`
Expected: FAIL — `ENOENT ... apps-script/capacity.gs` (file doesn't exist yet).

- [ ] **Step 3: Implement `apps-script/capacity.gs`**

Create `apps-script/capacity.gs` with exactly:

```js
/**
 * Bistro Cloud — pure capacity/slot logic.
 *
 * No Apps Script APIs in this file: everything is plain JavaScript so the
 * logic can be unit-tested in Node (see tests/capacity.test.ts). Apps Script
 * merges all project files into one global scope, so admin-api.gs calls
 * these functions directly.
 *
 * Capacity model: each 30-minute delivery slot consumes capacity from its
 * parent HOUR bucket. An hour is "busy" when it has reached
 * maxOrdersPerHour orders OR maxItemsPerHour items — whichever first.
 */

var CAPACITY_DEFAULTS = {
  maxOrdersPerHour: 4,
  maxItemsPerHour: 6,
  openHour: 14,
  closeHour: 20,
  leadTimeMins: 30,
  blackoutDates: '',
  paused: false,
};

// Statuses that hold a slot. pending_approval, declined, cancelled and
// legacy 'New' rows (which have no delivery_slot) do not consume capacity.
var CAPACITY_STATUSES = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];

var ORDER_STATUSES = ['pending_approval', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'declined', 'cancelled'];

/** rows: [[key, value], ...] from the Settings tab → settings object with defaults. */
function parseCapacitySettings(rows) {
  var s = {};
  for (var k in CAPACITY_DEFAULTS) s[k] = CAPACITY_DEFAULTS[k];
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0] || '').trim();
    var val = rows[i][1];
    if (!(key in CAPACITY_DEFAULTS) || val === '' || val === undefined || val === null) continue;
    if (key === 'blackoutDates') {
      s[key] = String(val);
    } else if (key === 'paused') {
      s[key] = val === true || String(val).toLowerCase() === 'true';
    } else {
      var n = Number(val);
      if (!isNaN(n)) s[key] = n;
    }
  }
  return s;
}

function slotToMinutes(slot) {
  var parts = String(slot).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToSlot(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** '14:30' → '2:30 PM' */
function slotLabel12h(slot) {
  var total = slotToMinutes(slot);
  var h = Math.floor(total / 60);
  var m = total % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hr = h % 12;
  if (hr === 0) hr = 12;
  return hr + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

/**
 * Count capacity-consuming orders/items per hour for a given date.
 * orders: row objects from the Orders tab (delivery_date, delivery_slot,
 * item_count, status). Returns { [hour]: { orders, items } }.
 */
function countCapacityByHour(orders, dateStr) {
  var byHour = {};
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (String(o.delivery_date) !== dateStr) continue;
    if (CAPACITY_STATUSES.indexOf(String(o.status)) < 0) continue;
    var slot = String(o.delivery_slot || '');
    if (!/^\d{1,2}:\d{2}$/.test(slot)) continue; // legacy rows / corrupted values
    var hour = Math.floor(slotToMinutes(slot) / 60);
    if (!byHour[hour]) byHour[hour] = { orders: 0, items: 0 };
    byHour[hour].orders += 1;
    byHour[hour].items += Number(o.item_count) > 0 ? Number(o.item_count) : 1;
  }
  return byHour;
}

/**
 * Compute slot availability for one day.
 * dateStr: 'yyyy-MM-dd' (Cairo); nowMinutes: minutes since midnight (Cairo).
 * Returns { paused, date, slots: [{ time, status: 'open'|'busy' }], asap }.
 * Slots inside the lead-time window are omitted entirely.
 */
function computeAvailability(orders, settings, dateStr, nowMinutes) {
  var blackout = String(settings.blackoutDates).split(',').map(function (d) { return d.trim(); });
  if (settings.paused || blackout.indexOf(dateStr) >= 0) {
    return { paused: true, date: dateStr, slots: [], asap: null };
  }
  var byHour = countCapacityByHour(orders, dateStr);
  var slots = [];
  var asap = null;
  var minMinutes = nowMinutes + settings.leadTimeMins;
  for (var m = settings.openHour * 60; m <= settings.closeHour * 60; m += 30) {
    if (m <= minMinutes) continue;
    var hour = Math.floor(m / 60);
    var counts = byHour[hour] || { orders: 0, items: 0 };
    var busy = counts.orders >= settings.maxOrdersPerHour || counts.items >= settings.maxItemsPerHour;
    if (!busy && asap === null) asap = minutesToSlot(m);
    slots.push({ time: minutesToSlot(m), status: busy ? 'busy' : 'open' });
  }
  return { paused: false, date: dateStr, slots: slots, asap: asap };
}

/**
 * Decide the outcome of placing an order into a slot.
 * expectedStatus is what the customer saw in the picker ('open'|'busy').
 * Returns 'confirmed' | 'pending_approval' | 'slot_full' | 'slot_unavailable'.
 */
function decideOrderOutcome(availability, deliverySlot, expectedStatus) {
  if (availability.paused) return 'slot_unavailable';
  var slot = null;
  for (var i = 0; i < availability.slots.length; i++) {
    if (availability.slots[i].time === deliverySlot) { slot = availability.slots[i]; break; }
  }
  if (!slot) return 'slot_unavailable';
  if (slot.status === 'open') return 'confirmed';
  if (expectedStatus === 'busy') return 'pending_approval';
  return 'slot_full';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/capacity.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps-script/capacity.gs tests/capacity.test.ts
git commit -m "feat: pure capacity logic for order slots (TDD)"
```

---

### Task 3: Backend schema — Orders columns, Settings tab, time helpers

**Files:**
- Modify: `apps-script/admin-api.gs`

No local tests possible for these (they touch SpreadsheetApp); they're exercised live in Task 11. Keep the edits exactly as written.

- [ ] **Step 1: Extend the Orders schema and add a Settings tab definition**

In `apps-script/admin-api.gs`, find the `CRM_TABS` declaration (~line 449):

```js
var CRM_TABS = {
  Catering: ['id', 'timestamp', 'name', 'company', 'email', 'phone', 'event_type', 'guest_count', 'event_date', 'location', 'menu_preferences', 'status', 'notes'],
  Orders:   ['id', 'timestamp', 'name', 'phone', 'delivery_area', 'address', 'order_total', 'order_summary', 'status', 'notes'],
  Contacts: ['id', 'timestamp', 'name', 'email', 'phone', 'message', 'status'],
  Pipeline: ['id', 'timestamp', 'type', 'deal_name', 'contact_name', 'company', 'email', 'stage', 'value', 'event_date', 'guest_count', 'location', 'status', 'notes'],
};
```

Replace the `Orders` line and add a `Settings` line so it reads:

```js
var CRM_TABS = {
  Catering: ['id', 'timestamp', 'name', 'company', 'email', 'phone', 'event_type', 'guest_count', 'event_date', 'location', 'menu_preferences', 'status', 'notes'],
  Orders:   ['id', 'timestamp', 'name', 'phone', 'email', 'delivery_area', 'address', 'order_total', 'order_summary', 'item_count', 'delivery_date', 'delivery_slot', 'tracking_token', 'status', 'notes'],
  Contacts: ['id', 'timestamp', 'name', 'email', 'phone', 'message', 'status'],
  Pipeline: ['id', 'timestamp', 'type', 'deal_name', 'contact_name', 'company', 'email', 'stage', 'value', 'event_date', 'guest_count', 'location', 'status', 'notes'],
  Settings: ['setting', 'value'],
};
```

- [ ] **Step 2: Add migration + settings + time helpers**

Immediately after the `setupCRM()` function (it ends with `Logger.log('CRM setup complete! ...)` followed by `}`), insert:

```js
// ============ CAPACITY: SCHEMA MIGRATION + SETTINGS ============

var BISTRO_TZ = 'Africa/Cairo';

/**
 * Run ONCE from the Apps Script editor after deploying this version.
 * Appends the new capacity columns to the existing Orders tab (header-based
 * appends mean column order never matters) and forces the text-like columns
 * to plain-text format so Sheets doesn't convert '14:30' to a time value.
 */
function migrateOrdersTab() {
  var sheet = crmGetSheet('Orders');
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var wanted = CRM_TABS.Orders;
  var added = [];
  for (var i = 0; i < wanted.length; i++) {
    if (headers.indexOf(wanted[i]) < 0) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(wanted[i]).setFontWeight('bold');
      headers.push(wanted[i]);
      added.push(wanted[i]);
    }
  }
  // Force plain-text format on columns Sheets would otherwise auto-convert.
  var textCols = ['delivery_date', 'delivery_slot', 'tracking_token'];
  for (var t = 0; t < textCols.length; t++) {
    var idx = headers.indexOf(textCols[t]);
    if (idx >= 0) {
      sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    }
  }
  Logger.log('Orders migration done. Added: ' + (added.join(', ') || 'none'));
}

/**
 * Run ONCE from the Apps Script editor. Seeds the Settings tab with the
 * default capacity rules. Edit the cells any time to change the rules —
 * no redeploy needed.
 */
function setupCapacitySettings() {
  var sheet = crmGetSheet('Settings');
  if (sheet.getLastRow() > 1) {
    Logger.log('Settings tab already has values — not overwriting.');
    return;
  }
  var rows = [
    ['maxOrdersPerHour', 4],
    ['maxItemsPerHour', 6],
    ['openHour', 14],
    ['closeHour', 20],
    ['leadTimeMins', 30],
    ['blackoutDates', ''],
    ['paused', 'FALSE'],
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  Logger.log('Capacity settings seeded.');
}

function getCapacitySettings() {
  var sheet = crmGetSheet('Settings');
  var lastRow = sheet.getLastRow();
  var rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return parseCapacitySettings(rows);
}

function cairoToday() {
  return Utilities.formatDate(new Date(), BISTRO_TZ, 'yyyy-MM-dd');
}

function cairoNowMinutes() {
  return slotToMinutes(Utilities.formatDate(new Date(), BISTRO_TZ, 'HH:mm'));
}
```

- [ ] **Step 3: Verify nothing broke locally**

Run: `npm test`
Expected: PASS (capacity tests unaffected — admin-api.gs is not loaded by the harness).

- [ ] **Step 4: Commit**

```bash
git add apps-script/admin-api.gs
git commit -m "feat: Orders schema migration, Settings tab, Cairo time helpers"
```

---

### Task 4: Backend order placement — availability, placeOrder, getOrderStatus, calendar, confirmation email

**Files:**
- Modify: `apps-script/admin-api.gs`

- [ ] **Step 1: Add the order engine functions**

In `apps-script/admin-api.gs`, immediately after the `cairoNowMinutes()` function added in Task 3, insert:

```js
// ============ CAPACITY: ORDER ENGINE ============

function orderGetAvailability() {
  var settings = getCapacitySettings();
  var orders = crmReadRows('Orders');
  var avail = computeAvailability(orders, settings, cairoToday(), cairoNowMinutes());
  return { success: true, availability: avail };
}

/**
 * Capacity-checked order placement. The lock serializes the
 * re-check + write so two simultaneous customers can't both take the
 * last slot in an hour.
 *
 * params (all strings from the GET query):
 *   name, phone, email, address, deliveryArea, orderTotal, orderSummary,
 *   itemCount, deliverySlot ('HH:mm'), expectedStatus ('open'|'busy')
 */
function orderPlace(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var settings = getCapacitySettings();
    var orders = crmReadRows('Orders');
    var avail = computeAvailability(orders, settings, cairoToday(), cairoNowMinutes());
    var outcome = decideOrderOutcome(avail, params.deliverySlot, params.expectedStatus || 'open');

    if (outcome === 'slot_full' || outcome === 'slot_unavailable') {
      return { success: false, code: outcome, availability: avail };
    }

    var id = Date.now();
    var token = Utilities.getUuid();
    var ts = new Date().toISOString();
    var itemCount = Number(params.itemCount) > 0 ? Number(params.itemCount) : 1;

    crmAppendRow('Orders', {
      id: id,
      timestamp: ts,
      name: params.name || '',
      phone: params.phone || '',
      email: params.email || '',
      delivery_area: params.deliveryArea || '',
      address: params.address || '',
      order_total: params.orderTotal || '',
      order_summary: params.orderSummary || '',
      item_count: itemCount,
      delivery_date: avail.date,
      delivery_slot: params.deliverySlot,
      tracking_token: token,
      status: outcome,
      notes: '',
    });

    crmAppendRow('Pipeline', {
      id: id,
      timestamp: ts,
      type: 'order',
      deal_name: 'Order — ' + (params.name || 'Unknown'),
      contact_name: params.name || '',
      company: '',
      email: params.email || '',
      stage: outcome === 'confirmed' ? 'Won' : 'Inquiry',
      value: params.orderTotal || '',
      event_date: avail.date,
      guest_count: '1',
      location: params.deliveryArea || params.address || '',
      status: outcome === 'confirmed' ? 'Completed' : 'Open',
      notes: params.orderSummary || '',
    });

    var orderInfo = {
      name: params.name || '',
      phone: params.phone || '',
      email: params.email || '',
      address: params.address || '',
      orderTotal: params.orderTotal || '',
      orderSummary: params.orderSummary || '',
      itemCount: itemCount,
      deliveryDate: avail.date,
      deliverySlot: params.deliverySlot,
      trackingToken: token,
    };

    if (outcome === 'confirmed') {
      createKitchenEvent(orderInfo);
      sendOrderConfirmationEmail(orderInfo);
    }
    sendInternalNotification({
      name: params.name,
      phone: params.phone,
      deliverySlot: slotLabel12h(params.deliverySlot),
      status: outcome,
      orderTotal: params.orderTotal,
      orderSummary: params.orderSummary,
    }, 'order');

    return {
      success: true,
      status: outcome,
      trackingToken: token,
      deliverySlot: params.deliverySlot,
      deliveryDate: avail.date,
    };
  } finally {
    lock.releaseLock();
  }
}

function orderGetStatus(token) {
  if (!token) return { success: false, error: 'Missing token' };
  var orders = crmReadRows('Orders');
  for (var i = orders.length - 1; i >= 0; i--) {
    if (String(orders[i].tracking_token) === String(token)) {
      var o = orders[i];
      return {
        success: true,
        order: {
          name: String(o.name || ''),
          status: String(o.status || ''),
          deliveryDate: String(o.delivery_date || ''),
          deliverySlot: String(o.delivery_slot || ''),
          orderSummary: String(o.order_summary || ''),
          orderTotal: o.order_total || '',
        },
      };
    }
  }
  return { success: false, error: 'Order not found' };
}

// ============ CAPACITY: KITCHEN CALENDAR ============

var KITCHEN_CALENDAR_NAME = 'Bistro Kitchen';

function getKitchenCalendar() {
  var cals = CalendarApp.getCalendarsByName(KITCHEN_CALENDAR_NAME);
  if (cals.length > 0) return cals[0];
  return CalendarApp.createCalendar(KITCHEN_CALENDAR_NAME);
}

/** orderInfo: { name, phone, address, orderTotal, orderSummary, itemCount, deliveryDate, deliverySlot } */
function createKitchenEvent(orderInfo) {
  try {
    var start = Utilities.parseDate(
      orderInfo.deliveryDate + ' ' + orderInfo.deliverySlot, BISTRO_TZ, 'yyyy-MM-dd HH:mm');
    var end = new Date(start.getTime() + 30 * 60000);
    var title = orderInfo.name + ' — ' + orderInfo.itemCount + ' item(s) — ' + orderInfo.orderTotal + ' EGP';
    var desc = 'Phone: ' + orderInfo.phone +
      '\nAddress: ' + orderInfo.address +
      '\n\n' + orderInfo.orderSummary;
    getKitchenCalendar().createEvent(title, start, end, { description: desc });
  } catch (error) {
    // Never block an order on a calendar failure.
    Logger.log('Kitchen calendar event failed: ' + error.toString());
  }
}

// ============ CAPACITY: CUSTOMER EMAILS ============

function bistroEmailWrap(innerHtml) {
  return '<div style="font-family: Helvetica Neue, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9F5F0;">' +
    '<div style="background: #2C3E50; padding: 30px; text-align: center;">' +
      '<h1 style="color: white; margin: 0; font-size: 24px;">Bistro Cloud</h1>' +
      '<p style="color: #bdc3c7; margin: 5px 0 0; font-size: 14px;">Fresh. Natural. Delivered Daily.</p>' +
    '</div>' +
    '<div style="padding: 30px; background: white;">' + innerHtml + '</div>' +
    '<div style="padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">' +
      '<p style="color: #999; font-size: 12px; margin: 0;">Bistro Cloud El Gouna - 100% Natural Ingredients - Free Delivery<br>' +
        '<a href="https://bistro-cloud.com" style="color: #D94E28; text-decoration: none;">bistro-cloud.com</a></p>' +
    '</div>' +
  '</div>';
}

/** orderInfo: { name, email, orderSummary, orderTotal, deliverySlot, trackingToken } */
function sendOrderConfirmationEmail(orderInfo) {
  try {
    if (!orderInfo.email) return;
    var slotLabel = slotLabel12h(orderInfo.deliverySlot);
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">Order confirmed, ' + orderInfo.name + '!</h2>' +
      '<p style="color: #555; line-height: 1.6;">Your delivery is scheduled for <strong>today at ' + slotLabel + '</strong>.</p>' +
      '<div style="background: #F9F5F0; border-radius: 12px; padding: 20px; margin: 20px 0;">' +
        '<p style="color: #333; margin: 0; white-space: pre-line;">' + orderInfo.orderSummary + '</p>' +
        '<p style="color: #2C3E50; font-weight: bold; margin: 10px 0 0;">Total: ' + orderInfo.orderTotal + ' EGP</p>' +
      '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: 'Bistro Cloud — order confirmed for ' + slotLabel,
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Confirmation email failed: ' + error.toString());
  }
}

/** orderInfo: { name, email, deliverySlot }, openSlotLabels: array of 'h:mm AM/PM' */
function sendOrderDeclineEmail(orderInfo, openSlotLabels) {
  try {
    if (!orderInfo.email) return;
    var alternatives = (openSlotLabels && openSlotLabels.length)
      ? '<p style="color: #555; line-height: 1.6;">These times are still available today: <strong>' + openSlotLabels.join(', ') + '</strong>. Place a new order on <a href="https://bistro-cloud.com/menu" style="color: #D94E28;">bistro-cloud.com</a> or WhatsApp us.</p>'
      : '<p style="color: #555; line-height: 1.6;">Unfortunately no more delivery times are available today. We would love to serve you tomorrow!</p>';
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">About your order, ' + orderInfo.name + '</h2>' +
      '<p style="color: #555; line-height: 1.6;">We\'re sorry — the kitchen is fully booked at <strong>' + slotLabel12h(orderInfo.deliverySlot) + '</strong> and we couldn\'t fit your order in.</p>' +
      alternatives +
      '<div style="text-align: center; margin: 25px 0;">' +
        '<a href="https://wa.me/201221288804" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Chat on WhatsApp</a>' +
      '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: 'Bistro Cloud — we couldn\'t fit your order in today',
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Decline email failed: ' + error.toString());
  }
}
```

- [ ] **Step 2: Wire the public actions into `doGet`**

In `doGet`, find the health-check block:

```js
  // ── Health check (no action, no payload) ──
  if (!action) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Bistro Cloud CRM + Admin API is running'
    })).setMimeType(ContentService.MimeType.JSON);
  }
```

Immediately AFTER it (and BEFORE the `var role = getRole(password);` line), insert:

```js
  // ── Public order actions (no password — customer-facing) ──
  if (action === 'getAvailability' || action === 'placeOrder' || action === 'getOrderStatus') {
    try {
      if (action === 'getAvailability') return jsonpResponse(callback, orderGetAvailability());
      if (action === 'placeOrder') return jsonpResponse(callback, orderPlace(params));
      return jsonpResponse(callback, orderGetStatus(params.token));
    } catch (err) {
      return jsonpResponse(callback, { success: false, error: err.message });
    }
  }
```

- [ ] **Step 3: Verify locally**

Run: `npm test`
Expected: PASS (unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps-script/admin-api.gs
git commit -m "feat: capacity-checked placeOrder, availability and status endpoints, kitchen calendar, order emails"
```

---

### Task 5: Backend admin action — setOrderStatus (approve / decline / advance / cancel)

**Files:**
- Modify: `apps-script/admin-api.gs`

- [ ] **Step 1: Add `orderSetStatus`**

Immediately after the `sendOrderDeclineEmail` function added in Task 4, insert:

```js
// ============ CAPACITY: ADMIN STATUS MANAGEMENT ============

/**
 * Admin-only. Sets the status of an Orders row and triggers side effects:
 *  pending_approval → confirmed : kitchen calendar event + confirmation email
 *  → declined                  : decline email with open alternatives
 * Phase 2 adds status-update emails for preparing/out_for_delivery/delivered.
 */
function orderSetStatus(rowIndex, newStatus) {
  if (ORDER_STATUSES.indexOf(newStatus) < 0) throw new Error('Invalid status: ' + newStatus);
  var sheet = crmGetSheet('Orders');
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var statusCol = headers.indexOf('status');
  if (statusCol < 0) throw new Error('Status column not found');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);

  var rowVals = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var row = {};
  for (var j = 0; j < headers.length; j++) row[headers[j]] = rowVals[j];
  var prevStatus = String(row.status);

  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);

  var orderInfo = {
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    address: String(row.address || ''),
    orderTotal: row.order_total || '',
    orderSummary: String(row.order_summary || ''),
    itemCount: Number(row.item_count) > 0 ? Number(row.item_count) : 1,
    deliveryDate: String(row.delivery_date || ''),
    deliverySlot: String(row.delivery_slot || ''),
    trackingToken: String(row.tracking_token || ''),
  };

  if (newStatus === 'confirmed' && prevStatus === 'pending_approval') {
    createKitchenEvent(orderInfo);
    sendOrderConfirmationEmail(orderInfo);
  } else if (newStatus === 'declined') {
    var avail = orderGetAvailability().availability;
    var openLabels = [];
    for (var s = 0; s < avail.slots.length; s++) {
      if (avail.slots[s].status === 'open') openLabels.push(slotLabel12h(avail.slots[s].time));
    }
    sendOrderDeclineEmail(orderInfo, openLabels);
  }
  // Phase 2 hook: status-update emails for preparing/out_for_delivery/delivered.

  return { success: true, status: newStatus };
}
```

- [ ] **Step 2: Wire it into the password-protected `switch` in `doGet`**

Find the case:

```js
      case 'archiveOrder':
        return jsonpResponse(callback, adminArchiveOrder(parseInt(params.rowIndex)));
```

Immediately after it, add:

```js
      case 'setOrderStatus':
        return jsonpResponse(callback, orderSetStatus(parseInt(params.rowIndex), params.status));
```

- [ ] **Step 3: Verify locally**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps-script/admin-api.gs
git commit -m "feat: admin setOrderStatus action with approve/decline side effects"
```

---

### Task 6: Frontend order service — TDD on slot labels

**Files:**
- Create: `src/services/orderService.ts`
- Test: `tests/slotUtils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/slotUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slotLabel } from '../src/services/orderService';

describe('slotLabel', () => {
  it('formats 24h slot strings as 12-hour labels', () => {
    expect(slotLabel('14:30')).toBe('2:30 PM');
    expect(slotLabel('12:00')).toBe('12:00 PM');
    expect(slotLabel('20:00')).toBe('8:00 PM');
    expect(slotLabel('09:05')).toBe('9:05 AM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slotUtils.test.ts`
Expected: FAIL — cannot resolve `../src/services/orderService`.

- [ ] **Step 3: Implement `src/services/orderService.ts`**

Create with exactly:

```ts
/**
 * Customer-facing order API — availability, capacity-checked placement,
 * and tracking. Same fetch-GET pattern as adminService.ts: GET only,
 * because POST bodies are lost in Google's 302 redirect.
 */
const CRM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec';

export interface SlotInfo {
  time: string; // 'HH:mm' 24h
  status: 'open' | 'busy';
}

export interface Availability {
  paused: boolean;
  date: string; // 'yyyy-MM-dd'
  slots: SlotInfo[];
  asap: string | null; // earliest open slot, or null if none
}

export interface PlaceOrderInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  deliveryArea: string;
  orderTotal: number;
  orderSummary: string;
  itemCount: number;
  deliverySlot: string; // 'HH:mm'
  expectedStatus: 'open' | 'busy';
}

export type PlaceOrderResult =
  | { success: true; status: 'confirmed' | 'pending_approval'; trackingToken: string; deliverySlot: string; deliveryDate: string }
  | { success: false; code: 'slot_full' | 'slot_unavailable'; availability?: Availability };

export interface TrackedOrder {
  name: string;
  status: string;
  deliveryDate: string;
  deliverySlot: string;
  orderSummary: string;
  orderTotal: number | string;
}

/** '14:30' → '2:30 PM' (mirror of slotLabel12h in apps-script/capacity.gs) */
export function slotLabel(time: string): string {
  const [hStr, mStr] = String(time).split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

async function apiGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CRM_ENDPOINT}?${qs}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Returns null on any failure — callers fail open (show all slots). */
export async function getAvailability(): Promise<Availability | null> {
  try {
    const res = await apiGet<{ success: boolean; availability?: Availability }>({
      action: 'getAvailability',
    });
    return res.success && res.availability ? res.availability : null;
  } catch {
    return null;
  }
}

/** Throws on network error so callers can fall back to the legacy flow. */
export async function placeOrderLive(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  return apiGet<PlaceOrderResult>({
    action: 'placeOrder',
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    deliveryArea: input.deliveryArea,
    orderTotal: String(input.orderTotal),
    orderSummary: input.orderSummary,
    itemCount: String(input.itemCount),
    deliverySlot: input.deliverySlot,
    expectedStatus: input.expectedStatus,
  });
}

export async function getOrderStatus(token: string): Promise<TrackedOrder | null> {
  try {
    const res = await apiGet<{ success: boolean; order?: TrackedOrder }>({
      action: 'getOrderStatus',
      token,
    });
    return res.success && res.order ? res.order : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS — capacity + slotUtils suites green.

- [ ] **Step 5: Commit**

```bash
git add src/services/orderService.ts tests/slotUtils.test.ts
git commit -m "feat: order service client with availability, placement and tracking"
```

---

### Task 7: CartDrawer rework — live picker, ASAP confirm, capacity-checked checkout

**Files:**
- Modify: `src/app/components/CartDrawer.tsx` (replace the whole file)

Behavior summary: on drawer open fetch availability; show 30-min slots with busy ones marked "Busy (needs confirmation)"; ASAP resolves to the earliest open slot and shows it before submit; checkout opens a blank tab synchronously, calls `placeOrderLive`, then navigates the tab to WhatsApp on success or closes it and refreshes slots on a race loss. If the availability service is unreachable, the picker **fails open** to locally generated slots and checkout uses the legacy fire-and-forget path. Checkout is disabled when ordering is paused or no slots remain today. New optional email field (used for confirmation/decline emails), persisted like name/phone.

- [ ] **Step 1: Replace `src/app/components/CartDrawer.tsx` entirely with:**

```tsx
import React from 'react'
import { useCart } from '../context/CartContext';
import { Button } from './ui/button';
import { Minus, Plus, Trash2, ShoppingBag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { submitOrder } from '../../services/crmService';
import { getAvailability, placeOrderLive, slotLabel, Availability, SlotInfo } from '../../services/orderService';

// Local fallback when the availability service is unreachable: same slot
// generation the site used before capacity control (fail open).
function fallbackSlots(): SlotInfo[] {
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
  return slots;
}

// I'll implement a custom drawer/sidebar since I haven't installed shadcn sheet fully
export function CartDrawer() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, isCartOpen, toggleCart } = useCart();
  const [paymentMethod, setPaymentMethod] = React.useState('Cash on Delivery');
  const [orderNotes, setOrderNotes] = React.useState('')
  const [address, setAddress] = React.useState('');
  const [customerName, setCustomerName] = React.useState(() => localStorage.getItem('bc_name') || '');
  const [customerPhone, setCustomerPhone] = React.useState(() => localStorage.getItem('bc_phone') || '');
  const [customerEmail, setCustomerEmail] = React.useState(() => localStorage.getItem('bc_email') || '');

  const [availability, setAvailability] = React.useState<Availability | null>(null);
  const [availLoading, setAvailLoading] = React.useState(false);
  // 'asap' or a 'HH:mm' slot time
  const [selectedSlot, setSelectedSlot] = React.useState<string>('asap');

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const applyAvailability = React.useCallback((a: Availability | null) => {
    setAvailability(a);
    if (!a || a.paused) return;
    setSelectedSlot(prev => {
      if (prev === 'asap') return a.asap ? 'asap' : (a.slots[0]?.time ?? 'asap');
      return a.slots.some(s => s.time === prev) ? prev : (a.asap ?? a.slots[0]?.time ?? 'asap');
    });
  }, []);

  React.useEffect(() => {
    if (!isCartOpen) return;
    let cancelled = false;
    setAvailLoading(true);
    getAvailability()
      .then(a => { if (!cancelled) applyAvailability(a); })
      .finally(() => { if (!cancelled) setAvailLoading(false); });
    return () => { cancelled = true; };
  }, [isCartOpen, applyAvailability]);

  const slots = availability && !availability.paused ? availability.slots : null;
  const selectedSlotInfo = slots?.find(s => s.time === selectedSlot) ?? null;
  const noSlotsLeft = !!availability && !availability.paused && availability.slots.length === 0;
  const orderingPaused = !!availability?.paused;
  const checkoutBlocked = orderingPaused || noSlotsLeft;

  const handleCheckout = async () => {
    if (isSubmitting || checkoutBlocked) return;
    setIsSubmitting(true);

    try {
      // Require name and phone before checkout
      if (!customerName.trim() || !customerPhone.trim()) {
        alert('Please enter your name and phone number to place an order.');
        return;
      }

      // Remember customer details for next time
      localStorage.setItem('bc_name', customerName.trim());
      localStorage.setItem('bc_phone', customerPhone.trim());
      if (customerEmail.trim()) localStorage.setItem('bc_email', customerEmail.trim());

      const orderSummary = items.map(item =>
        `${item.quantity}x ${item.name} (${item.price * item.quantity} EGP)`
      ).join('\n');
      const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

      // Open the WhatsApp tab synchronously (popup blockers require this);
      // we point it at the right URL after the capacity check completes.
      const waWindow = window.open('', '_blank');
      const navigateTo = (url: string) => {
        if (waWindow) waWindow.location.href = url;
        else window.location.href = url;
      };
      const baseText = `Hi Bistro Cloud! I'd like to place an order:\n\n${orderSummary}\n\nTotal: ${totalPrice} EGP\nPayment Method: ${paymentMethod}`;
      const contactText = `${customerName ? '\nName: ' + customerName : ''}${customerPhone ? '\nPhone: ' + customerPhone : ''}${orderNotes ? '\nNotes: ' + orderNotes : ''}`;

      if (availability && !availability.paused) {
        // ── Capacity-checked flow ──
        const slotTime = selectedSlot === 'asap' ? availability.asap : selectedSlot;
        if (!slotTime) {
          waWindow?.close();
          toast.error('No delivery times are available right now.');
          return;
        }
        const expectedStatus = selectedSlot === 'asap'
          ? 'open'
          : (selectedSlotInfo?.status ?? 'open');

        let result;
        try {
          result = await placeOrderLive({
            name: customerName.trim(),
            phone: customerPhone.trim(),
            email: customerEmail.trim(),
            address: address || orderNotes,
            deliveryArea: 'El Gouna',
            orderTotal: totalPrice,
            orderSummary,
            itemCount,
            deliverySlot: slotTime,
            expectedStatus,
          });
        } catch {
          // Network error mid-submit: fail open to the legacy flow.
          navigateTo(`https://wa.me/201221288804?text=${encodeURIComponent(
            `${baseText}\nDelivery Time: ${slotLabel(slotTime)}${contactText}\n\nPlease confirm delivery time.`)}`);
          submitOrder({
            name: customerName, phone: customerPhone, address: address || orderNotes,
            deliveryArea: 'El Gouna', orderTotal: totalPrice, orderSummary,
          }).catch(err => console.error('CRM save failed:', err));
          clearCart();
          toggleCart();
          return;
        }

        if (!result.success) {
          // Race loser: the slot filled between picker load and submit.
          waWindow?.close();
          if (result.availability) applyAvailability(result.availability);
          else getAvailability().then(applyAvailability);
          toast.error('That delivery time just filled up — please pick another one.');
          return;
        }

        const label = slotLabel(result.deliverySlot);
        const timeLine = result.status === 'pending_approval'
          ? `Requested Time: ${label} (busy slot — pending your confirmation)`
          : `Delivery Time: ${label} (confirmed)`;
        navigateTo(`https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\n${timeLine}${contactText}`)}`);

        if (result.status === 'pending_approval') {
          toast.success(`Order received! ${label} is busy — we'll confirm your time shortly.`);
        } else {
          toast.success(`Order confirmed for ${label}!`);
        }
      } else {
        // ── Legacy flow (availability service unreachable) ──
        const slotTimeLabel = selectedSlot === 'asap' ? 'As soon as possible' : slotLabel(selectedSlot);
        navigateTo(`https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\nDelivery Time: ${slotTimeLabel}${contactText}\n\nPlease confirm delivery time.`)}`);
        submitOrder({
          name: customerName, phone: customerPhone, address: address || orderNotes,
          deliveryArea: 'El Gouna', orderTotal: totalPrice, orderSummary,
        }).catch(err => console.error('CRM save failed:', err));
      }

      clearCart();
      toggleCart();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isCartOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={toggleCart}
            className="fixed inset-0 bg-black z-50 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b flex items-center justify-between bg-[#F9F5F0]">
              <h2 className="font-montserrat font-bold text-xl flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#D94E28]" />
                Your Order
              </h2>
              <button onClick={toggleCart} className="p-2 hover:bg-black/5 rounded-full">
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                    <ShoppingBag className="w-10 h-10" />
                  </div>
                  <p className="text-gray-500 font-medium">Your cart is empty</p>
                  <Button onClick={toggleCart} variant="outline">Browse Menu</Button>
                </div>
              ) : (
                items.map(item => (
                  <motion.div
                    layout
                    key={item.id}
                    className="flex gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm"
                  >
                    <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg bg-gray-100" />
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm">{item.name}</h3>
                        <p className="text-[#D94E28] font-bold text-sm">EGP {item.price}</p>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            disabled={item.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600 hover:text-[#D94E28]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-[#D94E28]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="p-6 border-t bg-[#F9F5F0] overflow-y-auto max-h-[60vh]">
                {/* Customer Info — show welcome if saved, form if not */}
                {customerName.trim() && customerPhone.trim() ? (
                  <div className="mb-6 p-4 bg-white rounded-xl border border-gray-100">
                    <p className="text-gray-800 text-sm">
                      Welcome back, <span className="font-bold text-[#D94E28]">{customerName.trim()}</span>!
                    </p>
                    <button
                      onClick={() => { setCustomerName(''); setCustomerPhone(''); localStorage.removeItem('bc_name'); localStorage.removeItem('bc_phone'); }}
                      className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                    >
                      Not you? Change details
                    </button>
                  </div>
                ) : (
                  <div className="mb-6">
                    <h3 className="font-bold text-gray-800 mb-3 text-sm">Your Details</h3>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                      />
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Phone Number (e.g. +20 122 128 8804)"
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                      />
                    </div>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Email <span className="font-normal text-gray-500">(optional — for order updates)</span></h3>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                  />
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Payment Method</h3>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] appearance-none"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                  >
                    {['Cash on Delivery', 'Instapay', 'Credit/Debit Card'].map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">
                    Delivery Time (2:00 PM - 8:00 PM)
                    {availLoading && <span className="font-normal text-gray-400"> — checking availability…</span>}
                  </h3>
                  {orderingPaused ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering is paused right now — please check back soon or{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>.
                    </p>
                  ) : noSlotsLeft ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering for today has closed —{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>{' '}
                      to arrange for tomorrow.
                    </p>
                  ) : (
                    <>
                      <select
                        value={selectedSlot}
                        onChange={(e) => setSelectedSlot(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] appearance-none"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      >
                        {(availability ? availability.asap !== null : true) && (
                          <option value="asap">
                            {availability?.asap ? `As soon as possible — ${slotLabel(availability.asap)}` : 'As soon as possible'}
                          </option>
                        )}
                        {(slots ?? fallbackSlots()).map((s) => (
                          <option key={s.time} value={s.time}>
                            {slotLabel(s.time)}{s.status === 'busy' ? ' — Busy (needs confirmation)' : ''}
                          </option>
                        ))}
                      </select>
                      {selectedSlot === 'asap' && availability?.asap && (
                        <p className="text-xs text-gray-500 mt-2">
                          Your order will be scheduled for <span className="font-semibold">{slotLabel(availability.asap)}</span> — the earliest available time.
                        </p>
                      )}
                      {selectedSlotInfo?.status === 'busy' && (
                        <p className="text-xs text-amber-600 mt-2">
                          This time is busy — we'll review your order and confirm the time shortly after you place it.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Notes / Address <span className="font-normal text-gray-500">(for first-time orders only)</span></h3>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Delivery address (first-time orders), allergies, special requests..."
                    rows={2}
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] resize-none"
                  />
                </div>
                <div className="flex justify-between items-center mb-6">
                  <span className="text-gray-600">Total</span>
                  <span className="font-montserrat font-bold text-2xl text-[#D94E28]">EGP {totalPrice}</span>
                </div>
                <Button
                  onClick={handleCheckout}
                  disabled={isSubmitting || checkoutBlocked}
                  className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#D94E28]/20 disabled:opacity-70"
                >
                  {isSubmitting ? 'Placing order...' : 'Checkout via WhatsApp'}
                </Button>
                <p className="text-center text-xs text-gray-500 mt-4">
                  Free delivery across all of El Gouna
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

Note: the unused `address` state is kept as-is (it existed before and is referenced in checkout via `address || orderNotes`).

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: vite build completes with no TypeScript/JSX errors.

- [ ] **Step 3: Verify behavior in the dev server**

Run: `npm run dev`, open the menu page, add an item, open the cart.
Expected: the Delivery Time select shows "checking availability…" then either live slots (if the deployed backend already has `getAvailability` — it won't until Task 11) or the local fallback slots. Checkout still opens WhatsApp. This confirms fail-open works before backend deploy.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/CartDrawer.tsx
git commit -m "feat: capacity-aware delivery slot picker and checkout in cart"
```

---

### Task 8: Admin — adminService additions + OrdersTab status workflow

**Files:**
- Modify: `src/services/adminService.ts`
- Modify: `src/app/pages/admin/OrdersTab.tsx` (replace the whole file)

The OrdersTab currently lists legacy orders from the old spreadsheet (`getOrders` → People sheet). It switches to the CRM Orders tab (`getCRMOrders` action, already deployed) where all new orders land, and gains the status workflow. Pending orders sort first.

- [ ] **Step 1: Add CRM order functions to `src/services/adminService.ts`**

Append at the end of the file:

```ts
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

export async function setOrderStatus(password: string, rowIndex: number, status: OrderStatus): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'setOrderStatus',
    password,
    rowIndex: String(rowIndex),
    status,
  });
  if (!res.success) throw new Error(res.error || 'Failed to update order status');
}
```

- [ ] **Step 2: Replace `src/app/pages/admin/OrdersTab.tsx` entirely with:**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { getCRMOrders, setOrderStatus, getStoredPassword, CRMOrder, OrderStatus } from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Loader2, Check, X, ChefHat, Bike, PackageCheck, Ban } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_approval: { label: 'Pending approval', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  preparing: { label: 'Being prepared', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  out_for_delivery: { label: 'Out for delivery', className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  delivered: { label: 'Delivered', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// Sort: pending first, then active statuses by slot, then finished rows.
const STATUS_ORDER: Record<string, number> = {
  pending_approval: 0, confirmed: 1, preparing: 1, out_for_delivery: 1,
  New: 2, delivered: 3, declined: 4, cancelled: 4,
};

function slotLabel12h(slot: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(slot)) return slot || '—';
  const [hStr, mStr] = slot.split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

export function OrdersTab({ l }: { l: AdminLang }) {
  const { tr } = l;
  const [orders, setOrders] = useState<CRMOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) return;
    try {
      const data = await getCRMOrders(pw);
      data.sort((a, b) => {
        const oa = STATUS_ORDER[a.status] ?? 2;
        const ob = STATUS_ORDER[b.status] ?? 2;
        if (oa !== ob) return oa - ob;
        return String(a.delivery_slot).localeCompare(String(b.delivery_slot));
      });
      setOrders(data);
    } catch (err) {
      toast.error(tr('failed_load_orders'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  async function changeStatus(order: CRMOrder, status: OrderStatus, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyRow(order._rowIndex);
    try {
      await setOrderStatus(pw, order._rowIndex, status);
      toast.success(`Order → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchOrders();
    } catch {
      toast.error('Failed to update order');
    } finally {
      setBusyRow(null);
    }
  }

  function rowActions(order: CRMOrder) {
    const busy = busyRow === order._rowIndex;
    if (busy) return <Loader2 className="size-4 animate-spin inline-block" />;
    switch (order.status) {
      case 'pending_approval':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => changeStatus(order, 'confirmed')}>
              <Check className="size-4 mr-1" />Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => changeStatus(order, 'declined', 'Decline this order? The customer will be notified.')}>
              <X className="size-4 mr-1" />Decline
            </Button>
          </div>
        );
      case 'confirmed':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'preparing')}>
              <ChefHat className="size-4 mr-1" />Preparing
            </Button>
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order? Its slot capacity will be freed.')}>
              <Ban className="size-4" />
            </Button>
          </div>
        );
      case 'preparing':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'out_for_delivery')}>
              <Bike className="size-4 mr-1" />Out for delivery
            </Button>
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order? Its slot capacity will be freed.')}>
              <Ban className="size-4" />
            </Button>
          </div>
        );
      case 'out_for_delivery':
        return (
          <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'delivered')}>
            <PackageCheck className="size-4 mr-1" />Delivered
          </Button>
        );
      default:
        return null;
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const pendingCount = orders.filter(o => o.status === 'pending_approval').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {tr('orders')} ({orders.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending approval</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchOrders(); }}>Refresh</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slot</TableHead>
            <TableHead>{tr('name')}</TableHead>
            <TableHead>{tr('contact')}</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>{tr('details')}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">{tr('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map(order => {
            const badge = STATUS_BADGE[order.status];
            return (
              <TableRow key={order._rowIndex} className={order.status === 'pending_approval' ? 'bg-amber-50/50' : undefined}>
                <TableCell className="font-medium whitespace-nowrap">
                  {slotLabel12h(String(order.delivery_slot))}
                  <div className="text-xs text-muted-foreground">{String(order.delivery_date || '')}</div>
                </TableCell>
                <TableCell className="font-medium">{order.name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{order.phone || order.email || '—'}</TableCell>
                <TableCell>{order.item_count || '—'}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={String(order.order_summary)}>
                  {order.order_summary || '—'}
                  {order.order_total ? <span className="block text-xs font-medium text-foreground">{order.order_total} EGP</span> : null}
                </TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{order.status || '—'}</Badge>}
                </TableCell>
                <TableCell className="text-right">{rowActions(order)}</TableCell>
              </TableRow>
            );
          })}
          {orders.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{tr('no_orders')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/adminService.ts src/app/pages/admin/OrdersTab.tsx
git commit -m "feat: CRM orders status workflow in admin panel (approve/decline/advance/cancel)"
```

---

# PHASE 2 — Visibility (status emails + tracking page)

### Task 9: Status-update emails on preparing / out for delivery / delivered

**Files:**
- Modify: `apps-script/admin-api.gs`

- [ ] **Step 1: Add `sendStatusUpdateEmail`**

Immediately after `sendOrderDeclineEmail`, insert:

```js
var STATUS_EMAIL_COPY = {
  preparing: {
    subject: 'Your Bistro Cloud order is being prepared',
    heading: 'The kitchen is on it!',
    body: 'Your order is being freshly prepared right now.',
  },
  out_for_delivery: {
    subject: 'Your Bistro Cloud order is out for delivery',
    heading: 'On the way!',
    body: 'Your order has left the kitchen and is on its way to you.',
  },
  delivered: {
    subject: 'Your Bistro Cloud order has been delivered',
    heading: 'Enjoy your meal!',
    body: 'Your order has been delivered. Thank you for ordering with Bistro Cloud!',
  },
};

/** orderInfo: { name, email, deliverySlot, trackingToken }, status: key of STATUS_EMAIL_COPY */
function sendStatusUpdateEmail(orderInfo, status) {
  try {
    if (!orderInfo.email) return;
    var copy = STATUS_EMAIL_COPY[status];
    if (!copy) return;
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">' + copy.heading + '</h2>' +
      '<p style="color: #555; line-height: 1.6;">' + copy.body + '</p>' +
      '<p style="color: #555; line-height: 1.6;">Scheduled time: <strong>' + slotLabel12h(orderInfo.deliverySlot) + '</strong></p>' +
      '<div style="text-align: center; margin: 25px 0;">' +
        '<a href="' + orderTrackingUrl(orderInfo.trackingToken) + '" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Track your order</a>' +
      '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: copy.subject,
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Status email failed: ' + error.toString());
  }
}

function orderTrackingUrl(token) {
  return 'https://bistro-cloud.com/track?token=' + token;
}
```

- [ ] **Step 2: Hook it into `orderSetStatus`**

In `orderSetStatus`, replace the line:

```js
  // Phase 2 hook: status-update emails for preparing/out_for_delivery/delivered.
```

with:

```js
  } else if (newStatus === 'preparing' || newStatus === 'out_for_delivery' || newStatus === 'delivered') {
    sendStatusUpdateEmail(orderInfo, newStatus);
```

so the chain reads `if (confirmed && was pending) ... else if (declined) ... else if (preparing|out_for_delivery|delivered) ...`.

- [ ] **Step 3: Add the tracking link to the confirmation email**

In `sendOrderConfirmationEmail`, after the closing `'</div>'` of the order-summary block and before the `MailApp.sendEmail({` call, extend `inner`:

```js
    inner += '<div style="text-align: center; margin: 25px 0;">' +
      '<a href="' + orderTrackingUrl(orderInfo.trackingToken) + '" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Track your order</a>' +
    '</div>';
```

(Declare `inner` with `var inner = ...` as before; this line concatenates onto it.)

- [ ] **Step 4: Verify locally + commit**

Run: `npm test`
Expected: PASS.

```bash
git add apps-script/admin-api.gs
git commit -m "feat: status-update emails and tracking links (Phase 2 backend)"
```

---

### Task 10: Tracking page (`/track`)

**Files:**
- Create: `src/app/pages/Track.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/components/CartDrawer.tsx` (add tracking link to WhatsApp text)

- [ ] **Step 1: Create `src/app/pages/Track.tsx`**

```tsx
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, ChefHat, Bike, PackageCheck, Clock, XCircle } from 'lucide-react';
import { getOrderStatus, slotLabel, TrackedOrder } from '../../services/orderService';

const STEPS = [
  { key: 'confirmed', label: 'Confirmed', Icon: CheckCircle2 },
  { key: 'preparing', label: 'Being prepared', Icon: ChefHat },
  { key: 'out_for_delivery', label: 'Out for delivery', Icon: Bike },
  { key: 'delivered', label: 'Delivered', Icon: PackageCheck },
];

const POLL_MS = 20000;

export function TrackPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [order, setOrder] = React.useState<TrackedOrder | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'notfound'>('loading');

  React.useEffect(() => {
    if (!token) { setState('notfound'); return; }
    let cancelled = false;
    const load = async () => {
      const o = await getOrderStatus(token);
      if (cancelled) return;
      if (o) { setOrder(o); setState('ready'); }
      else if (state === 'loading') setState('notfound');
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#D94E28]" />
      </div>
    );
  }

  if (state === 'notfound' || !order) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Order not found</h1>
        <p className="text-gray-500 mb-6">This tracking link doesn't match any order.</p>
        <a href="https://wa.me/201221288804" className="bg-[#D94E28] text-white font-bold px-6 py-3 rounded-xl">
          Chat with us on WhatsApp
        </a>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex(s => s.key === order.status);
  const isPending = order.status === 'pending_approval';
  const isDead = order.status === 'declined' || order.status === 'cancelled';

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <h1 className="font-montserrat font-bold text-3xl text-gray-800 mb-1">
        {order.name ? `${order.name}'s order` : 'Your order'}
      </h1>
      <p className="text-gray-500 mb-8">
        Scheduled for today at <span className="font-semibold text-gray-700">{order.deliverySlot ? slotLabel(order.deliverySlot) : '—'}</span>
      </p>

      {isPending && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
          <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            That time slot is busy — we're reviewing your order and will confirm your delivery time shortly. This page updates automatically.
          </p>
        </div>
      )}

      {isDead && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-8">
          <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">
            {order.status === 'declined'
              ? "We're sorry — we couldn't fit this order in. Check your email for available times, or WhatsApp us."
              : 'This order has been cancelled. WhatsApp us if that doesn\'t look right.'}
          </p>
        </div>
      )}

      {!isDead && (
        <ol className="space-y-0 mb-10">
          {STEPS.map((step, i) => {
            const done = stepIndex >= i;
            const current = stepIndex === i;
            return (
              <li key={step.key} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                    done ? 'bg-[#D94E28] border-[#D94E28] text-white' : 'bg-white border-gray-200 text-gray-300'
                  }`}>
                    <step.Icon className="w-5 h-5" />
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-0.5 h-8 ${stepIndex > i ? 'bg-[#D94E28]' : 'bg-gray-200'}`} />
                  )}
                </div>
                <div className="pt-2">
                  <p className={`font-semibold ${done ? 'text-gray-800' : 'text-gray-400'}`}>
                    {step.label}{current ? ' ●' : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="bg-[#F9F5F0] rounded-xl p-5">
        <h2 className="font-bold text-sm text-gray-800 mb-2">Order summary</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line">{order.orderSummary || '—'}</p>
        {order.orderTotal ? (
          <p className="text-sm font-bold text-[#D94E28] mt-2">Total: {order.orderTotal} EGP</p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/app/App.tsx`, add the import:

```tsx
import { TrackPage } from './pages/Track';
```

and inside the `<Route path="/" element={<Layout />}>` block, after the `contact` route, add:

```tsx
          <Route path="track" element={<TrackPage />} />
```

- [ ] **Step 3: Add the tracking link to the WhatsApp message**

In `src/app/components/CartDrawer.tsx`, in the capacity-checked success branch of `handleCheckout`, replace:

```tsx
        navigateTo(`https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\n${timeLine}${contactText}`)}`);
```

with:

```tsx
        navigateTo(`https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\n${timeLine}${contactText}\nTrack: https://bistro-cloud.com/track?token=${result.trackingToken}`)}`);
```

- [ ] **Step 4: Verify**

Run: `npm run build` — expect no errors.
Run: `npm run dev`, open `http://localhost:5173/track?token=nonsense` — expect the "Order not found" state (the deployed backend will 404 the token or be unreachable; both render notfound).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/Track.tsx src/app/App.tsx src/app/components/CartDrawer.tsx
git commit -m "feat: customer order tracking page with live status timeline"
```

---

# DEPLOYMENT & LIVE QA

### Task 11: Deploy the Apps Script backend (MANUAL — requires the user)

This task cannot be done by an agent alone — the Apps Script project lives in the user's Google account. Walk the user through it.

- [ ] **Step 1: Update the Apps Script project**

In [script.google.com](https://script.google.com), open the project backing the web app:
1. Create a new script file named `capacity` and paste the full contents of `apps-script/capacity.gs`.
2. Replace the contents of the main file with the updated `apps-script/admin-api.gs`.

- [ ] **Step 2: Run one-time setup functions (in this order)**

From the editor's Run menu, run each and grant permissions when prompted (Calendar access is new):
1. `migrateOrdersTab` — check the log says which columns were added.
2. `setupCapacitySettings` — check the CRM sheet now has a Settings tab with 7 rows.
3. `getKitchenCalendar` — creates the "Bistro Kitchen" calendar; verify it appears in Google Calendar (share it with kitchen staff phones).

- [ ] **Step 3: Deploy a new version**

Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy. **Do not create a new deployment** — editing the existing one keeps the URL that the site already calls.

- [ ] **Step 4: Smoke-test the endpoints**

```bash
curl -sL 'https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec?action=getAvailability'
```

Expected: JSON with `"success":true` and a `slots` array (empty after 7:30 PM Cairo time — that's correct lead-time behavior, re-test in the morning if so).

```bash
curl -sL '.../exec?action=getOrderStatus&token=bogus'
```

Expected: `{"success":false,"error":"Order not found"}`

- [ ] **Step 5: Push the site**

```bash
git push origin main
```

Expected: the GitHub Actions "Deploy to GitHub Pages" workflow goes green and bistro-cloud.com serves the new build (allow a few minutes).

### Task 12: Live QA — verify capacity behavior empirically

Use the `/browse` or `/qa` skill (or manual browsing) against https://bistro-cloud.com after Task 11.

- [ ] **QA 1 — picker shows live slots:** open the cart during working hours; the time select lists slots with no "Busy" markers on a fresh day; ASAP shows the earliest time.
- [ ] **QA 2 — capacity math (items cap):** place test orders (or add rows directly to the Orders sheet) totaling 6 items in one hour with status `confirmed`; reload the cart → both 30-min slots of that hour show "Busy (needs confirmation)".
- [ ] **QA 3 — orders cap:** seed 4 one-item confirmed orders in another hour → that hour shows busy.
- [ ] **QA 4 — race condition:** open the cart in two browser tabs; seed the sheet so one slot has 3 of 4 orders; submit both tabs to the same slot within seconds. Exactly one confirms; the other gets the "just filled up" toast and a refreshed picker.
- [ ] **QA 5 — approval queue:** pick a busy slot, place the order → toast says pending; AdminPanel → Orders shows it amber with Approve/Decline; Approve → calendar event appears in "Bistro Kitchen" + confirmation email arrives (if email given); Decline (on a second test order) → decline email lists open times.
- [ ] **QA 6 — tracking page:** open the Track link from the WhatsApp text → timeline shows the current status; tap "Preparing" then "Out for delivery" in the AdminPanel → page updates within ~20s each time; status emails arrive.
- [ ] **QA 7 — pause toggle:** set `paused` to `TRUE` in the Settings tab → cart shows the paused notice and checkout disabled; revert to `FALSE`.
- [ ] **QA 8 — cleanup:** delete all test rows from Orders + Pipeline tabs and test events from the kitchen calendar.
- [ ] **Final commit/tag if all green.**

---

## Out of scope (per spec)

Future-date ordering, item-weighted capacity, per-dish caps, online payments, WhatsApp Business API push, reminder emails, self-service reschedule/cancel (Phase 3), cal.com.
