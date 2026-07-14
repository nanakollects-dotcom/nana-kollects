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

revoke all on function public.mark_order_packed(uuid) from public;
revoke all on function public.mark_order_packed(uuid) from anon;
grant execute on function public.mark_order_packed(uuid) to authenticated;
