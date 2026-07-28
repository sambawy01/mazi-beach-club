-- ============================================================================
-- 20260711120000_admin_catalog.sql
-- MAZI — Native admin catalog + inventory backend
--
-- Replaces the external Google Apps Script sheets behind six admin tabs:
--   Menu, Pantry, Stock, Recipes, Requisitions.
--
-- Tables: admin_menu_items, pantry_products, inventory_stock, recipes,
-- requisitions. Categories are FREE-TEXT (live data contains Arabic category
-- names) — do NOT enum them. Visibility is driven solely by `status` — the
-- legacy `hidden` column is intentionally dropped.
--
-- NOTE: the admin catalog menu table is named `admin_menu_items` (NOT
-- `menu_items`) to avoid colliding with the pre-existing customer-facing ORDERING
-- menu table `menu_items` from the init schema (20260627225354_init_schema.sql),
-- which has a completely different shape. api/menu.js maps resource=menu to this
-- `admin_menu_items` table.
-- This migration is delivered NOT applied, per task constraints.
-- ============================================================================

-- pgcrypto provides gen_random_uuid(); already created by init schema, harmless.
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- ── Menu Items (admin-editable catalog) ───────────────────────────────────
-- Named admin_menu_items to avoid colliding with the customer-facing ordering
-- `menu_items` table from the init schema.
create table if not exists admin_menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  description text default '',
  price       numeric default 0,
  category    text default '',            -- FREE-TEXT (may be Arabic)
  image       text default '',
  dietary     text default '',
  status      text default 'available',   -- available | hidden | limited | sold_out
  created_at  timestamptz default now()
);

-- ── Pantry Products (same shape as admin_menu_items) ──────────────────────
create table if not exists pantry_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  description text default '',
  price       numeric default 0,
  category    text default '',            -- FREE-TEXT (may be Arabic)
  image       text default '',
  dietary     text default '',
  status      text default 'available',   -- available | hidden | limited | sold_out
  created_at  timestamptz default now()
);

-- ── Inventory Stock ───────────────────────────────────────────────────────
create table if not exists inventory_stock (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '',
  category      text default '',          -- FREE-TEXT (may be Arabic)
  unit          text default 'kg',
  qty_on_hand   numeric default 0,
  min_level     numeric default 0,
  cost_per_unit numeric default 0,
  supplier      text default '',
  last_restocked date,
  notes         text default '',
  created_at    timestamptz default now()
);

-- ── Recipes (menu item → ingredient bill of materials) ────────────────────
create table if not exists recipes (
  id          uuid primary key default gen_random_uuid(),
  menu_item   text not null default '',
  ingredient  text not null default '',
  qty_needed  numeric default 0,
  unit        text default 'g',
  created_at  timestamptz default now()
);

-- ── Requisitions (stock movement log) ─────────────────────────────────────
create table if not exists requisitions (
  id            uuid primary key default gen_random_uuid(),
  date          date,
  type          text default '',          -- Restock | Recipe | Manual | ...
  item_name     text default '',
  quantity      numeric default 0,
  direction     text default 'OUT',       -- IN | OUT
  performed_by  text default '',
  notes         text default '',
  status        text default 'Pending',   -- Pending | Approved | Rejected | Out of Stock
  created_at    timestamptz default now()
);

-- ── Indexes for common admin queries ──────────────────────────────────────
create index if not exists idx_admin_menu_items_created on admin_menu_items(created_at desc);
create index if not exists idx_pantry_products_created on pantry_products(created_at desc);
create index if not exists idx_inventory_stock_name on inventory_stock(lower(name));
create index if not exists idx_recipes_menu_item on recipes(lower(menu_item));
create index if not exists idx_requisitions_created on requisitions(created_at desc);
create index if not exists idx_requisitions_status on requisitions(status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Match the existing tables: RLS enabled, service_role has full access.
-- The server uses SUPABASE_SERVICE_ROLE_KEY, so it bypasses RLS as service_role.
-- No anon/public policies — this data is admin-only.
-- ============================================================================
alter table admin_menu_items enable row level security;
alter table pantry_products enable row level security;
alter table inventory_stock enable row level security;
alter table recipes         enable row level security;
alter table requisitions    enable row level security;

drop policy if exists "admin_menu_items_admin_all" on admin_menu_items;
create policy "admin_menu_items_admin_all" on admin_menu_items
  for all using (auth.role() = 'service_role');

drop policy if exists "pantry_products_admin_all" on pantry_products;
create policy "pantry_products_admin_all" on pantry_products
  for all using (auth.role() = 'service_role');

drop policy if exists "inventory_stock_admin_all" on inventory_stock;
create policy "inventory_stock_admin_all" on inventory_stock
  for all using (auth.role() = 'service_role');

drop policy if exists "recipes_admin_all" on recipes;
create policy "recipes_admin_all" on recipes
  for all using (auth.role() = 'service_role');

drop policy if exists "requisitions_admin_all" on requisitions;
create policy "requisitions_admin_all" on requisitions
  for all using (auth.role() = 'service_role');

-- ============================================================================
-- FUNCTION: restock_item
-- Atomically increments stock, stamps last_restocked, and logs an approved
-- IN requisition. Returns the updated inventory_stock row.
-- ============================================================================
create or replace function restock_item(
  p_id          uuid,
  p_quantity    numeric,
  p_performed_by text
)
returns inventory_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row inventory_stock;
begin
  update inventory_stock
     set qty_on_hand    = qty_on_hand + p_quantity,
         last_restocked = current_date
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'stock item % not found', p_id;
  end if;

  insert into requisitions (date, type, item_name, quantity, direction, performed_by, notes, status)
  values (
    current_date,
    'Restock',
    v_row.name,
    p_quantity,
    'IN',
    p_performed_by,
    'Restocked +' || p_quantity,
    'Approved'
  );

  return v_row;
end;
$$;

-- Lock down: only the server's service_role may call this SECURITY DEFINER
-- function. Revoke from the browser-reachable anon/authenticated roles so the
-- RPC can't be used to bypass RLS. Idempotent.
revoke all on function restock_item(uuid, numeric, text) from public, anon, authenticated;
grant execute on function restock_item(uuid, numeric, text) to service_role;

-- ============================================================================
-- FUNCTION: approve_requisition
-- Idempotent approval. For OUT movements with positive quantity, deducts the
-- matching stock (case-insensitive name match, floored at 0). If no stock row
-- matches, still approves but returns a warning. Returns a jsonb result.
-- ============================================================================
create or replace function approve_requisition(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      requisitions;
  v_stock_id uuid;
  v_warning  text := null;
begin
  select * into v_req from requisitions where id = p_id for update;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'not found');
  end if;

  if v_req.status = 'Approved' then
    return jsonb_build_object('ok', false, 'error', 'already approved');
  end if;

  if v_req.direction = 'OUT' and v_req.quantity > 0 then
    select id into v_stock_id
      from inventory_stock
     where lower(name) = lower(v_req.item_name)
     limit 1
     for update;

    if v_stock_id is not null then
      update inventory_stock
         set qty_on_hand = greatest(0, qty_on_hand - v_req.quantity)
       where id = v_stock_id;
    else
      v_warning := 'stock item not found';
    end if;
  end if;

  update requisitions set status = 'Approved' where id = p_id;

  if v_warning is not null then
    return jsonb_build_object('ok', true, 'warning', v_warning);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Lock down: only the server's service_role may call this SECURITY DEFINER
-- function. Revoke from the browser-reachable anon/authenticated roles so the
-- RPC can't be used to bypass RLS. Idempotent.
revoke all on function approve_requisition(uuid) from public, anon, authenticated;
grant execute on function approve_requisition(uuid) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
