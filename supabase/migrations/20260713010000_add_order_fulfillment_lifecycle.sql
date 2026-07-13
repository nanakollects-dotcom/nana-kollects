alter table public.orders
  drop constraint orders_fulfillment_method_check;

alter table public.orders
  add constraint orders_fulfillment_method_check
  check (fulfillment_method in ('shipment', 'local_delivery', 'pickup'));

alter table public.orders
  drop constraint orders_timestamp_sequence_check;

alter table public.orders
  add constraint orders_timestamp_sequence_check check (
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
  );

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
  if v_order.fulfillment_status = 'packing' then
    return v_order;
  end if;
  if v_order.fulfillment_status <> 'ready_to_pack' then
    raise exception 'Only Ready to Pack Orders can start packing.';
  end if;

  update public.orders
  set fulfillment_status = 'packing'
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

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
    where order_id = v_order.id and user_id = v_user_id
      and packing_required and checked_at is null
  ) then
    raise exception 'Check every required Order Item before marking Packed.';
  end if;
  if v_order.fulfillment_status = 'packed' then
    return v_order;
  end if;
  if v_order.fulfillment_status <> 'packing' then
    raise exception 'Only Packing Orders can be marked Packed.';
  end if;

  update public.orders
  set fulfillment_status = 'packed', packed_at = now()
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
  if v_order.fulfillment_method = 'pickup' then
    raise exception 'Pickup Orders cannot be marked Shipped.';
  end if;
  if v_order.fulfillment_status = 'shipped' then
    return v_order;
  end if;
  if v_order.fulfillment_status <> 'packed' then
    raise exception 'Only Packed Orders can be marked Shipped.';
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
    where order_id = v_order.id and user_id = v_user_id
      and packing_required and checked_at is null
  ) then
    raise exception 'Every required Order Item must be checked before shipping.';
  end if;
  if nullif(trim(coalesce(v_order.shipping_address, '')), '') is null then
    raise exception 'Shipping address is required before shipping.';
  end if;
  if v_courier is null then
    raise exception 'Courier is required before shipping.';
  end if;
  if p_shipped_at is null then
    raise exception 'Shipped date and time are required.';
  end if;
  if v_tracking_number is null and v_no_tracking_reason is null then
    raise exception 'Enter a tracking number or an explicit no-tracking reason.';
  end if;
  if v_tracking_number is not null and v_no_tracking_reason is not null then
    raise exception 'Use either a tracking number or a no-tracking reason, not both.';
  end if;
  if v_order.packed_at is null or p_shipped_at < v_order.packed_at then
    raise exception 'Shipped date and time cannot be before packing.';
  end if;

  update public.orders
  set fulfillment_status = 'shipped',
      courier = v_courier,
      tracking_number = v_tracking_number,
      tracking_not_applicable_reason = v_no_tracking_reason,
      shipped_at = p_shipped_at,
      shipping_note = nullif(trim(coalesce(p_shipping_note, '')), '')
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
      'has_tracking_number', v_tracking_number is not null,
      'has_no_tracking_reason', v_no_tracking_reason is not null
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
  v_from_status text;
begin
  if v_user_id is null then
    raise exception 'No authenticated user found.';
  end if;
  if p_completed_at is null then
    raise exception 'Completion date and time are required.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.fulfillment_status = 'completed' then
    return v_order;
  end if;

  if v_order.fulfillment_method = 'pickup' then
    if v_order.fulfillment_status <> 'packed' then
      raise exception 'Pickup Orders can be completed only from Packed.';
    end if;
    if v_order.packed_at is null or p_completed_at < v_order.packed_at then
      raise exception 'Completion date and time cannot be before packing.';
    end if;
  else
    if v_order.fulfillment_status <> 'shipped' then
      raise exception 'Shipment Orders can be completed only from Shipped.';
    end if;
    if v_order.shipped_at is null or p_completed_at < v_order.shipped_at then
      raise exception 'Completion date and time cannot be before shipping.';
    end if;
  end if;

  v_from_status := v_order.fulfillment_status;

  update public.orders
  set fulfillment_status = 'completed', completed_at = p_completed_at
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, v_from_status, 'completed', v_user_id,
    nullif(trim(coalesce(p_note, '')), ''),
    jsonb_build_object('action', 'mark_completed')
  );

  return v_order;
end;
$$;

revoke all on function public.start_order_packing(uuid) from public;
revoke all on function public.set_order_item_packed(uuid, boolean) from public;
revoke all on function public.mark_order_packed(uuid) from public;
revoke all on function public.reopen_order_packing(uuid) from public;
revoke all on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) from public;
revoke all on function public.mark_order_completed(uuid, timestamptz, text) from public;

revoke all on function public.start_order_packing(uuid) from anon;
revoke all on function public.set_order_item_packed(uuid, boolean) from anon;
revoke all on function public.mark_order_packed(uuid) from anon;
revoke all on function public.reopen_order_packing(uuid) from anon;
revoke all on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) from anon;
revoke all on function public.mark_order_completed(uuid, timestamptz, text) from anon;

grant execute on function public.start_order_packing(uuid) to authenticated;
grant execute on function public.set_order_item_packed(uuid, boolean) to authenticated;
grant execute on function public.mark_order_packed(uuid) to authenticated;
grant execute on function public.reopen_order_packing(uuid) to authenticated;
grant execute on function public.mark_order_shipped(uuid, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.mark_order_completed(uuid, timestamptz, text) to authenticated;
