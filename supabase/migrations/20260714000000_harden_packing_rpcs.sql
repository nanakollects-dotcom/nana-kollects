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

-- The legacy overload is retained because current application wrappers still
-- reference it. It is intentionally inaccessible until those wrappers migrate.
revoke all on function public.set_order_item_packed(uuid, boolean) from public;
revoke all on function public.set_order_item_packed(uuid, boolean) from anon;
revoke all on function public.set_order_item_packed(uuid, boolean) from authenticated;

revoke all on function public.start_order_packing(uuid) from public;
revoke all on function public.start_order_packing(uuid) from anon;
revoke all on function public.start_order_packing(uuid) from authenticated;

revoke all on function public.set_order_item_packed(uuid, uuid, boolean) from public;
revoke all on function public.set_order_item_packed(uuid, uuid, boolean) from anon;
revoke all on function public.set_order_item_packed(uuid, uuid, boolean) from authenticated;

grant execute on function public.start_order_packing(uuid) to authenticated;
grant execute on function public.set_order_item_packed(uuid, uuid, boolean) to authenticated;
