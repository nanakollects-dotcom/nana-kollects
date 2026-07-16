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
  constraint orders_fulfillment_method_check check (fulfillment_method in ('shipment', 'local_delivery', 'pickup')),
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
    and (
      completed_at is null
      or (
        fulfillment_method = 'pickup'
        and packed_at is not null
        and shipped_at is null
        and completed_at >= packed_at
      )
      or (
        fulfillment_method in ('shipment', 'local_delivery')
        and shipped_at is not null
        and completed_at >= shipped_at
      )
    )
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

create or replace function public.start_order_packing(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status <> 'ready_to_pack' then
    raise exception 'Only Ready to Pack Orders can start packing.';
  end if;

  perform 1
  from public.order_items
  where order_id = v_order.id and user_id = v_user_id
  order by id
  for update;

  if not exists (
    select 1
    from public.order_items
    where order_id = v_order.id
      and user_id = v_user_id
      and packing_required
  ) then
    raise exception 'Order has no required packing items.';
  end if;

  update public.orders
  set fulfillment_status = 'packing'
  where id = v_order.id
    and user_id = v_user_id
    and fulfillment_status = 'ready_to_pack'
  returning * into v_order;

  if not found then
    raise exception 'Only Ready to Pack Orders can start packing.';
  end if;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'ready_to_pack', 'packing', v_user_id,
    'Packing started.', jsonb_build_object('action', 'start_packing')
  );

  return v_order;
end;
$$;

create or replace function public.set_order_item_packed(
  p_order_item_id uuid,
  p_checked boolean
)
returns public.order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_from_status text;
  v_to_status text;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;
  if p_checked is null then
    raise exception 'Choose whether the Order Item is packed.';
  end if;

  select order_id into v_order_id
  from public.order_items
  where id = p_order_item_id and user_id = v_user_id;

  if not found then
    raise exception 'Order Item not found.';
  end if;

  select * into v_order
  from public.orders
  where id = v_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  select * into v_item
  from public.order_items
  where id = p_order_item_id and order_id = v_order.id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order Item not found.';
  end if;

  if v_order.fulfillment_status not in ('ready_to_pack', 'packing') then
    raise exception 'Checklist changes require a Ready to Pack or Packing Order. Reopen a Packed Order first.';
  end if;
  if (p_checked and v_item.checked_at is not null)
    or (not p_checked and v_item.checked_at is null) then
    return v_item;
  end if;

  v_from_status := v_order.fulfillment_status;

  update public.order_items
  set checked_at = case when p_checked then now() else null end,
      checked_by = case when p_checked then v_user_id else null end
  where id = v_item.id and user_id = v_user_id
  returning * into v_item;

  if p_checked then
    v_to_status := 'packing';
  elsif v_from_status = 'packing' and not exists (
    select 1
    from public.order_items
    where order_id = v_order.id
      and user_id = v_user_id
      and packing_required
      and checked_at is not null
  ) then
    v_to_status := 'ready_to_pack';
  else
    v_to_status := v_from_status;
  end if;

  if v_to_status is distinct from v_from_status then
    update public.orders
    set fulfillment_status = v_to_status
    where id = v_order.id and user_id = v_user_id;
  end if;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id,
    v_order.id,
    v_from_status,
    v_to_status,
    v_user_id,
    case when p_checked then 'Order Item checked.' else 'Order Item unchecked.' end,
    jsonb_build_object(
      'action', case when p_checked then 'item_checked' else 'item_unchecked' end,
      'order_item_id', v_item.id,
      'checked', p_checked
    )
  );

  return v_item;
end;
$$;

create or replace function public.set_order_item_packed(
  p_order_id uuid,
  p_order_item_id uuid,
  p_checked boolean
)
returns public.order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;
  if p_checked is null then
    raise exception 'Choose whether the Order Item is packed.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status <> 'packing' then
    raise exception 'Checklist changes require a Packing Order.';
  end if;

  select * into v_item
  from public.order_items
  where id = p_order_item_id
    and order_id = v_order.id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order Item not found.';
  end if;
  if not v_item.packing_required then
    raise exception 'This Order Item does not require packing.';
  end if;

  if (p_checked and v_item.checked_at is not null)
    or (not p_checked and v_item.checked_at is null) then
    return v_item;
  end if;

  update public.order_items
  set checked_at = case when p_checked then transaction_timestamp() else null end,
      checked_by = case when p_checked then v_user_id else null end
  where id = v_item.id
    and order_id = v_order.id
    and user_id = v_user_id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.mark_order_packed(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status <> 'packing' then
    raise exception 'Only Packing Orders can be marked Packed.';
  end if;

  perform 1
  from public.order_items
  where order_id = v_order.id and user_id = v_user_id
  order by id
  for update;

  if not exists (
    select 1 from public.order_items
    where order_id = v_order.id and user_id = v_user_id and packing_required
  ) then
    raise exception 'Order has no required packing items.';
  end if;
  if exists (
    select 1 from public.order_items
    where order_id = v_order.id
      and user_id = v_user_id
      and packing_required
      and (checked_at is null or checked_by is distinct from v_user_id)
  ) then
    raise exception 'Check every required Order Item before marking Packed.';
  end if;

  update public.orders
  set fulfillment_status = 'packed', packed_at = transaction_timestamp()
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'packing', 'packed', v_user_id,
    'Order marked Packed.', jsonb_build_object('action', 'mark_packed')
  );

  return v_order;
end;
$$;

create or replace function public.reopen_order_packing(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status = 'packing' and v_order.packed_at is null then
    return v_order;
  end if;
  if v_order.fulfillment_status <> 'packed' then
    raise exception 'Only Packed Orders can be reopened for packing.';
  end if;

  update public.orders
  set fulfillment_status = 'packing', packed_at = null
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'packed', 'packing', v_user_id,
    'Packed Order reopened for packing.', jsonb_build_object('action', 'reopen_packing')
  );

  return v_order;
end;
$$;

create or replace function public.mark_order_shipped(
  p_order_id uuid,
  p_courier text,
  p_tracking_number text,
  p_no_tracking_reason text,
  p_shipped_at timestamptz,
  p_shipping_note text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_courier text := nullif(trim(coalesce(p_courier, '')), '');
  v_tracking_number text := nullif(trim(coalesce(p_tracking_number, '')), '');
  v_no_tracking_reason text := nullif(trim(coalesce(p_no_tracking_reason, '')), '');
  v_shipping_note text := nullif(trim(coalesce(p_shipping_note, '')), '');
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status <> 'packed' then
    raise exception 'Only Packed Orders can be marked Shipped.';
  end if;
  if v_order.fulfillment_method = 'pickup' then
    raise exception 'Pickup Orders cannot be marked Shipped.';
  end if;

  perform 1
  from public.order_items
  where order_id = v_order.id and user_id = v_user_id
  order by id
  for update;

  if not exists (
    select 1 from public.order_items
    where order_id = v_order.id and user_id = v_user_id and packing_required
  ) or exists (
    select 1 from public.order_items
    where order_id = v_order.id
      and user_id = v_user_id
      and packing_required
      and (checked_at is null or checked_by is distinct from v_user_id)
  ) then
    raise exception 'Every required Order Item must be checked before shipping.';
  end if;
  if nullif(trim(coalesce(v_order.shipping_address, '')), '') is null then
    raise exception 'Shipping address is required before shipping.';
  end if;
  if v_courier is null then
    raise exception 'Courier is required before shipping.';
  end if;
  if length(v_courier) > 160 then
    raise exception 'Courier is too long.';
  end if;
  if v_tracking_number is null or v_no_tracking_reason is not null then
    raise exception 'Tracking number is required before shipping.';
  end if;
  if length(v_tracking_number) > 240 then
    raise exception 'Tracking number is too long.';
  end if;
  if length(coalesce(v_shipping_note, '')) > 2000 then
    raise exception 'Shipping note is too long.';
  end if;
  if p_shipped_at is null then
    raise exception 'Shipped date and time are required.';
  end if;
  if v_order.packed_at is null or p_shipped_at < v_order.packed_at then
    raise exception 'Shipped date and time cannot be before packing.';
  end if;

  update public.orders
  set fulfillment_status = 'shipped',
      courier = v_courier,
      tracking_number = v_tracking_number,
      shipped_at = p_shipped_at,
      shipping_note = v_shipping_note
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'packed', 'shipped', v_user_id,
    'Order marked Shipped.',
    jsonb_build_object(
      'action', 'mark_shipped',
      'courier', v_courier,
      'has_tracking_number', true
    )
  );

  return v_order;
end;
$$;

create or replace function public.mark_order_completed(
  p_order_id uuid,
  p_completed_at timestamptz,
  p_note text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_note text := coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Order marked Completed.');
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status <> 'shipped' then
    raise exception 'Only Shipped Orders can be marked Completed.';
  end if;
  if p_completed_at is null then
    raise exception 'Completion date and time are required.';
  end if;
  if v_order.shipped_at is null or p_completed_at < v_order.shipped_at then
    raise exception 'Completion date and time cannot be before shipping.';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Completion note is too long.';
  end if;

  update public.orders
  set fulfillment_status = 'completed',
      completed_at = p_completed_at
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'shipped', 'completed', v_user_id,
    v_note,
    jsonb_build_object('action', 'mark_completed')
  );

  return v_order;
end;
$$;

revoke all on function public.start_order_packing(uuid) from public;
revoke all on function public.set_order_item_packed(uuid, boolean) from public;
revoke all on function public.set_order_item_packed(uuid, uuid, boolean) from public;
revoke all on function public.mark_order_packed(uuid) from public;
revoke all on function public.reopen_order_packing(uuid) from public;
revoke all on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) from public;
revoke all on function public.mark_order_completed(uuid, timestamptz, text) from public;

revoke all on function public.start_order_packing(uuid) from anon;
revoke all on function public.set_order_item_packed(uuid, boolean) from anon;
revoke all on function public.set_order_item_packed(uuid, uuid, boolean) from anon;
revoke all on function public.set_order_item_packed(uuid, boolean) from authenticated;

grant execute on function public.start_order_packing(uuid) to authenticated;
grant execute on function public.set_order_item_packed(uuid, uuid, boolean) to authenticated;
grant execute on function public.mark_order_packed(uuid) to authenticated;
grant execute on function public.reopen_order_packing(uuid) to authenticated;
grant execute on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.mark_order_completed(uuid, timestamptz, text) to authenticated;

-- Existing single-item compatibility RPCs supplied by historical migrations.
create or replace function public.create_payment_request(
  p_inventory_item_id uuid,
  p_customer_name text,
  p_customer_contact text,
  p_shipping_address text,
  p_item_price numeric,
  p_shipping_fee numeric,
  p_shipping_mode text,
  p_courier text,
  p_discount numeric,
  p_valid_until date,
  p_customer_note text,
  p_payment_config jsonb
)
returns public.payment_requests
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_request public.payment_requests%rowtype;
  v_date_prefix text := to_char(current_date, 'YYYYMMDD');
  v_sequence integer;
  v_shipping_mode text := coalesce(nullif(trim(p_shipping_mode), ''), 'fee_now');
  v_shipping_fee numeric(12,2);
  v_discount numeric(12,2) := round(coalesce(p_discount, 0), 2);
  v_total numeric(12,2);
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  if nullif(trim(p_customer_name), '') is null then
    raise exception 'Customer name is required.';
  end if;
  if nullif(trim(p_customer_contact), '') is null then
    raise exception 'Customer contact is required.';
  end if;
  if v_shipping_mode not in ('fee_now', 'to_follow', 'pickup') then
    raise exception 'Choose a valid shipping mode.';
  end if;
  if coalesce(p_item_price, -1) < 0 then
    raise exception 'Selling price must be zero or higher.';
  end if;

  v_shipping_fee := case
    when v_shipping_mode = 'fee_now' then round(coalesce(p_shipping_fee, 0), 2)
    else 0
  end;

  if v_shipping_fee < 0 then
    raise exception 'Shipping fee must be zero or higher.';
  end if;
  if v_discount < 0 then
    raise exception 'Discount must be zero or higher.';
  end if;

  v_total := round((p_item_price + v_shipping_fee - v_discount)::numeric, 2);
  if v_total < 0 then
    raise exception 'Total amount due cannot be negative.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_inventory_item_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Inventory item not found.';
  end if;
  if v_item.status <> 'Available' then
    raise exception 'Only Available items can receive a payment request.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || v_date_prefix, 0));

  select coalesce(max(substring(request_number from 13)::integer), 0) + 1
  into v_sequence
  from public.payment_requests
  where user_id = v_user_id
    and request_number like 'PR-' || v_date_prefix || '-%';

  insert into public.payment_requests (
    user_id,
    request_number,
    inventory_item_id,
    customer_name,
    customer_contact,
    shipping_address,
    item_name_snapshot,
    item_price,
    shipping_fee,
    shipping_mode,
    courier,
    discount,
    total_amount,
    status,
    valid_until,
    customer_note,
    payment_config_snapshot
  )
  values (
    v_user_id,
    'PR-' || v_date_prefix || '-' || lpad(v_sequence::text, 3, '0'),
    v_item.id,
    trim(p_customer_name),
    trim(p_customer_contact),
    nullif(trim(coalesce(p_shipping_address, '')), ''),
    v_item.name,
    round(p_item_price, 2),
    v_shipping_fee,
    v_shipping_mode,
    nullif(trim(coalesce(p_courier, '')), ''),
    v_discount,
    v_total,
    'Pending',
    p_valid_until,
    nullif(trim(coalesce(p_customer_note, '')), ''),
    coalesce(p_payment_config, '{}'::jsonb)
  )
  returning * into v_request;

  update public.inventory_items
  set status = 'Reserved',
      locked = false
  where id = v_item.id
    and user_id = v_user_id;

  return v_request;
end;
$$;

revoke all on function public.create_payment_request(uuid, text, text, text, numeric, numeric, text, text, numeric, date, text, jsonb) from public;
grant execute on function public.create_payment_request(uuid, text, text, text, numeric, numeric, text, text, numeric, date, text, jsonb) to authenticated;

create or replace function public.cancel_payment_request(p_request_id uuid)
returns public.payment_requests
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.payment_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;

  select *
  into v_request
  from public.payment_requests
  where id = p_request_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Payment request not found.';
  end if;
  if v_request.status <> 'Pending' then
    raise exception 'Only Pending requests can be cancelled.';
  end if;

  update public.payment_requests
  set status = 'Cancelled'
  where id = v_request.id
    and user_id = v_user_id
  returning * into v_request;

  update public.inventory_items
  set status = 'Available',
      locked = false
  where id = v_request.inventory_item_id
    and user_id = v_user_id
    and status = 'Reserved'
    and not exists (
      select 1
      from public.payment_requests
      where inventory_item_id = v_request.inventory_item_id
        and user_id = v_user_id
        and status = 'Pending'
    );

  return v_request;
end;
$$;

revoke all on function public.cancel_payment_request(uuid) from public, anon;
grant execute on function public.cancel_payment_request(uuid) to authenticated;

-- Forward-only Sprint 17B final-state additions.
-- Sprint 17B: additive multi-item transaction foundation.
-- Existing single-item columns and RPCs remain available for application compatibility.

alter table public.payment_requests
  add column if not exists merchandise_subtotal_snapshot numeric(12,2),
  add column if not exists discount_snapshot numeric(12,2),
  add column if not exists shipping_fee_snapshot numeric(12,2),
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.payment_requests
set merchandise_subtotal_snapshot = item_price,
    discount_snapshot = discount,
    shipping_fee_snapshot = shipping_fee,
    paid_at = case when status = 'Paid' then coalesce(updated_at, issued_at) else paid_at end,
    cancelled_at = case when status = 'Cancelled' then coalesce(updated_at, issued_at) else cancelled_at end
where merchandise_subtotal_snapshot is null
   or discount_snapshot is null
   or shipping_fee_snapshot is null
   or (status = 'Paid' and paid_at is null)
   or (status = 'Cancelled' and cancelled_at is null);

alter table public.payment_requests
  alter column merchandise_subtotal_snapshot set not null,
  alter column discount_snapshot set not null,
  alter column shipping_fee_snapshot set not null;

alter table public.payment_requests
  drop constraint if exists payment_requests_merchandise_subtotal_nonnegative,
  drop constraint if exists payment_requests_discount_snapshot_nonnegative,
  drop constraint if exists payment_requests_shipping_snapshot_nonnegative,
  drop constraint if exists payment_requests_header_total_matches,
  drop constraint if exists payment_requests_terminal_timestamps_check;

alter table public.payment_requests
  add constraint payment_requests_merchandise_subtotal_nonnegative
    check (merchandise_subtotal_snapshot >= 0),
  add constraint payment_requests_discount_snapshot_nonnegative
    check (discount_snapshot >= 0 and discount_snapshot <= merchandise_subtotal_snapshot),
  add constraint payment_requests_shipping_snapshot_nonnegative
    check (shipping_fee_snapshot >= 0),
  add constraint payment_requests_header_total_matches
    check (merchandise_subtotal_snapshot - discount_snapshot + shipping_fee_snapshot = total_amount),
  add constraint payment_requests_terminal_timestamps_check
    check (
      (status <> 'Paid' or paid_at is not null)
      and (status <> 'Cancelled' or cancelled_at is not null)
      and not (paid_at is not null and cancelled_at is not null)
    );

create table public.payment_request_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_request_id uuid not null,
  inventory_item_id uuid not null,
  sku_snapshot text not null,
  item_name_snapshot text not null,
  unit_price_snapshot numeric(12,2) not null,
  quantity smallint not null default 1,
  line_total_snapshot numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint payment_request_items_id_user_unique unique (id, user_id),
  constraint payment_request_items_request_inventory_user_unique
    unique (payment_request_id, inventory_item_id, user_id),
  constraint payment_request_items_request_owner_fk
    foreign key (payment_request_id, user_id)
    references public.payment_requests(id, user_id) on delete restrict,
  constraint payment_request_items_inventory_owner_fk
    foreign key (inventory_item_id, user_id)
    references public.inventory_items(id, user_id) on delete restrict,
  constraint payment_request_items_quantity_check check (quantity = 1),
  constraint payment_request_items_unit_price_nonnegative check (unit_price_snapshot >= 0),
  constraint payment_request_items_line_total_check
    check (line_total_snapshot = unit_price_snapshot and line_total_snapshot >= 0)
);

create index idx_payment_request_items_user_request
  on public.payment_request_items(user_id, payment_request_id);
create index idx_payment_request_items_inventory
  on public.payment_request_items(inventory_item_id);

insert into public.payment_request_items (
  user_id, payment_request_id, inventory_item_id, sku_snapshot,
  item_name_snapshot, unit_price_snapshot, quantity, line_total_snapshot, created_at
)
select
  pr.user_id,
  pr.id,
  pr.inventory_item_id,
  coalesce(
    (
      select oi.sku_snapshot
      from public.orders o
      join public.order_items oi on oi.order_id = o.id and oi.user_id = o.user_id
      where o.source_payment_request_id = pr.id
        and oi.inventory_item_id = pr.inventory_item_id
      order by oi.created_at, oi.id
      limit 1
    ),
    i.sku
  ),
  pr.item_name_snapshot,
  pr.item_price,
  1,
  pr.item_price,
  pr.created_at
from public.payment_requests pr
join public.inventory_items i
  on i.id = pr.inventory_item_id and i.user_id = pr.user_id;

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_request_id uuid not null,
  inventory_item_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_reservations_inventory_unique unique (inventory_item_id),
  constraint inventory_reservations_request_inventory_unique
    unique (payment_request_id, inventory_item_id),
  constraint inventory_reservations_request_owner_fk
    foreign key (payment_request_id, user_id)
    references public.payment_requests(id, user_id) on delete restrict,
  constraint inventory_reservations_inventory_owner_fk
    foreign key (inventory_item_id, user_id)
    references public.inventory_items(id, user_id) on delete restrict,
  constraint inventory_reservations_request_item_fk
    foreign key (payment_request_id, inventory_item_id, user_id)
    references public.payment_request_items(payment_request_id, inventory_item_id, user_id)
    on delete restrict
);

create index idx_inventory_reservations_user_request
  on public.inventory_reservations(user_id, payment_request_id);

insert into public.inventory_reservations (
  user_id, payment_request_id, inventory_item_id, created_at
)
select pr.user_id, pr.id, pr.inventory_item_id, pr.created_at
from public.payment_requests pr
join public.inventory_items i
  on i.id = pr.inventory_item_id and i.user_id = pr.user_id
where pr.status = 'Pending'
  and i.status = 'Reserved';

alter table public.sales
  add column if not exists source_payment_request_id uuid,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_contact_snapshot text,
  add column if not exists shipping_address_snapshot text,
  add column if not exists merchandise_subtotal_snapshot numeric(12,2),
  add column if not exists discount_snapshot numeric(12,2),
  add column if not exists shipping_fee_snapshot numeric(12,2),
  add column if not exists total_paid_snapshot numeric(12,2),
  add column if not exists aggregate_cogs_snapshot numeric(12,2),
  add column if not exists aggregate_profit_snapshot numeric(12,2),
  add column if not exists payment_method_snapshot text,
  add column if not exists sale_timestamp timestamptz;

update public.sales s
set source_payment_request_id = linked.source_payment_request_id,
    customer_name_snapshot = linked.customer_name,
    customer_contact_snapshot = linked.customer_contact,
    shipping_address_snapshot = linked.shipping_address,
    merchandise_subtotal_snapshot = coalesce(linked.subtotal_snapshot, s.sale_price),
    discount_snapshot = coalesce(linked.discount_snapshot, 0),
    shipping_fee_snapshot = coalesce(linked.shipping_fee_snapshot, 0),
    total_paid_snapshot = coalesce(linked.total_paid_snapshot, s.sale_price),
    aggregate_cogs_snapshot = s.cost_snapshot,
    aggregate_profit_snapshot = case
      when s.cost_snapshot is null then null
      else coalesce(linked.subtotal_snapshot, s.sale_price) - coalesce(linked.discount_snapshot, 0) - s.cost_snapshot
    end,
    payment_method_snapshot = linked.payment_method,
    sale_timestamp = coalesce(linked.payment_confirmed_at, s.sale_date::timestamptz)
from (
  select distinct on (oi.sale_id)
    oi.sale_id,
    o.source_payment_request_id,
    o.customer_name,
    o.customer_contact,
    o.shipping_address,
    o.subtotal_snapshot,
    o.discount_snapshot,
    o.shipping_fee_snapshot,
    o.total_paid_snapshot,
    o.payment_confirmed_at,
    pr.payment_method
  from public.order_items oi
  join public.orders o on o.id = oi.order_id and o.user_id = oi.user_id
  join public.payment_requests pr
    on pr.id = o.source_payment_request_id and pr.user_id = o.user_id
  order by oi.sale_id, oi.created_at, oi.id
) linked
where linked.sale_id = s.id;

update public.sales
set merchandise_subtotal_snapshot = coalesce(merchandise_subtotal_snapshot, sale_price),
    discount_snapshot = coalesce(discount_snapshot, 0),
    shipping_fee_snapshot = coalesce(shipping_fee_snapshot, 0),
    total_paid_snapshot = coalesce(total_paid_snapshot, sale_price),
    aggregate_cogs_snapshot = coalesce(aggregate_cogs_snapshot, cost_snapshot),
    aggregate_profit_snapshot = case
      when coalesce(aggregate_cogs_snapshot, cost_snapshot) is null then null
      else coalesce(merchandise_subtotal_snapshot, sale_price)
        - coalesce(discount_snapshot, 0)
        - coalesce(aggregate_cogs_snapshot, cost_snapshot)
    end,
    sale_timestamp = coalesce(sale_timestamp, sale_date::timestamptz);

alter table public.sales
  alter column merchandise_subtotal_snapshot set not null,
  alter column discount_snapshot set not null,
  alter column shipping_fee_snapshot set not null,
  alter column total_paid_snapshot set not null,
  alter column sale_timestamp set not null;

alter table public.sales
  drop constraint if exists sales_source_payment_request_owner_fk,
  drop constraint if exists sales_merchandise_subtotal_nonnegative,
  drop constraint if exists sales_discount_snapshot_check,
  drop constraint if exists sales_shipping_snapshot_nonnegative,
  drop constraint if exists sales_total_paid_matches,
  drop constraint if exists sales_aggregate_cogs_nonnegative,
  drop constraint if exists sales_aggregate_profit_matches,
  drop constraint if exists sales_payment_method_snapshot_check;

alter table public.sales
  add constraint sales_source_payment_request_owner_fk
    foreign key (source_payment_request_id, user_id)
    references public.payment_requests(id, user_id) on delete restrict,
  add constraint sales_merchandise_subtotal_nonnegative
    check (merchandise_subtotal_snapshot >= 0),
  add constraint sales_discount_snapshot_check
    check (discount_snapshot >= 0 and discount_snapshot <= merchandise_subtotal_snapshot),
  add constraint sales_shipping_snapshot_nonnegative
    check (shipping_fee_snapshot >= 0),
  add constraint sales_total_paid_matches
    check (merchandise_subtotal_snapshot - discount_snapshot + shipping_fee_snapshot = total_paid_snapshot),
  add constraint sales_aggregate_cogs_nonnegative
    check (aggregate_cogs_snapshot is null or aggregate_cogs_snapshot >= 0),
  add constraint sales_aggregate_profit_matches
    check (
      (aggregate_cogs_snapshot is null and aggregate_profit_snapshot is null)
      or aggregate_profit_snapshot = merchandise_subtotal_snapshot - discount_snapshot - aggregate_cogs_snapshot
    ),
  add constraint sales_payment_method_snapshot_check
    check (payment_method_snapshot is null or payment_method_snapshot in ('GCash', 'GoTyme'));

create unique index idx_sales_source_payment_request_unique
  on public.sales(source_payment_request_id)
  where source_payment_request_id is not null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid not null,
  inventory_item_id uuid not null,
  collection_id uuid,
  sku_snapshot text not null,
  item_name_snapshot text not null,
  unit_cost_snapshot numeric(12,2),
  unit_price_snapshot numeric(12,2) not null,
  quantity smallint not null default 1,
  line_subtotal_snapshot numeric(12,2) not null,
  allocated_discount_snapshot numeric(12,2) not null default 0,
  net_item_revenue_snapshot numeric(12,2) not null,
  profit_snapshot numeric(12,2) generated always as (
    case
      when unit_cost_snapshot is null then null
      else net_item_revenue_snapshot - unit_cost_snapshot
    end
  ) stored,
  created_at timestamptz not null default now(),
  constraint sale_items_id_user_unique unique (id, user_id),
  constraint sale_items_sale_inventory_unique unique (sale_id, inventory_item_id),
  constraint sale_items_inventory_unique unique (inventory_item_id),
  constraint sale_items_sale_owner_fk foreign key (sale_id, user_id)
    references public.sales(id, user_id) on delete restrict,
  constraint sale_items_inventory_owner_fk foreign key (inventory_item_id, user_id)
    references public.inventory_items(id, user_id) on delete restrict,
  constraint sale_items_collection_fk foreign key (collection_id)
    references public.collections(id) on delete restrict,
  constraint sale_items_quantity_check check (quantity = 1),
  constraint sale_items_cost_nonnegative check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  constraint sale_items_price_nonnegative check (unit_price_snapshot >= 0),
  constraint sale_items_line_subtotal_check
    check (line_subtotal_snapshot = unit_price_snapshot and line_subtotal_snapshot >= 0),
  constraint sale_items_discount_check
    check (allocated_discount_snapshot >= 0 and allocated_discount_snapshot <= line_subtotal_snapshot),
  constraint sale_items_net_revenue_check
    check (net_item_revenue_snapshot = line_subtotal_snapshot - allocated_discount_snapshot)
);

create index idx_sale_items_user_sale on public.sale_items(user_id, sale_id);
create index idx_sale_items_collection on public.sale_items(collection_id);

insert into public.sale_items (
  user_id, sale_id, inventory_item_id, collection_id,
  sku_snapshot, item_name_snapshot, unit_cost_snapshot, unit_price_snapshot,
  quantity, line_subtotal_snapshot, allocated_discount_snapshot,
  net_item_revenue_snapshot, created_at
)
select
  s.user_id,
  s.id,
  s.inventory_item_id,
  s.collection_id,
  coalesce(s.sku_snapshot, i.sku),
  coalesce(s.item_name_snapshot, i.name),
  s.cost_snapshot,
  s.sale_price,
  1,
  s.sale_price,
  least(s.sale_price, s.discount_snapshot),
  s.sale_price - least(s.sale_price, s.discount_snapshot),
  s.created_at
from public.sales s
join public.inventory_items i
  on i.id = s.inventory_item_id and i.user_id = s.user_id
where s.inventory_item_id is not null;

alter table public.order_items
  add column if not exists line_total_snapshot numeric(12,2);

update public.order_items
set line_total_snapshot = selling_price_snapshot
where line_total_snapshot is null;

alter table public.order_items
  alter column line_total_snapshot set not null,
  drop constraint if exists order_items_line_total_check,
  add constraint order_items_line_total_check
    check (line_total_snapshot = selling_price_snapshot and line_total_snapshot >= 0);

alter table public.order_items
  drop constraint if exists order_items_sale_unique;

create unique index if not exists idx_order_items_inventory_unique
  on public.order_items(inventory_item_id);
create unique index if not exists idx_order_items_sale_inventory_unique
  on public.order_items(sale_id, inventory_item_id);

create or replace function public.sync_payment_request_header_snapshots()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.merchandise_subtotal_snapshot := coalesce(new.merchandise_subtotal_snapshot, new.item_price);
    new.discount_snapshot := coalesce(new.discount_snapshot, new.discount);
    new.shipping_fee_snapshot := coalesce(new.shipping_fee_snapshot, new.shipping_fee);
  elsif old.status in ('Paid', 'Cancelled') then
    if new.user_id is distinct from old.user_id
      or new.inventory_item_id is distinct from old.inventory_item_id
      or new.customer_name is distinct from old.customer_name
      or new.customer_contact is distinct from old.customer_contact
      or new.shipping_address is distinct from old.shipping_address
      or new.item_name_snapshot is distinct from old.item_name_snapshot
      or new.item_price is distinct from old.item_price
      or new.shipping_fee is distinct from old.shipping_fee
      or new.discount is distinct from old.discount
      or new.total_amount is distinct from old.total_amount
      or new.merchandise_subtotal_snapshot is distinct from old.merchandise_subtotal_snapshot
      or new.discount_snapshot is distinct from old.discount_snapshot
      or new.shipping_fee_snapshot is distinct from old.shipping_fee_snapshot
      or new.status is distinct from old.status
      or new.paid_at is distinct from old.paid_at
      or new.cancelled_at is distinct from old.cancelled_at then
      raise exception 'Completed Payment Request snapshots are immutable.';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'Pending' and new.status = 'Paid' and new.paid_at is null then
    new.paid_at := transaction_timestamp();
  end if;
  if tg_op = 'UPDATE' and old.status = 'Pending' and new.status = 'Cancelled' and new.cancelled_at is null then
    new.cancelled_at := transaction_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_payment_request_header_snapshots on public.payment_requests;
create trigger sync_payment_request_header_snapshots
before insert or update on public.payment_requests
for each row execute function public.sync_payment_request_header_snapshots();

create or replace function public.sync_sale_header_snapshots()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.merchandise_subtotal_snapshot := coalesce(new.merchandise_subtotal_snapshot, new.sale_price);
  new.discount_snapshot := coalesce(new.discount_snapshot, 0);
  new.shipping_fee_snapshot := coalesce(new.shipping_fee_snapshot, 0);
  new.total_paid_snapshot := coalesce(
    new.total_paid_snapshot,
    new.merchandise_subtotal_snapshot - new.discount_snapshot + new.shipping_fee_snapshot
  );
  new.aggregate_cogs_snapshot := coalesce(new.aggregate_cogs_snapshot, new.cost_snapshot);
  new.aggregate_profit_snapshot := case
    when new.aggregate_cogs_snapshot is null then null
    else coalesce(
      new.aggregate_profit_snapshot,
      new.merchandise_subtotal_snapshot - new.discount_snapshot - new.aggregate_cogs_snapshot
    )
  end;
  new.sale_timestamp := coalesce(new.sale_timestamp, new.sale_date::timestamptz);
  return new;
end;
$$;

create trigger sync_sale_header_snapshots
before insert on public.sales
for each row execute function public.sync_sale_header_snapshots();

create or replace function public.sync_order_item_line_total()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.line_total_snapshot := coalesce(new.line_total_snapshot, new.selling_price_snapshot);
  return new;
end;
$$;

create trigger sync_order_item_line_total
before insert on public.order_items
for each row execute function public.sync_order_item_line_total();

create or replace function public.block_immutable_transaction_child_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Transaction item snapshots are immutable.';
end;
$$;

create trigger protect_payment_request_item_snapshots
before update or delete on public.payment_request_items
for each row execute function public.block_immutable_transaction_child_change();

create trigger protect_sale_item_snapshots
before update or delete on public.sale_items
for each row execute function public.block_immutable_transaction_child_change();

create or replace function public.protect_paid_payment_request_sale()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_payment_request_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Paid Payment Request Sales cannot be deleted.';
  end if;
  if new.user_id is distinct from old.user_id
    or new.source_payment_request_id is distinct from old.source_payment_request_id
    or new.customer_name_snapshot is distinct from old.customer_name_snapshot
    or new.customer_contact_snapshot is distinct from old.customer_contact_snapshot
    or new.shipping_address_snapshot is distinct from old.shipping_address_snapshot
    or new.merchandise_subtotal_snapshot is distinct from old.merchandise_subtotal_snapshot
    or new.discount_snapshot is distinct from old.discount_snapshot
    or new.shipping_fee_snapshot is distinct from old.shipping_fee_snapshot
    or new.total_paid_snapshot is distinct from old.total_paid_snapshot
    or new.aggregate_cogs_snapshot is distinct from old.aggregate_cogs_snapshot
    or new.aggregate_profit_snapshot is distinct from old.aggregate_profit_snapshot
    or new.payment_method_snapshot is distinct from old.payment_method_snapshot
    or new.sale_timestamp is distinct from old.sale_timestamp
    or new.payment_status is distinct from old.payment_status then
    raise exception 'Paid Payment Request Sale snapshots are immutable.';
  end if;
  return new;
end;
$$;

create trigger protect_paid_payment_request_sale
before update or delete on public.sales
for each row execute function public.protect_paid_payment_request_sale();

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
    or new.line_total_snapshot is distinct from old.line_total_snapshot
    or new.quantity is distinct from old.quantity then
    raise exception 'Order Item source and financial snapshots are immutable.';
  end if;
  return new;
end;
$$;

alter table public.payment_request_items enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.sale_items enable row level security;

create policy "payment_request_items_select_own"
on public.payment_request_items for select using (auth.uid() = user_id);
create policy "inventory_reservations_select_own"
on public.inventory_reservations for select using (auth.uid() = user_id);
create policy "sale_items_select_own"
on public.sale_items for select using (auth.uid() = user_id);

revoke all on public.payment_request_items from anon, authenticated;
revoke all on public.inventory_reservations from anon, authenticated;
revoke all on public.sale_items from anon, authenticated;
grant select on public.payment_request_items to authenticated;
grant select on public.inventory_reservations to authenticated;
grant select on public.sale_items to authenticated;

create or replace function public.create_payment_request_v2(
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text,
  p_shipping_address text,
  p_shipping_fee numeric,
  p_shipping_mode text,
  p_courier text,
  p_discount numeric,
  p_valid_until date,
  p_customer_note text,
  p_payment_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_item_ids uuid[] := array[]::uuid[];
  v_prices numeric[] := array[]::numeric[];
  v_item_id uuid;
  v_price numeric(12,2);
  v_count integer;
  v_locked_count integer;
  v_subtotal numeric(12,2) := 0;
  v_shipping_mode text := coalesce(nullif(trim(p_shipping_mode), ''), 'fee_now');
  v_shipping_fee numeric(12,2);
  v_discount numeric(12,2) := round(coalesce(p_discount, 0), 2);
  v_total numeric(12,2);
  v_request public.payment_requests%rowtype;
  v_date_prefix text := to_char(current_date, 'YYYYMMDD');
  v_sequence integer;
  v_first_inventory public.inventory_items%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication is required.'; end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null then raise exception 'Customer name is required.'; end if;
  if nullif(trim(coalesce(p_customer_contact, '')), '') is null then raise exception 'Customer contact is required.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Choose a valid item list.'; end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 then raise exception 'Choose at least one item.'; end if;
  if v_count > 50 then raise exception 'Choose no more than 50 items.'; end if;

  for v_entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry) <> 'object'
      or jsonb_typeof(v_entry -> 'inventory_item_id') <> 'string'
      or jsonb_typeof(v_entry -> 'unit_price') not in ('number', 'string') then
      raise exception 'Choose a valid item list.';
    end if;
    if (v_entry ->> 'inventory_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Choose a valid item list.';
    end if;
    if (v_entry ->> 'unit_price') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Enter valid item prices.';
    end if;
    v_item_id := (v_entry ->> 'inventory_item_id')::uuid;
    v_price := round((v_entry ->> 'unit_price')::numeric, 2);
    if v_price < 0 then raise exception 'Item prices cannot be negative.'; end if;
    if v_item_id = any(v_item_ids) then raise exception 'Each item can be selected only once.'; end if;
    v_item_ids := array_append(v_item_ids, v_item_id);
    v_prices := array_append(v_prices, v_price);
    v_subtotal := v_subtotal + v_price;
  end loop;

  if v_shipping_mode not in ('fee_now', 'to_follow', 'pickup') then raise exception 'Choose a valid shipping mode.'; end if;
  v_shipping_fee := case when v_shipping_mode = 'fee_now' then round(coalesce(p_shipping_fee, 0), 2) else 0 end;
  if v_shipping_fee < 0 then raise exception 'Shipping fee cannot be negative.'; end if;
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Discount must not exceed the merchandise subtotal.'; end if;
  v_total := v_subtotal - v_discount + v_shipping_fee;

  perform 1 from public.inventory_items i
  where i.id = any(v_item_ids) and i.user_id = v_user_id
  order by i.id for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_count then raise exception 'One or more selected items are unavailable.'; end if;
  if exists (
    select 1 from public.inventory_items i
    where i.id = any(v_item_ids) and i.user_id = v_user_id and i.status <> 'Available'
  ) then raise exception 'One or more selected items are unavailable.'; end if;
  if exists (
    select 1 from public.inventory_reservations where inventory_item_id = any(v_item_ids)
  ) then raise exception 'One or more selected items are already reserved.'; end if;

  select * into v_first_inventory
  from public.inventory_items i
  where i.id = v_item_ids[1] and i.user_id = v_user_id;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || v_date_prefix, 0));
  select coalesce(max(substring(request_number from 13)::integer), 0) + 1
  into v_sequence from public.payment_requests
  where user_id = v_user_id and request_number like 'PR-' || v_date_prefix || '-%';

  insert into public.payment_requests (
    user_id, request_number, inventory_item_id, customer_name, customer_contact,
    shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
    courier, discount, total_amount, status, valid_until, customer_note,
    payment_config_snapshot, merchandise_subtotal_snapshot, discount_snapshot,
    shipping_fee_snapshot
  ) values (
    v_user_id, 'PR-' || v_date_prefix || '-' || lpad(v_sequence::text, 3, '0'),
    v_first_inventory.id, trim(p_customer_name), trim(p_customer_contact),
    nullif(trim(coalesce(p_shipping_address, '')), ''),
    case when v_count = 1 then v_first_inventory.name else v_count::text || ' items' end,
    v_subtotal, v_shipping_fee, v_shipping_mode,
    nullif(trim(coalesce(p_courier, '')), ''), v_discount, v_total, 'Pending',
    p_valid_until, nullif(trim(coalesce(p_customer_note, '')), ''),
    coalesce(p_payment_config, '{}'::jsonb), v_subtotal, v_discount, v_shipping_fee
  ) returning * into v_request;

  insert into public.payment_request_items (
    user_id, payment_request_id, inventory_item_id, sku_snapshot,
    item_name_snapshot, unit_price_snapshot, quantity, line_total_snapshot
  )
  select
    v_user_id, v_request.id, i.id, i.sku, i.name,
    v_prices[array_position(v_item_ids, i.id)], 1,
    v_prices[array_position(v_item_ids, i.id)]
  from public.inventory_items i
  where i.id = any(v_item_ids) and i.user_id = v_user_id
  order by i.id;

  insert into public.inventory_reservations (user_id, payment_request_id, inventory_item_id)
  select v_user_id, v_request.id, i.id
  from public.inventory_items i
  where i.id = any(v_item_ids) and i.user_id = v_user_id
  order by i.id;

  update public.inventory_items i
  set status = 'Reserved', locked = false
  where i.id = any(v_item_ids) and i.user_id = v_user_id;

  return jsonb_build_object(
    'payment_request', to_jsonb(v_request),
    'item_count', v_count,
    'merchandise_subtotal', v_subtotal,
    'shipping_fee', v_shipping_fee,
    'discount', v_discount,
    'total_amount', v_total
  );
end;
$$;

create or replace function public.cancel_multi_item_payment_request_v1(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.payment_requests%rowtype;
  v_item_count integer;
  v_reservation_count integer;
begin
  if v_user_id is null then raise exception 'Authentication is required.'; end if;
  select * into v_request from public.payment_requests
  where id = p_request_id and user_id = v_user_id for update;
  if not found then raise exception 'Payment Request was not found.'; end if;
  if v_request.status = 'Cancelled' then
    return jsonb_build_object('payment_request', to_jsonb(v_request), 'already_cancelled', true);
  end if;
  if v_request.status <> 'Pending' then raise exception 'Only Pending Payment Requests can be cancelled.'; end if;

  perform 1 from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id
  order by inventory_item_id for update;
  select count(*) into v_item_count from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id;
  if v_item_count = 0 then raise exception 'Payment Request item history is incomplete.'; end if;

  perform 1 from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id
  order by inventory_item_id for update;
  select count(*) into v_reservation_count from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id;
  if v_reservation_count <> v_item_count then raise exception 'Payment Request reservation state is incomplete.'; end if;

  perform 1 from public.inventory_items i
  join public.payment_request_items pri
    on pri.inventory_item_id = i.id and pri.user_id = i.user_id
  where pri.payment_request_id = v_request.id and i.user_id = v_user_id
  order by i.id for update of i;

  if exists (
    select 1
    from public.payment_request_items pri
    join public.inventory_items i on i.id = pri.inventory_item_id and i.user_id = pri.user_id
    where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
      and i.status <> 'Reserved'
  ) then raise exception 'One or more reserved items changed state.'; end if;

  update public.inventory_items i
  set status = 'Available', locked = false
  from public.payment_request_items pri
  where pri.payment_request_id = v_request.id
    and pri.user_id = v_user_id
    and i.id = pri.inventory_item_id and i.user_id = pri.user_id
    and i.status = 'Reserved';

  delete from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id;

  update public.payment_requests
  set status = 'Cancelled', cancelled_at = transaction_timestamp()
  where id = v_request.id and user_id = v_user_id
  returning * into v_request;

  return jsonb_build_object('payment_request', to_jsonb(v_request), 'released_item_count', v_item_count);
end;
$$;

create or replace function public.mark_multi_item_payment_request_paid_v1(
  p_request_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.payment_requests%rowtype;
  v_sale public.sales%rowtype;
  v_order public.orders%rowtype;
  v_item_count integer;
  v_locked_count integer;
  v_reservation_count integer;
  v_subtotal numeric(12,2);
  v_cogs numeric(12,2);
  v_has_unknown_cost boolean;
  v_date_prefix text := to_char(current_date, 'YYYYMMDD');
  v_sequence integer;
  v_discount_cents bigint;
  v_subtotal_cents bigint;
  v_allocated_cents bigint := 0;
  v_remainder_cents bigint;
  v_last_item_id uuid;
  v_last_line_cents bigint;
  v_excess_cents bigint;
  v_capacity_cents bigint;
  v_add_cents bigint;
  v_allocations jsonb := '{}'::jsonb;
  v_row record;
begin
  if v_user_id is null then raise exception 'Authentication is required.'; end if;
  if p_payment_method not in ('GCash', 'GoTyme') then raise exception 'Choose GCash or GoTyme.'; end if;

  select * into v_request from public.payment_requests
  where id = p_request_id and user_id = v_user_id for update;
  if not found then raise exception 'Payment Request was not found.'; end if;

  select count(*) into v_item_count from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id;

  if v_request.status = 'Paid' then
    select * into v_sale from public.sales
    where source_payment_request_id = v_request.id and user_id = v_user_id;
    select * into v_order from public.orders
    where source_payment_request_id = v_request.id and user_id = v_user_id;
    if v_item_count > 0
      and v_sale.id is not null
      and v_order.id is not null
      and (select count(*) from public.sale_items where sale_id = v_sale.id and user_id = v_user_id) = v_item_count
      and (select count(*) from public.order_items where order_id = v_order.id and user_id = v_user_id) = v_item_count
      and (select count(*) from public.order_fulfillment_events
           where order_id = v_order.id and user_id = v_user_id
             and from_status is null and to_status = 'ready_to_pack') = 1 then
      return jsonb_build_object(
        'payment_request', to_jsonb(v_request), 'sale', to_jsonb(v_sale),
        'order', to_jsonb(v_order), 'item_count', v_item_count, 'already_paid', true
      );
    end if;
    raise exception 'Paid transaction history is incomplete.';
  end if;
  if v_request.status <> 'Pending' then raise exception 'Only Pending Payment Requests can be marked Paid.'; end if;
  if v_item_count = 0 then raise exception 'Payment Request item history is incomplete.'; end if;

  perform 1 from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id
  order by inventory_item_id for update;

  perform 1 from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id
  order by inventory_item_id for update;
  select count(*) into v_reservation_count from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id;
  if v_reservation_count <> v_item_count then raise exception 'Payment Request reservation state is incomplete.'; end if;

  perform 1 from public.inventory_items i
  join public.payment_request_items pri
    on pri.inventory_item_id = i.id and pri.user_id = i.user_id
  where pri.payment_request_id = v_request.id and i.user_id = v_user_id
  order by i.id for update of i;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_item_count then raise exception 'One or more selected items are unavailable.'; end if;

  if exists (
    select 1
    from public.payment_request_items pri
    join public.inventory_items i on i.id = pri.inventory_item_id and i.user_id = pri.user_id
    left join public.inventory_reservations ir
      on ir.payment_request_id = pri.payment_request_id
      and ir.inventory_item_id = pri.inventory_item_id
      and ir.user_id = pri.user_id
    where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
      and (i.status <> 'Reserved' or ir.id is null)
  ) then raise exception 'One or more selected items are no longer reserved.'; end if;
  if exists (
    select 1 from public.sale_items si
    join public.payment_request_items pri on pri.inventory_item_id = si.inventory_item_id
    where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
  ) or exists (
    select 1 from public.sales s
    join public.payment_request_items pri on pri.inventory_item_id = s.inventory_item_id
    where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
  ) then raise exception 'One or more selected items were already sold.'; end if;

  select sum(line_total_snapshot) into v_subtotal
  from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id;
  if v_subtotal is distinct from v_request.merchandise_subtotal_snapshot
    or v_request.total_amount is distinct from
      v_request.merchandise_subtotal_snapshot - v_request.discount_snapshot + v_request.shipping_fee_snapshot then
    raise exception 'Payment Request totals do not reconcile.';
  end if;

  select bool_or(i.cost is null), sum(i.cost)
  into v_has_unknown_cost, v_cogs
  from public.inventory_items i
  join public.payment_request_items pri
    on pri.inventory_item_id = i.id and pri.user_id = i.user_id
  where pri.payment_request_id = v_request.id and pri.user_id = v_user_id;
  if v_has_unknown_cost then v_cogs := null; end if;

  insert into public.sales (
    user_id, inventory_item_id, collection_id, sku_snapshot, item_name_snapshot,
    cost_snapshot, sale_price, platform, payment_status, sale_date, notes,
    source_payment_request_id, customer_name_snapshot, customer_contact_snapshot,
    shipping_address_snapshot, merchandise_subtotal_snapshot, discount_snapshot,
    shipping_fee_snapshot, total_paid_snapshot, aggregate_cogs_snapshot,
    aggregate_profit_snapshot, payment_method_snapshot, sale_timestamp
  ) values (
    v_user_id, null, null, null, 'Multiple items',
    v_cogs, v_request.merchandise_subtotal_snapshot - v_request.discount_snapshot,
    'Direct Customer', 'Paid', current_date,
    'Paid multi-item Payment Request ' || v_request.request_number,
    v_request.id, v_request.customer_name, v_request.customer_contact,
    v_request.shipping_address, v_request.merchandise_subtotal_snapshot,
    v_request.discount_snapshot, v_request.shipping_fee_snapshot, v_request.total_amount,
    v_cogs,
    case when v_cogs is null then null
      else v_request.merchandise_subtotal_snapshot - v_request.discount_snapshot - v_cogs end,
    p_payment_method, transaction_timestamp()
  ) returning * into v_sale;

  v_discount_cents := round(v_request.discount_snapshot * 100)::bigint;
  v_subtotal_cents := round(v_request.merchandise_subtotal_snapshot * 100)::bigint;

  select inventory_item_id, round(line_total_snapshot * 100)::bigint
  into v_last_item_id, v_last_line_cents
  from public.payment_request_items
  where payment_request_id = v_request.id and user_id = v_user_id
  order by line_total_snapshot desc, inventory_item_id desc
  limit 1;

  for v_row in
    select inventory_item_id, round(line_total_snapshot * 100)::bigint as line_cents
    from public.payment_request_items
    where payment_request_id = v_request.id and user_id = v_user_id
      and inventory_item_id <> v_last_item_id
    order by line_total_snapshot, inventory_item_id
  loop
    v_add_cents := case when v_subtotal_cents = 0 then 0
      else floor((v_discount_cents::numeric * v_row.line_cents) / v_subtotal_cents)::bigint end;
    v_allocations := jsonb_set(v_allocations, array[v_row.inventory_item_id::text], to_jsonb(v_add_cents));
    v_allocated_cents := v_allocated_cents + v_add_cents;
  end loop;

  v_remainder_cents := v_discount_cents - v_allocated_cents;
  if v_remainder_cents > v_last_line_cents then
    v_excess_cents := v_remainder_cents - v_last_line_cents;
    for v_row in
      select inventory_item_id, round(line_total_snapshot * 100)::bigint as line_cents
      from public.payment_request_items
      where payment_request_id = v_request.id and user_id = v_user_id
        and inventory_item_id <> v_last_item_id
      order by line_total_snapshot desc, inventory_item_id desc
    loop
      v_capacity_cents := v_row.line_cents - coalesce((v_allocations ->> v_row.inventory_item_id::text)::bigint, 0);
      v_add_cents := least(v_excess_cents, v_capacity_cents);
      v_allocations := jsonb_set(
        v_allocations,
        array[v_row.inventory_item_id::text],
        to_jsonb(coalesce((v_allocations ->> v_row.inventory_item_id::text)::bigint, 0) + v_add_cents)
      );
      v_excess_cents := v_excess_cents - v_add_cents;
      exit when v_excess_cents = 0;
    end loop;
    if v_excess_cents <> 0 then raise exception 'Discount allocation could not be reconciled.'; end if;
    v_remainder_cents := v_last_line_cents;
  end if;
  v_allocations := jsonb_set(v_allocations, array[v_last_item_id::text], to_jsonb(v_remainder_cents));

  insert into public.sale_items (
    user_id, sale_id, inventory_item_id, collection_id, sku_snapshot,
    item_name_snapshot, unit_cost_snapshot, unit_price_snapshot, quantity,
    line_subtotal_snapshot, allocated_discount_snapshot, net_item_revenue_snapshot
  )
  select
    v_user_id, v_sale.id, i.id, i.collection_id, pri.sku_snapshot,
    pri.item_name_snapshot, i.cost, pri.unit_price_snapshot, 1,
    pri.line_total_snapshot,
    coalesce((v_allocations ->> i.id::text)::numeric, 0) / 100,
    pri.line_total_snapshot - coalesce((v_allocations ->> i.id::text)::numeric, 0) / 100
  from public.payment_request_items pri
  join public.inventory_items i on i.id = pri.inventory_item_id and i.user_id = pri.user_id
  where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
  order by i.id;

  if (select sum(allocated_discount_snapshot) from public.sale_items where sale_id = v_sale.id)
      is distinct from v_request.discount_snapshot then
    raise exception 'Discount allocation could not be reconciled.';
  end if;

  update public.inventory_items i
  set status = 'Sold', locked = true, price = pri.unit_price_snapshot,
      sold_at = transaction_timestamp(), payment_status = 'Paid', platform = 'Direct Customer'
  from public.payment_request_items pri
  where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
    and i.id = pri.inventory_item_id and i.user_id = pri.user_id;

  update public.payment_requests
  set status = 'Paid', payment_method = p_payment_method, paid_at = transaction_timestamp()
  where id = v_request.id and user_id = v_user_id
  returning * into v_request;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':order:' || v_date_prefix, 0));
  select coalesce(max(substring(order_number from 14)::integer), 0) + 1
  into v_sequence from public.orders
  where user_id = v_user_id and order_number like 'ORD-' || v_date_prefix || '-%';

  insert into public.orders (
    user_id, order_number, source_type, source_payment_request_id,
    customer_name, customer_contact, shipping_address, fulfillment_method,
    fulfillment_status, currency, subtotal_snapshot, shipping_fee_snapshot,
    discount_snapshot, total_paid_snapshot, payment_confirmed_at, courier
  ) values (
    v_user_id, 'ORD-' || v_date_prefix || '-' || lpad(v_sequence::text, 3, '0'),
    'payment_request', v_request.id, v_request.customer_name, v_request.customer_contact,
    v_request.shipping_address,
    case when v_request.shipping_mode = 'pickup' then 'pickup' else 'shipment' end,
    'ready_to_pack', 'PHP', v_request.merchandise_subtotal_snapshot,
    v_request.shipping_fee_snapshot, v_request.discount_snapshot,
    v_request.total_amount, v_request.paid_at, v_request.courier
  ) returning * into v_order;

  insert into public.order_items (
    user_id, order_id, sale_id, inventory_item_id, sku_snapshot,
    item_name_snapshot, selling_price_snapshot, quantity, packing_required,
    line_total_snapshot
  )
  select
    v_user_id, v_order.id, v_sale.id, pri.inventory_item_id, pri.sku_snapshot,
    pri.item_name_snapshot, pri.unit_price_snapshot, 1, true, pri.line_total_snapshot
  from public.payment_request_items pri
  where pri.payment_request_id = v_request.id and pri.user_id = v_user_id
  order by pri.inventory_item_id;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, null, 'ready_to_pack', v_user_id,
    'Order created from paid Payment Request.',
    jsonb_build_object('action', 'order_created', 'item_count', v_item_count)
  );

  delete from public.inventory_reservations
  where payment_request_id = v_request.id and user_id = v_user_id;

  return jsonb_build_object(
    'payment_request', to_jsonb(v_request), 'sale', to_jsonb(v_sale),
    'order', to_jsonb(v_order), 'item_count', v_item_count,
    'shipping_collected', v_request.shipping_fee_snapshot,
    'merchandise_revenue', v_request.merchandise_subtotal_snapshot - v_request.discount_snapshot
  );
end;
$$;

revoke all on function public.create_payment_request_v2(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_multi_item_payment_request_v1(uuid) from public, anon, authenticated;
revoke all on function public.mark_multi_item_payment_request_paid_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.create_payment_request_v2(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) to authenticated;
grant execute on function public.cancel_multi_item_payment_request_v1(uuid) to authenticated;
grant execute on function public.mark_multi_item_payment_request_paid_v1(uuid, text) to authenticated;

do $$
declare
begin
  if exists (
    select 1
    from public.payment_requests pr
    left join public.payment_request_items pri
      on pri.payment_request_id = pr.id and pri.user_id = pr.user_id
    group by pr.id
    having count(pri.id) <> 1
  ) then raise exception 'Legacy Payment Request backfill is incomplete.'; end if;

  if exists (
    select 1
    from public.sales s
    left join public.sale_items si on si.sale_id = s.id and si.user_id = s.user_id
    where s.inventory_item_id is not null
    group by s.id
    having count(si.id) <> 1
  ) then raise exception 'Legacy Sale backfill is incomplete.'; end if;

  if exists (
    select 1 from public.payment_request_items pri
    join public.payment_requests pr on pr.id = pri.payment_request_id
    join public.inventory_items i on i.id = pri.inventory_item_id
    where pri.user_id <> pr.user_id or pri.user_id <> i.user_id
  ) or exists (
    select 1 from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.inventory_items i on i.id = si.inventory_item_id
    where si.user_id <> s.user_id or si.user_id <> i.user_id
  ) then raise exception 'Transaction child ownership validation failed.'; end if;

  if exists (
    select 1 from public.payment_requests
    where merchandise_subtotal_snapshot - discount_snapshot + shipping_fee_snapshot <> total_amount
  ) or exists (
    select 1 from public.sales
    where merchandise_subtotal_snapshot - discount_snapshot + shipping_fee_snapshot <> total_paid_snapshot
  ) then raise exception 'Historical financial totals changed during migration.'; end if;

  if exists (
    select 1 from public.payment_requests pr
    where pr.status = 'Paid' and (
      (select count(*) from public.sales s where s.source_payment_request_id = pr.id and s.user_id = pr.user_id) <> 1
      or (select count(*) from public.orders o where o.source_payment_request_id = pr.id and o.user_id = pr.user_id) <> 1
    )
  ) then raise exception 'Paid transaction history is incomplete.'; end if;
end;
$$;
