-- Allow customers to decline storage of a mobile number without weakening
-- ownership, inventory reservation, payment, or fulfillment rules.

alter table public.payment_requests
  alter column customer_contact drop not null;

alter table public.orders
  alter column customer_contact drop not null;

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
    nullif(trim(coalesce(p_customer_contact, '')), ''),
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
    v_first_inventory.id, trim(p_customer_name),
    nullif(trim(coalesce(p_customer_contact, '')), ''),
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

revoke all on function public.create_payment_request(uuid, text, text, text, numeric, numeric, text, text, numeric, date, text, jsonb) from public, anon;
revoke all on function public.create_payment_request_v2(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) from public, anon;
grant execute on function public.create_payment_request(uuid, text, text, text, numeric, numeric, text, text, numeric, date, text, jsonb) to authenticated;
grant execute on function public.create_payment_request_v2(jsonb, text, text, text, numeric, text, text, numeric, date, text, jsonb) to authenticated;
