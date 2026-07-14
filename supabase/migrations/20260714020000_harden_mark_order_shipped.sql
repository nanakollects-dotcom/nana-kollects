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

revoke all on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) from public;
revoke all on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) from anon;
grant execute on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) to authenticated;
