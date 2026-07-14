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
  v_note text := coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Order marked Completed.');
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
  if v_order.fulfillment_status <> 'shipped' then
    raise exception 'Only Shipped Orders can be marked Completed.';
  end if;
  if p_completed_at is null then
    raise exception 'Completion date and time are required.';
  end if;
  if v_order.shipped_at is null or p_completed_at < v_order.shipped_at then
    raise exception 'Completion date and time cannot be before shipping.';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Completion note is too long.';
  end if;

  update public.orders
  set fulfillment_status = 'completed',
      completed_at = p_completed_at
  where id = v_order.id and user_id = v_user_id
  returning * into v_order;

  insert into public.order_fulfillment_events (
    user_id, order_id, from_status, to_status, actor_user_id, note, metadata
  ) values (
    v_user_id, v_order.id, 'shipped', 'completed', v_user_id,
    v_note,
    jsonb_build_object('action', 'mark_completed')
  );

  return v_order;
end;
$$;

revoke all on function public.mark_order_completed(uuid, timestamptz, text) from public;
revoke all on function public.mark_order_completed(uuid, timestamptz, text) from anon;
grant execute on function public.mark_order_completed(uuid, timestamptz, text) to authenticated;
