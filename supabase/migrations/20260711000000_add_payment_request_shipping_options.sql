alter table public.payment_requests
  add column if not exists shipping_mode text not null default 'fee_now',
  add column if not exists courier text;

alter table public.payment_requests
  drop constraint if exists payment_requests_shipping_mode_check;

alter table public.payment_requests
  add constraint payment_requests_shipping_mode_check
  check (shipping_mode in ('fee_now', 'to_follow', 'pickup'));

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