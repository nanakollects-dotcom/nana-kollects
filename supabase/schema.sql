-- Nana Kollects Business Tracker
-- Phase 2 Supabase schema design only.
-- This file does not contain project URLs, anon keys, or app runtime code.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  business_name text default 'Nana Kollects',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  collection_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint collections_user_name_unique unique (user_id, name)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  sku text not null,
  name text not null,
  cost numeric(12,2),
  price numeric(12,2) not null default 0,
  status text not null default 'Available',
  date_added date,
  sold_at timestamptz,
  written_off_at timestamptz,
  archived_at timestamptz,
  payment_status text,
  platform text,
  locked boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_user_sku_unique unique (user_id, sku),
  constraint inventory_items_id_user_unique unique (id, user_id),
  constraint inventory_items_cost_nonnegative check (cost >= 0),
  constraint inventory_items_price_nonnegative check (price >= 0),
  constraint inventory_items_status_check check (
    status in ('Available', 'Reserved', 'Sold', 'Written Off', 'Archived')
  ),
  constraint inventory_items_payment_status_check check (
    payment_status is null or payment_status in ('Paid', 'Pending')
  ),
  constraint inventory_items_platform_check check (
    platform is null or platform in ('Facebook', 'Instagram', 'TikTok', 'Direct Customer', 'Walk-in', 'Other')
  )
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  collection_id uuid references public.collections(id) on delete set null,
  sku_snapshot text,
  item_name_snapshot text,
  cost_snapshot numeric(12,2),
  sale_price numeric(12,2) not null default 0,
  profit_snapshot numeric(12,2) generated always as (sale_price - cost_snapshot) stored,
  platform text not null,
  payment_status text not null default 'Paid',
  sale_date date not null,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_cost_nonnegative check (cost_snapshot >= 0),
  constraint sales_id_user_unique unique (id, user_id),
  constraint sales_price_nonnegative check (sale_price >= 0),
  constraint sales_platform_check check (
    platform in ('Facebook', 'Instagram', 'TikTok', 'Direct Customer', 'Walk-in', 'Other')
  ),
  constraint sales_payment_status_check check (
    payment_status in ('Paid', 'Pending')
  )
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  collection_id uuid references public.collections(id) on delete set null,
  category text not null,
  amount numeric(12,2) not null default 0,
  details text,
  sku_snapshot text,
  item_name_snapshot text,
  expense_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_amount_nonnegative check (amount >= 0),
  constraint expenses_category_check check (
    category in ('Packaging', 'Shipping', 'Marketing', 'Supplies', 'Write-Off', 'Operating', 'Other')
  )
);

create table if not exists public.capital_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null default 0,
  details text,
  record_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capital_records_amount_nonnegative check (amount >= 0),
  constraint capital_records_type_check check (
    type in ('Capital Added', 'Withdrawal')
  )
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text,
  entity_id uuid,
  action text not null,
  label text,
  details text,
  amount numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  activity_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  cost numeric(12,2),
  purchase_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_purchases_cost_nonnegative check (cost >= 0)
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_user_key_unique unique (user_id, key)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_number text not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  customer_name text not null,
  customer_contact text not null,
  shipping_address text,
  item_name_snapshot text not null,
  item_price numeric(12,2) not null,
  shipping_fee numeric(12,2) not null default 0,
  shipping_mode text not null default 'fee_now',
  courier text,
  discount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  status text not null default 'Pending',
  issued_at timestamptz not null default now(),
  valid_until date,
  customer_note text,
  payment_config_snapshot jsonb not null default '{}'::jsonb,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_requests_user_number_unique unique (user_id, request_number),
  constraint payment_requests_id_user_unique unique (id, user_id),
  constraint payment_requests_item_price_nonnegative check (item_price >= 0),
  constraint payment_requests_shipping_nonnegative check (shipping_fee >= 0),
  constraint payment_requests_discount_nonnegative check (discount >= 0),
  constraint payment_requests_total_nonnegative check (total_amount >= 0),
  constraint payment_requests_shipping_mode_check check (shipping_mode in ('fee_now', 'to_follow', 'pickup')),
  constraint payment_requests_status_check check (status in ('Pending', 'Paid', 'Cancelled')),
  constraint payment_requests_method_check check (payment_method is null or payment_method in ('GCash', 'GoTyme'))
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_number text not null,
  source_type text not null default 'payment_request',
  source_payment_request_id uuid not null,
  customer_name text not null,
  customer_contact text not null,
  shipping_address text,
  fulfillment_method text not null,
  fulfillment_status text not null default 'ready_to_pack',
  currency text not null default 'PHP',
  subtotal_snapshot numeric(12,2) not null,
  shipping_fee_snapshot numeric(12,2) not null default 0,
  discount_snapshot numeric(12,2) not null default 0,
  total_paid_snapshot numeric(12,2) not null,
  payment_confirmed_at timestamptz not null,
  courier text,
  tracking_number text,
  tracking_not_applicable_reason text,
  shipping_note text,
  packed_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_id_user_unique unique (id, user_id),
  constraint orders_user_number_unique unique (user_id, order_number),
  constraint orders_source_payment_request_unique unique (source_payment_request_id),
  constraint orders_source_payment_request_owner_fk
    foreign key (source_payment_request_id, user_id)
    references public.payment_requests(id, user_id)
    on delete restrict,
  constraint orders_source_type_check check (source_type = 'payment_request'),
  constraint orders_fulfillment_method_check check (fulfillment_method in ('shipment', 'pickup')),
  constraint orders_fulfillment_status_check check (
    fulfillment_status in ('ready_to_pack', 'packing', 'packed', 'shipped', 'completed')
  ),
  constraint orders_currency_check check (currency = 'PHP'),
  constraint orders_subtotal_nonnegative check (subtotal_snapshot >= 0),
  constraint orders_shipping_fee_nonnegative check (shipping_fee_snapshot >= 0),
  constraint orders_discount_nonnegative check (discount_snapshot >= 0),
  constraint orders_total_paid_nonnegative check (total_paid_snapshot >= 0),
  constraint orders_total_matches_snapshots check (
    subtotal_snapshot + shipping_fee_snapshot - discount_snapshot = total_paid_snapshot
  ),
  constraint orders_tracking_choice_check check (
    tracking_number is null or tracking_not_applicable_reason is null
  ),
  constraint orders_timestamp_sequence_check check (
    (packed_at is null or packed_at >= payment_confirmed_at)
    and (shipped_at is null or (packed_at is not null and shipped_at >= packed_at))
    and (completed_at is null or (shipped_at is not null and completed_at >= shipped_at))
  )
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null,
  sale_id uuid not null,
  inventory_item_id uuid not null,
  sku_snapshot text not null,
  item_name_snapshot text not null,
  selling_price_snapshot numeric(12,2) not null,
  quantity smallint not null default 1,
  packing_required boolean not null default true,
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint order_items_order_owner_fk foreign key (order_id, user_id)
    references public.orders(id, user_id) on delete restrict,
  constraint order_items_sale_owner_fk foreign key (sale_id, user_id)
    references public.sales(id, user_id) on delete restrict,
  constraint order_items_inventory_owner_fk foreign key (inventory_item_id, user_id)
    references public.inventory_items(id, user_id) on delete restrict,
  constraint order_items_sale_unique unique (sale_id),
  constraint order_items_order_inventory_unique unique (order_id, inventory_item_id),
  constraint order_items_price_nonnegative check (selling_price_snapshot >= 0),
  constraint order_items_serialized_quantity_check check (quantity = 1),
  constraint order_items_check_actor_pair check (
    (checked_at is null and checked_by is null)
    or (checked_at is not null and checked_by is not null)
  ),
  constraint order_items_checked_by_owner check (checked_by is null or checked_by = user_id)
);

create table if not exists public.order_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_events_order_owner_fk foreign key (order_id, user_id)
    references public.orders(id, user_id) on delete restrict,
  constraint order_events_from_status_check check (
    from_status is null or from_status in ('ready_to_pack', 'packing', 'packed', 'shipped', 'completed')
  ),
  constraint order_events_to_status_check check (
    to_status in ('ready_to_pack', 'packing', 'packed', 'shipped', 'completed')
  ),
  constraint order_events_creation_check check (from_status is not null or to_status = 'ready_to_pack'),
  constraint order_events_actor_owner check (actor_user_id = user_id)
);

alter table public.inventory_items alter column cost drop not null;
alter table public.inventory_items alter column cost drop default;
alter table public.sales alter column cost_snapshot drop not null;
alter table public.sales alter column cost_snapshot drop default;
alter table public.inventory_purchases alter column cost drop not null;
alter table public.inventory_purchases alter column cost drop default;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_collections_updated_at on public.collections;
create trigger set_collections_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_updated_at on public.sales;
create trigger set_sales_updated_at
before update on public.sales
for each row execute function public.set_updated_at();

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

drop trigger if exists set_capital_records_updated_at on public.capital_records;
create trigger set_capital_records_updated_at
before update on public.capital_records
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_purchases_updated_at on public.inventory_purchases;
create trigger set_inventory_purchases_updated_at
before update on public.inventory_purchases
for each row execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

drop trigger if exists set_payment_requests_updated_at on public.payment_requests;
create trigger set_payment_requests_updated_at
before update on public.payment_requests
for each row execute function public.set_updated_at();

create index if not exists idx_collections_user_id on public.collections(user_id);
create index if not exists idx_collections_user_name on public.collections(user_id, name);
create index if not exists idx_collections_user_collection_date on public.collections(user_id, collection_date);

create index if not exists idx_inventory_items_user_id on public.inventory_items(user_id);
create index if not exists idx_inventory_items_collection_id on public.inventory_items(collection_id);
create index if not exists idx_inventory_items_user_status on public.inventory_items(user_id, status);
create index if not exists idx_inventory_items_user_sku on public.inventory_items(user_id, sku);

create index if not exists idx_sales_user_id on public.sales(user_id);
create index if not exists idx_sales_inventory_item_id on public.sales(inventory_item_id);
create index if not exists idx_sales_collection_id on public.sales(collection_id);
create index if not exists idx_sales_user_sale_date on public.sales(user_id, sale_date);
create index if not exists idx_sales_user_platform on public.sales(user_id, platform);
create unique index if not exists idx_sales_one_per_inventory_item on public.sales(inventory_item_id) where inventory_item_id is not null;

create index if not exists idx_expenses_user_id on public.expenses(user_id);
create index if not exists idx_expenses_inventory_item_id on public.expenses(inventory_item_id);
create index if not exists idx_expenses_collection_id on public.expenses(collection_id);
create index if not exists idx_expenses_user_expense_date on public.expenses(user_id, expense_date);
create index if not exists idx_expenses_user_category on public.expenses(user_id, category);

create index if not exists idx_capital_records_user_id on public.capital_records(user_id);
create index if not exists idx_capital_records_user_record_date on public.capital_records(user_id, record_date);
create index if not exists idx_capital_records_user_type on public.capital_records(user_id, type);

create index if not exists idx_activity_logs_user_id on public.activity_logs(user_id);
create index if not exists idx_activity_logs_user_activity_date_desc on public.activity_logs(user_id, activity_date desc);
create index if not exists idx_activity_logs_entity on public.activity_logs(entity_type, entity_id);

create index if not exists idx_inventory_purchases_user_id on public.inventory_purchases(user_id);
create index if not exists idx_inventory_purchases_inventory_item_id on public.inventory_purchases(inventory_item_id);
create index if not exists idx_inventory_purchases_user_purchase_date on public.inventory_purchases(user_id, purchase_date);

create index if not exists idx_settings_user_id on public.settings(user_id);
create index if not exists idx_settings_user_key on public.settings(user_id, key);

create unique index if not exists idx_payment_requests_one_pending_item
on public.payment_requests(inventory_item_id)
where status = 'Pending';
create index if not exists idx_payment_requests_user_id on public.payment_requests(user_id);
create index if not exists idx_payment_requests_user_issued on public.payment_requests(user_id, issued_at desc);
create index if not exists idx_orders_user_status on public.orders(user_id, fulfillment_status);
create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_user_customer on public.orders(user_id, customer_name);
create index if not exists idx_order_items_user_order on public.order_items(user_id, order_id);
create index if not exists idx_order_items_inventory on public.order_items(inventory_item_id);
create index if not exists idx_order_events_user_order_created
  on public.order_fulfillment_events(user_id, order_id, created_at);

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.inventory_items enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.capital_records enable row level security;
alter table public.activity_logs enable row level security;
alter table public.inventory_purchases enable row level security;
alter table public.settings enable row level security;
alter table public.payment_requests enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfillment_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles for delete
using (auth.uid() = id);

drop policy if exists "collections_select_own" on public.collections;
create policy "collections_select_own" on public.collections for select using (auth.uid() = user_id);

drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own" on public.collections for insert with check (auth.uid() = user_id);

drop policy if exists "collections_update_own" on public.collections;
create policy "collections_update_own" on public.collections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own" on public.collections for delete using (auth.uid() = user_id);

drop policy if exists "inventory_items_select_own" on public.inventory_items;
create policy "inventory_items_select_own" on public.inventory_items for select using (auth.uid() = user_id);

drop policy if exists "inventory_items_insert_own" on public.inventory_items;
create policy "inventory_items_insert_own" on public.inventory_items for insert with check (auth.uid() = user_id);

drop policy if exists "inventory_items_update_own" on public.inventory_items;
create policy "inventory_items_update_own" on public.inventory_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "inventory_items_delete_own" on public.inventory_items;
create policy "inventory_items_delete_own" on public.inventory_items for delete using (auth.uid() = user_id);

drop policy if exists "sales_select_own" on public.sales;
create policy "sales_select_own" on public.sales for select using (auth.uid() = user_id);

drop policy if exists "sales_insert_own" on public.sales;
create policy "sales_insert_own" on public.sales for insert with check (auth.uid() = user_id);

drop policy if exists "sales_update_own" on public.sales;
create policy "sales_update_own" on public.sales for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sales_delete_own" on public.sales;
create policy "sales_delete_own" on public.sales for delete using (auth.uid() = user_id);

drop policy if exists "expenses_select_own" on public.expenses;
create policy "expenses_select_own" on public.expenses for select using (auth.uid() = user_id);

drop policy if exists "expenses_insert_own" on public.expenses;
create policy "expenses_insert_own" on public.expenses for insert with check (auth.uid() = user_id);

drop policy if exists "expenses_update_own" on public.expenses;
create policy "expenses_update_own" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "expenses_delete_own" on public.expenses;
create policy "expenses_delete_own" on public.expenses for delete using (auth.uid() = user_id);

drop policy if exists "capital_records_select_own" on public.capital_records;
create policy "capital_records_select_own" on public.capital_records for select using (auth.uid() = user_id);

drop policy if exists "capital_records_insert_own" on public.capital_records;
create policy "capital_records_insert_own" on public.capital_records for insert with check (auth.uid() = user_id);

drop policy if exists "capital_records_update_own" on public.capital_records;
create policy "capital_records_update_own" on public.capital_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "capital_records_delete_own" on public.capital_records;
create policy "capital_records_delete_own" on public.capital_records for delete using (auth.uid() = user_id);

drop policy if exists "activity_logs_select_own" on public.activity_logs;
create policy "activity_logs_select_own" on public.activity_logs for select using (auth.uid() = user_id);

drop policy if exists "activity_logs_insert_own" on public.activity_logs;
create policy "activity_logs_insert_own" on public.activity_logs for insert with check (auth.uid() = user_id);

drop policy if exists "activity_logs_update_own" on public.activity_logs;
create policy "activity_logs_update_own" on public.activity_logs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "activity_logs_delete_own" on public.activity_logs;
create policy "activity_logs_delete_own" on public.activity_logs for delete using (auth.uid() = user_id);

drop policy if exists "inventory_purchases_select_own" on public.inventory_purchases;
create policy "inventory_purchases_select_own" on public.inventory_purchases for select using (auth.uid() = user_id);

drop policy if exists "inventory_purchases_insert_own" on public.inventory_purchases;
create policy "inventory_purchases_insert_own" on public.inventory_purchases for insert with check (auth.uid() = user_id);

drop policy if exists "inventory_purchases_update_own" on public.inventory_purchases;
create policy "inventory_purchases_update_own" on public.inventory_purchases for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "inventory_purchases_delete_own" on public.inventory_purchases;
create policy "inventory_purchases_delete_own" on public.inventory_purchases for delete using (auth.uid() = user_id);

drop policy if exists "settings_select_own" on public.settings;
create policy "settings_select_own" on public.settings for select using (auth.uid() = user_id);

drop policy if exists "settings_insert_own" on public.settings;
create policy "settings_insert_own" on public.settings for insert with check (auth.uid() = user_id);

drop policy if exists "settings_update_own" on public.settings;
create policy "settings_update_own" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settings_delete_own" on public.settings;
create policy "settings_delete_own" on public.settings for delete using (auth.uid() = user_id);

drop policy if exists "payment_requests_select_own" on public.payment_requests;
create policy "payment_requests_select_own" on public.payment_requests for select using (auth.uid() = user_id);

drop policy if exists "payment_requests_insert_own" on public.payment_requests;
create policy "payment_requests_insert_own" on public.payment_requests for insert with check (auth.uid() = user_id);

drop policy if exists "payment_requests_update_own" on public.payment_requests;
create policy "payment_requests_update_own" on public.payment_requests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "payment_requests_delete_own" on public.payment_requests;
create policy "payment_requests_delete_own" on public.payment_requests for delete using (auth.uid() = user_id);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders for select using (auth.uid() = user_id);

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own" on public.order_items for select using (auth.uid() = user_id);

drop policy if exists "order_events_select_own" on public.order_fulfillment_events;
create policy "order_events_select_own" on public.order_fulfillment_events for select using (auth.uid() = user_id);

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.order_fulfillment_events from anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_fulfillment_events to authenticated;

create or replace function public.protect_order_immutable_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.order_number is distinct from old.order_number
    or new.source_type is distinct from old.source_type
    or new.source_payment_request_id is distinct from old.source_payment_request_id
    or new.currency is distinct from old.currency
    or new.subtotal_snapshot is distinct from old.subtotal_snapshot
    or new.shipping_fee_snapshot is distinct from old.shipping_fee_snapshot
    or new.discount_snapshot is distinct from old.discount_snapshot
    or new.total_paid_snapshot is distinct from old.total_paid_snapshot
    or new.payment_confirmed_at is distinct from old.payment_confirmed_at then
    raise exception 'Order source and financial snapshots are immutable.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_order_item_immutable_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.order_id is distinct from old.order_id
    or new.sale_id is distinct from old.sale_id
    or new.inventory_item_id is distinct from old.inventory_item_id
    or new.sku_snapshot is distinct from old.sku_snapshot
    or new.item_name_snapshot is distinct from old.item_name_snapshot
    or new.selling_price_snapshot is distinct from old.selling_price_snapshot
    or new.quantity is distinct from old.quantity then
    raise exception 'Order Item source and financial snapshots are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists protect_order_immutable_fields on public.orders;
create trigger protect_order_immutable_fields
before update on public.orders
for each row execute function public.protect_order_immutable_fields();

drop trigger if exists protect_order_item_immutable_fields on public.order_items;
create trigger protect_order_item_immutable_fields
before update on public.order_items
for each row execute function public.protect_order_item_immutable_fields();

create or replace function public.mark_payment_request_paid(
  p_request_id uuid,
  p_payment_method text
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.payment_requests%rowtype;
  v_item public.inventory_items%rowtype;
  v_sale public.sales%rowtype;
  v_order public.orders%rowtype;
  v_date_prefix text := to_char(current_date, 'YYYYMMDD');
  v_sequence integer;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;
  if p_payment_method not in ('GCash', 'GoTyme') then
    raise exception 'Choose GCash or GoTyme.';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_request_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Payment request not found.';
  end if;

  if v_request.status = 'Paid' then
    select * into v_order
    from public.orders
    where source_payment_request_id = v_request.id and user_id = v_user_id;

    if found
      and exists (select 1 from public.order_items where order_id = v_order.id and user_id = v_user_id)
      and exists (
        select 1 from public.order_fulfillment_events
        where order_id = v_order.id and user_id = v_user_id and from_status is null and to_status = 'ready_to_pack'
      ) then
      return v_request;
    end if;

    raise exception 'This Paid payment request has no complete linked Order.';
  end if;

  if v_request.status <> 'Pending' then
    raise exception 'Only Pending requests can be marked Paid.';
  end if;

  select * into v_item
  from public.inventory_items
  where id = v_request.inventory_item_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Inventory item not found.';
  end if;
  if v_item.status <> 'Reserved' then
    raise exception 'The requested item is not Reserved.';
  end if;
  if exists (
    select 1 from public.sales
    where inventory_item_id = v_item.id and user_id = v_user_id
  ) then
    raise exception 'This item already has a sale record.';
  end if;

  update public.inventory_items
  set status = 'Sold',
      locked = true,
      price = v_request.item_price,
      sold_at = now(),
      payment_status = 'Paid',
      platform = 'Direct Customer'
  where id = v_item.id and user_id = v_user_id;

  insert into public.sales (
    user_id, inventory_item_id, collection_id, sku_snapshot, item_name_snapshot,
    cost_snapshot, sale_price, platform, payment_status, sale_date, notes
  ) values (
    v_user_id, v_item.id, v_item.collection_id, v_item.sku, v_request.item_name_snapshot,
    v_item.cost, v_request.item_price, 'Direct Customer', 'Paid', current_date,
    'Payment request ' || v_request.request_number || ' paid via ' || p_payment_method
  ) returning * into v_sale;

  update public.payment_requests
  set status = 'Paid', payment_method = p_payment_method
  where id = v_request.id and user_id = v_user_id
  returning * into v_request;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':order:' || v_date_prefix, 0));

  select coalesce(max(substring(order_number from 14)::integer), 0) + 1
  into v_sequence
  from public.orders
  where user_id = v_user_id and order_number like 'ORD-' || v_date_prefix || '-%';

  insert into public.orders (
    user_id, order_number, source_type, source_payment_request_id,
    customer_name, customer_contact, shipping_address,
    fulfillment_method, fulfillment_status, currency,
    subtotal_snapshot, shipping_fee_snapshot, discount_snapshot, total_paid_snapshot,
    payment_confirmed_at, courier
  ) values (
    v_user_id,
    'ORD-' || v_date_prefix || '-' || lpad(v_sequence::text, 3, '0'),
    'payment_request', v_request.id,
    v_request.customer_name, v_request.customer_contact, v_request.shipping_address,
    case when v_request.shipping_mode = 'pickup' then 'pickup' else 'shipment' end,
    'ready_to_pack', 'PHP',
    v_request.item_price, v_request.shipping_fee, v_request.discount, v_request.total_amount,
    now(), v_request.courier
  ) returning * into v_order;

  insert into public.order_items (
    user_id, order_id, sale_id, inventory_item_id,
    sku_snapshot, item_name_snapshot, selling_price_snapshot,
    quantity, packing_required
  ) values (
    v_user_id, v_order.id, v_sale.id, v_item.id,
    v_item.sku, v_request.item_name_snapshot, v_request.item_price,
    1, true
  );

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, null, 'ready_to_pack', v_user_id,
    'Order created from paid Payment Request.',
    jsonb_build_object(
      'source_payment_request_id', v_request.id,
      'request_number', v_request.request_number,
      'sale_id', v_sale.id
    )
  );

  return v_request;
end;
$$;

revoke all on function public.mark_payment_request_paid(uuid, text) from public;
grant execute on function public.mark_payment_request_paid(uuid, text) to authenticated;
