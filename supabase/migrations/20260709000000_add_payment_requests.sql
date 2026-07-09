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

create unique index if not exists idx_payment_requests_one_pending_item
on public.payment_requests(inventory_item_id)
where status = 'Pending';

create index if not exists idx_payment_requests_user_id
on public.payment_requests(user_id);

create index if not exists idx_payment_requests_user_issued
on public.payment_requests(user_id, issued_at desc);

create unique index if not exists idx_sales_one_per_inventory_item
on public.sales(inventory_item_id)
where inventory_item_id is not null;

drop trigger if exists set_payment_requests_updated_at on public.payment_requests;
create trigger set_payment_requests_updated_at
before update on public.payment_requests
for each row execute function public.set_updated_at();

alter table public.payment_requests enable row level security;

drop policy if exists "payment_requests_select_own" on public.payment_requests;
create policy "payment_requests_select_own"
on public.payment_requests for select
using (auth.uid() = user_id);

drop policy if exists "payment_requests_insert_own" on public.payment_requests;
create policy "payment_requests_insert_own"
on public.payment_requests for insert
with check (auth.uid() = user_id);

drop policy if exists "payment_requests_update_own" on public.payment_requests;
create policy "payment_requests_update_own"
on public.payment_requests for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "payment_requests_delete_own" on public.payment_requests;
create policy "payment_requests_delete_own"
on public.payment_requests for delete
using (auth.uid() = user_id);

create or replace function public.create_payment_request(
  p_inventory_item_id uuid,
  p_customer_name text,
  p_customer_contact text,
  p_shipping_address text,
  p_item_price numeric,
  p_shipping_fee numeric,
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
  if coalesce(p_item_price, -1) < 0 then
    raise exception 'Selling price must be zero or higher.';
  end if;
  if coalesce(p_shipping_fee, -1) < 0 then
    raise exception 'Shipping fee must be zero or higher.';
  end if;
  if coalesce(p_discount, -1) < 0 then
    raise exception 'Discount must be zero or higher.';
  end if;

  v_total := round((p_item_price + p_shipping_fee - p_discount)::numeric, 2);
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
    round(p_shipping_fee, 2),
    round(p_discount, 2),
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

create or replace function public.mark_payment_request_paid(
  p_request_id uuid,
  p_payment_method text
)
returns public.payment_requests
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.payment_requests%rowtype;
  v_item public.inventory_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;
  if p_payment_method not in ('GCash', 'GoTyme') then
    raise exception 'Choose GCash or GoTyme.';
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
    raise exception 'Only Pending requests can be marked Paid.';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = v_request.inventory_item_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Inventory item not found.';
  end if;
  if v_item.status <> 'Reserved' then
    raise exception 'The requested item is not Reserved.';
  end if;
  if exists (
    select 1 from public.sales
    where inventory_item_id = v_item.id
      and user_id = v_user_id
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
  where id = v_item.id
    and user_id = v_user_id;

  insert into public.sales (
    user_id,
    inventory_item_id,
    collection_id,
    sku_snapshot,
    item_name_snapshot,
    cost_snapshot,
    sale_price,
    platform,
    payment_status,
    sale_date,
    notes
  )
  values (
    v_user_id,
    v_item.id,
    v_item.collection_id,
    v_item.sku,
    v_request.item_name_snapshot,
    v_item.cost,
    v_request.item_price,
    'Direct Customer',
    'Paid',
    current_date,
    'Payment request ' || v_request.request_number || ' paid via ' || p_payment_method
  );

  update public.payment_requests
  set status = 'Paid',
      payment_method = p_payment_method
  where id = v_request.id
    and user_id = v_user_id
  returning * into v_request;

  return v_request;
end;
$$;

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

revoke all on function public.create_payment_request(uuid, text, text, text, numeric, numeric, numeric, date, text, jsonb) from public;
revoke all on function public.mark_payment_request_paid(uuid, text) from public;
revoke all on function public.cancel_payment_request(uuid) from public;

grant execute on function public.create_payment_request(uuid, text, text, text, numeric, numeric, numeric, date, text, jsonb) to authenticated;
grant execute on function public.mark_payment_request_paid(uuid, text) to authenticated;
grant execute on function public.cancel_payment_request(uuid) to authenticated;
