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

create or replace function public.create_multi_item_payment_request_v1(
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

revoke all on function public.create_multi_item_payment_request_v1(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_multi_item_payment_request_v1(uuid) from public, anon, authenticated;
revoke all on function public.mark_multi_item_payment_request_paid_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.create_multi_item_payment_request_v1(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) to authenticated;
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
