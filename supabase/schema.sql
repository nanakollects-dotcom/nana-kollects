sql
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
  constraint payment_requests_item_price_nonnegative check (item_price >= 0),
  constraint payment_requests_shipping_nonnegative check (shipping_fee >= 0),
  constraint payment_requests_discount_nonnegative check (discount >= 0),
  constraint payment_requests_total_nonnegative check (total_amount >= 0),
  constraint payment_requests_status_check check (status in ('Pending', 'Paid', 'Cancelled')),
  constraint payment_requests_method_check check (payment_method is null or payment_method in ('GCash', 'GoTyme'))
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
