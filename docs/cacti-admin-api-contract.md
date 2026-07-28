# Mazi Admin API Contract — Menu, Pantry, Inventory

Source of truth for the native Supabase-backed admin endpoints that replace the
external Google Apps Script behind the admin **Menu, Pantry, Stock, Recipes, and
Requisitions** tabs.

- Endpoints: `api/menu.js`, `api/inventory.js` (Vercel serverless functions).
- Data: Supabase, migration `supabase/migrations/20260711120000_admin_catalog.sql`.

> **Note.** The admin catalog menu table is named `admin_menu_items` (not
> `menu_items`) so it never collides with the pre-existing customer-facing
> *ordering* menu table `menu_items` from the init schema, which has a different
> shape. `?resource=menu` maps to `admin_menu_items`.

---

## Conventions (apply to every endpoint)

### Authentication
Every request MUST send:

```
Authorization: Bearer <ADMIN_PASSWORD>
```

`ADMIN_PASSWORD` comes from `process.env.ADMIN_PASSWORD` (default `mazi2025`).
On mismatch or missing token the endpoint returns **HTTP 401**:

```json
{ "ok": false, "error": "Unauthorized" }
```

### Response envelope
- Success: `{ "ok": true }` or `{ "ok": true, "data": <row | row[] | jsonb> }`
- Error: `{ "ok": false, "error": "<message>" }`

### Identifiers
Every record exposes `id` — a **UUID string**. There is **no row index**. All
edit / delete / toggle / restock / approve operations target a record by its `id`.

### HTTP status codes
| Status | Meaning |
| --- | --- |
| 200 | Success (envelope `ok:true`), or a handled RPC result |
| 400 | Unknown resource / unknown action / missing required param |
| 401 | Auth failed |
| 404 | Record not found (edit/toggle/reject/out_of_stock) |
| 405 | Method not allowed for that resource/action |
| 500 | DB not configured, or server/DB error |

### Request format
- `resource` and `action` are **query-string** params (`?resource=X&action=Y`).
- Mutation payloads (`add`/`edit`/`delete`/`toggle`/`restock`/`approve`/…) are
  sent as a **JSON body** with `Content-Type: application/json`.
- Only whitelisted columns are accepted from the body; `id` and `created_at`
  are never client-settable.

---

## `api/menu.js`

`resource` ∈ `{ menu, pantry }`. Mapping: `menu → admin_menu_items`,
`pantry → pantry_products`. Both resources share the identical shape and actions.

### GET `?resource=<menu|pantry>&action=list`
Returns all rows, newest first (`created_at DESC`).

Response:
```json
{ "ok": true, "data": [ /* MenuRecord[] */ ] }
```

### POST `?resource=<menu|pantry>&action=add`
Body (all optional; omitted fields take table defaults):
```json
{
  "name": "Grilled Calamari",
  "description": "...",
  "price": 240,
  "category": "مقبلات",
  "image": "https://...",
  "dietary": "Gluten-Free",
  "status": "available"
}
```
Response: `{ "ok": true, "data": <MenuRecord> }` (the created row, with `id`).

### POST `?resource=<menu|pantry>&action=edit`
Body: `{ "id": "<uuid>", ...fields }` — any subset of the writable fields above.
Response: `{ "ok": true, "data": <MenuRecord> }` (updated row). 404 if no match.

### POST `?resource=<menu|pantry>&action=delete`
Body: `{ "id": "<uuid>" }`.
Response: `{ "ok": true }`.

### POST `?resource=<menu|pantry>&action=toggle`
Sets visibility via `status`. Body: `{ "id": "<uuid>", "status": "hidden" }`.
Allowed `status` values: `available` | `hidden` | `limited` | `sold_out`.
Response: `{ "ok": true, "data": <MenuRecord> }` (updated row). 404 if no match.

**Writable fields (`add`/`edit`):** `name`, `description`, `price`, `category`,
`image`, `dietary`, `status`.

---

## `api/inventory.js`

`resource` ∈ `{ stock, recipes, requisitions }`.

### Stock — `resource=stock` (table `inventory_stock`)

#### GET `?resource=stock&action=list`
Response: `{ "ok": true, "data": [ /* StockRecord[] */ ] }` (newest first).

#### POST `?resource=stock&action=add`
Body (all optional): `name`, `category`, `unit`, `qty_on_hand`, `min_level`,
`cost_per_unit`, `supplier`, `last_restocked` (date `YYYY-MM-DD`), `notes`.
Response: `{ "ok": true, "data": <StockRecord> }`.

#### POST `?resource=stock&action=edit`
Body: `{ "id": "<uuid>", ...fields }`. Response: `{ "ok": true, "data": <StockRecord> }`. 404 if no match.

#### POST `?resource=stock&action=delete`
Body: `{ "id": "<uuid>" }`. Response: `{ "ok": true }`.

#### POST `?resource=stock&action=restock`
Body: `{ "id": "<uuid>", "quantity": 5, "performed_by": "Sam" }`.
Calls the `restock_item` RPC atomically:
- `qty_on_hand += quantity`, `last_restocked = current_date`
- inserts an approved `IN` requisition (`type: 'Restock'`, `direction: 'IN'`,
  `status: 'Approved'`, `notes: 'Restocked +<quantity>'`, `date: current_date`).

Response: `{ "ok": true, "data": <StockRecord> }` (the updated stock row).
`quantity` must be a finite number → else 400 `{ ok:false, error:'Invalid quantity' }`.

### Recipes — `resource=recipes` (table `recipes`)

#### GET `?resource=recipes&action=list`
Response: `{ "ok": true, "data": [ /* RecipeRecord[] */ ] }` (newest first).

#### GET `?resource=recipes&action=for&menu_item=<NAME>`
Case-insensitive exact match on `menu_item` (`ILIKE`).
Response: `{ "ok": true, "data": [ /* RecipeRecord[] */ ] }`.
Missing `menu_item` → 400.

#### POST `?resource=recipes&action=add`
Body (all optional): `menu_item`, `ingredient`, `qty_needed`, `unit`.
Response: `{ "ok": true, "data": <RecipeRecord> }`.

#### POST `?resource=recipes&action=edit`
Body: `{ "id": "<uuid>", ...fields }`. Response: `{ "ok": true, "data": <RecipeRecord> }`. 404 if no match.

#### POST `?resource=recipes&action=delete`
Body: `{ "id": "<uuid>" }`. Response: `{ "ok": true }`.

### Requisitions — `resource=requisitions` (table `requisitions`)

#### GET `?resource=requisitions&action=list`
Response: `{ "ok": true, "data": [ /* RequisitionRecord[] */ ] }` ordered by
`created_at DESC`.

#### POST `?resource=requisitions&action=add`
Body (all optional): `date` (`YYYY-MM-DD`), `type`, `item_name`, `quantity`,
`direction` (`IN`|`OUT`), `performed_by`, `notes`, `status`.
Response: `{ "ok": true, "data": <RequisitionRecord> }`.

#### POST `?resource=requisitions&action=edit`
Body: `{ "id": "<uuid>", ...fields }`. Response: `{ "ok": true, "data": <RequisitionRecord> }`. 404 if no match.

#### POST `?resource=requisitions&action=delete`
Body: `{ "id": "<uuid>" }`. Response: `{ "ok": true }`.

#### POST `?resource=requisitions&action=approve`
Body: `{ "id": "<uuid>" }`. Calls the `approve_requisition` RPC. The endpoint
always returns HTTP 200 with `{ "ok": true, "data": <rpcResult> }`, where the RPC
result (`data`) is one of:
- `{ "ok": true }` — approved, stock deducted (if `direction='OUT'` & `quantity>0`).
- `{ "ok": true, "warning": "stock item not found" }` — approved, but no matching
  `inventory_stock` row to deduct from.
- `{ "ok": false, "error": "already approved" }` — status was already `Approved`.
- `{ "ok": false, "error": "not found" }` — no requisition with that id.

> Note the two `ok` layers: the HTTP envelope `ok` reports whether the call was
> processed; `data.ok` reports the business outcome of the approval. Clients
> should check `data.ok` and read `data.warning` / `data.error`.

Approval logic: idempotent. For `direction='OUT'` with `quantity>0`, finds
`inventory_stock` where `lower(name)=lower(item_name)` and sets
`qty_on_hand = greatest(0, qty_on_hand - quantity)`. Then sets requisition
`status='Approved'`.

#### POST `?resource=requisitions&action=reject`
Body: `{ "id": "<uuid>" }`. Sets `status='Rejected'` (no stock change).
Response: `{ "ok": true, "data": <RequisitionRecord> }`. 404 if no match.

#### POST `?resource=requisitions&action=out_of_stock`
Body: `{ "id": "<uuid>" }`. Sets `status='Out of Stock'` (no stock change).
Response: `{ "ok": true, "data": <RequisitionRecord> }`. 404 if no match.

**Writable fields (`add`/`edit`)** per resource:
- stock: `name`, `category`, `unit`, `qty_on_hand`, `min_level`, `cost_per_unit`, `supplier`, `last_restocked`, `notes`
- recipes: `menu_item`, `ingredient`, `qty_needed`, `unit`
- requisitions: `date`, `type`, `item_name`, `quantity`, `direction`, `performed_by`, `notes`, `status`

---

## TypeScript record shapes

These reflect exactly what the endpoints return (columns from the migration).
`id` is a UUID string; `created_at` is an ISO timestamp string.

```ts
// resource=menu (admin_menu_items) AND resource=pantry (pantry_products)
export interface MenuRecord {
  id: string;                 // uuid
  name: string;
  description: string;
  price: number;              // numeric
  category: string;           // FREE-TEXT (may be Arabic)
  image: string;
  dietary: string;
  status: string;             // 'available' | 'hidden' | 'limited' | 'sold_out'
  created_at: string;         // ISO timestamptz
}

// resource=stock (inventory_stock)
export interface StockRecord {
  id: string;                 // uuid
  name: string;
  category: string;           // FREE-TEXT
  unit: string;               // default 'kg'
  qty_on_hand: number;
  min_level: number;
  cost_per_unit: number;
  supplier: string;
  last_restocked: string | null; // date 'YYYY-MM-DD' or null
  notes: string;
  created_at: string;
}

// resource=recipes (recipes)
export interface RecipeRecord {
  id: string;                 // uuid
  menu_item: string;
  ingredient: string;
  qty_needed: number;
  unit: string;               // default 'g'
  created_at: string;
}

// resource=requisitions (requisitions)
export interface RequisitionRecord {
  id: string;                 // uuid
  date: string | null;        // 'YYYY-MM-DD' or null
  type: string;               // 'Restock' | 'Recipe' | 'Manual' | ...
  item_name: string;
  quantity: number;
  direction: string;          // 'IN' | 'OUT'
  performed_by: string;
  notes: string;
  status: string;             // 'Pending' | 'Approved' | 'Rejected' | 'Out of Stock'
  created_at: string;
}

// RPC result of approve_requisition (returned under `data`)
export interface ApproveResult {
  ok: boolean;
  warning?: string;           // 'stock item not found'
  error?: string;             // 'already approved' | 'not found'
}
```

> **Migration note:** these shapes drop the legacy `_rowIndex` and numeric `id`
> from the old `AdminItem` / `StockItem` / `Recipe` / `Requisition` interfaces,
> and drop the legacy `hidden` column (visibility now lives solely in `status`).
> The frontend must migrate to `id: string` and index-free calls.
