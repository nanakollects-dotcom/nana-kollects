alter table public.inventory_items
  add constraint inventory_items_id_user_unique unique (id, user_id);

alter table public.sales
  add constraint sales_id_user_unique unique (id, user_id);

alter table public.payment_requests
  add constraint payment_requests_id_user_unique unique (id, user_id);

create table public.orders (
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

create table public.order_items (
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
  constraint order_items_order_owner_fk
    foreign key (order_id, user_id)
    references public.orders(id, user_id)
    on delete restrict,
  constraint order_items_sale_owner_fk
    foreign key (sale_id, user_id)
    references public.sales(id, user_id)
    on delete restrict,
  constraint order_items_inventory_owner_fk
    foreign key (inventory_item_id, user_id)
    references public.inventory_items(id, user_id)
    on delete restrict,
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

create table public.order_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_events_order_owner_fk
    foreign key (order_id, user_id)
    references public.orders(id, user_id)
    on delete restrict,
  constraint order_events_from_status_check check (
    from_status is null or from_status in ('ready_to_pack', 'packing', 'packed', 'shipped', 'completed')
  ),
  constraint order_events_to_status_check check (
    to_status in ('ready_to_pack', 'packing', 'packed', 'shipped', 'completed')
  ),
  constraint order_events_creation_check check (
    from_status is not null or to_status = 'ready_to_pack'
  ),
  constraint order_events_actor_owner check (actor_user_id = user_id)
);

create index idx_orders_user_status on public.orders(user_id, fulfillment_status);
create index idx_orders_user_created on public.orders(user_id, created_at desc);
create index idx_orders_user_customer on public.orders(user_id, customer_name);
create index idx_order_items_user_order on public.order_items(user_id, order_id);
create index idx_order_items_inventory on public.order_items(inventory_item_id);
create index idx_order_events_user_order_created
  on public.order_fulfillment_events(user_id, order_id, created_at);

create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

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

create trigger protect_order_immutable_fields
before update on public.orders
for each row execute function public.protect_order_immutable_fields();

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

create trigger protect_order_item_immutable_fields
before update on public.order_items
for each row execute function public.protect_order_item_immutable_fields();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfillment_events enable row level security;

create policy "orders_select_own"
on public.orders for select
using (auth.uid() = user_id);

create policy "order_items_select_own"
on public.order_items for select
using (auth.uid() = user_id);

create policy "order_events_select_own"
on public.order_fulfillment_events for select
using (auth.uid() = user_id);

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.order_fulfillment_events from anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_fulfillment_events to authenticated;

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
