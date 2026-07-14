\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('31111111-1111-1111-1111-111111111111'),
  ('32222222-2222-2222-2222-222222222222');

insert into public.inventory_items (
  id, user_id, sku, name, cost, price, status, locked
)
select
  ('aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 9 then '32222222-2222-2222-2222-222222222222'::uuid else '31111111-1111-1111-1111-111111111111'::uuid end,
  'NK-H' || lpad(number::text, 2, '0'),
  'Hardening Item ' || number,
  40 + number,
  100 + number,
  'Reserved',
  false
from generate_series(1, 9) as number;

insert into public.payment_requests (
  id, user_id, request_number, inventory_item_id, customer_name, customer_contact,
  shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
  courier, discount, total_amount, status
)
select
  ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 9 then '32222222-2222-2222-2222-222222222222'::uuid else '31111111-1111-1111-1111-111111111111'::uuid end,
  'PR-HARDEN-' || lpad(number::text, 2, '0'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(number::text, 12, '0'))::uuid,
  'Hardening Customer ' || number,
  '0917000000' || number,
  'Hardening Address ' || number,
  'Hardening Item ' || number,
  100 + number,
  0,
  'fee_now',
  'Test Courier',
  0,
  100 + number,
  'Pending'
from generate_series(1, 9) as number;

select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select public.mark_payment_request_paid(
  ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(number::text, 12, '0'))::uuid,
  'GCash'
)
from generate_series(1, 8) as number;
reset role;

select set_config('request.jwt.claim.sub', '32222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-000000000009', 'GoTyme');
reset role;

-- Build status and item-shape fixtures as the database owner. All changes roll back.
delete from public.order_items
where order_id = (
  select id from public.orders
  where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003'
);

update public.order_items
set packing_required = false
where order_id = (
  select id from public.orders
  where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004'
);

update public.orders
set fulfillment_status = 'packed', packed_at = now()
where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005';

update public.orders
set fulfillment_status = 'shipped', packed_at = now(), shipped_at = now()
where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006';

update public.orders
set fulfillment_status = 'completed', packed_at = now(), shipped_at = now(), completed_at = now()
where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000007';

select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
set local role authenticated;

-- Owner transition with at least one required item succeeds.
select public.start_order_packing(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001')
);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001');
begin
  if (select fulfillment_status from public.orders where id = v_order_id) <> 'packing' then
    raise exception 'Owner Start Packing transition did not persist.';
  end if;
  if (
    select count(*) from public.order_fulfillment_events
    where order_id = v_order_id
      and from_status = 'ready_to_pack'
      and to_status = 'packing'
      and metadata ->> 'action' = 'start_packing'
  ) <> 1 then
    raise exception 'Start Packing did not create exactly one transition event.';
  end if;

  begin
    perform public.start_order_packing(v_order_id);
    raise exception 'Already-packing Order unexpectedly started again.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if;
  end;

  if (
    select count(*) from public.order_fulfillment_events
    where order_id = v_order_id
      and metadata ->> 'action' = 'start_packing'
  ) <> 1 then
    raise exception 'Duplicate Start Packing created another event.';
  end if;
end;
$$;

do $$
declare
  v_missing uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_other_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000009');
  v_no_items uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003');
  v_not_required uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004');
  v_packed uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005');
  v_shipped uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006');
  v_completed uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000007');
begin
  begin perform public.start_order_packing(v_missing); raise exception 'Missing Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
  begin perform public.start_order_packing(v_other_order); raise exception 'Cross-owner Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
  begin perform public.start_order_packing(v_no_items); raise exception 'Itemless Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Order has no required packing items.' then raise; end if; end;
  begin perform public.start_order_packing(v_not_required); raise exception 'No-packing Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Order has no required packing items.' then raise; end if; end;
  begin perform public.start_order_packing(v_packed); raise exception 'Packed Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if; end;
  begin perform public.start_order_packing(v_shipped); raise exception 'Shipped Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if; end;
  begin perform public.start_order_packing(v_completed); raise exception 'Completed Order unexpectedly started.';
  exception when raise_exception then if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if; end;
end;
$$;

-- Checklist is Order-scoped, Packing-only, packing-required-only, and idempotent.
do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001');
  v_item_id uuid := (select id from public.order_items where order_id = v_order_id);
  v_other_item_id uuid := (
    select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002'
  );
  v_checked_at timestamptz;
  v_event_count bigint := (select count(*) from public.order_fulfillment_events where order_id = v_order_id);
begin
  perform public.set_order_item_packed(v_order_id, v_item_id, true);
  select checked_at into v_checked_at from public.order_items where id = v_item_id;
  if v_checked_at is null or (select checked_by from public.order_items where id = v_item_id) <> auth.uid() then
    raise exception 'Checklist check did not set checked_at and checked_by.';
  end if;

  perform public.set_order_item_packed(v_order_id, v_item_id, true);
  if (select checked_at from public.order_items where id = v_item_id) is distinct from v_checked_at then
    raise exception 'Same-state checklist retry changed checked_at.';
  end if;

  begin
    perform public.set_order_item_packed(v_order_id, v_other_item_id, true);
    raise exception 'Same-owner item from another Order unexpectedly changed.';
  exception
    when raise_exception then
      if sqlerrm <> 'Order Item not found.' then raise; end if;
  end;

  perform public.set_order_item_packed(v_order_id, v_item_id, false);
  if exists (
    select 1 from public.order_items
    where id = v_item_id and (checked_at is not null or checked_by is not null)
  ) then
    raise exception 'Checklist uncheck did not clear checked_at and checked_by.';
  end if;

  perform public.set_order_item_packed(v_order_id, v_item_id, false);
  if (select count(*) from public.order_fulfillment_events where order_id = v_order_id) <> v_event_count then
    raise exception 'Checklist toggle created a fulfillment event.';
  end if;
end;
$$;

reset role;

-- Put the non-required fixture into Packing without using the hardened Start RPC.
update public.orders
set fulfillment_status = 'packing'
where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004';

select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
set local role authenticated;

do $$
declare
  v_ready_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002');
  v_ready_item uuid := (select id from public.order_items where order_id = v_ready_order);
  v_nonrequired_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004');
  v_nonrequired_item uuid := (select id from public.order_items where order_id = v_nonrequired_order);
  v_packed_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005');
  v_packed_item uuid := (select id from public.order_items where order_id = v_packed_order);
  v_shipped_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006');
  v_shipped_item uuid := (select id from public.order_items where order_id = v_shipped_order);
  v_completed_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000007');
  v_completed_item uuid := (select id from public.order_items where order_id = v_completed_order);
  v_other_order uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000009');
  v_other_item uuid := (select id from public.order_items where order_id = v_other_order);
begin
  begin perform public.set_order_item_packed(v_ready_order, v_ready_item, true); raise exception 'Ready Order checklist unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'Checklist changes require a Packing Order.' then raise; end if; end;
  begin perform public.set_order_item_packed(v_nonrequired_order, v_nonrequired_item, true); raise exception 'Non-required item unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'This Order Item does not require packing.' then raise; end if; end;
  begin perform public.set_order_item_packed(v_packed_order, v_packed_item, true); raise exception 'Packed Order checklist unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'Checklist changes require a Packing Order.' then raise; end if; end;
  begin perform public.set_order_item_packed(v_shipped_order, v_shipped_item, true); raise exception 'Shipped Order checklist unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'Checklist changes require a Packing Order.' then raise; end if; end;
  begin perform public.set_order_item_packed(v_completed_order, v_completed_item, true); raise exception 'Completed Order checklist unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'Checklist changes require a Packing Order.' then raise; end if; end;
  begin perform public.set_order_item_packed(v_other_order, v_other_item, true); raise exception 'Cross-owner checklist unexpectedly changed.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
end;
$$;

-- The unsafe overload is retained but inaccessible.
do $$
declare
  v_item_id uuid := (
    select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001'
  );
begin
  begin
    perform public.set_order_item_packed(v_item_id, true);
    raise exception 'Unsafe checklist overload unexpectedly remained executable.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- Anonymous execution is denied by grants before function bodies can run.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform public.start_order_packing('ffffffff-ffff-ffff-ffff-ffffffffffff');
    raise exception 'Anonymous Start Packing unexpectedly executed.';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.set_order_item_packed(
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      true
    );
    raise exception 'Anonymous checklist unexpectedly executed.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.start_order_packing(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_order_item_packed(uuid,uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.set_order_item_packed(uuid,boolean)', 'EXECUTE')
    or has_function_privilege('anon', 'public.start_order_packing(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_order_item_packed(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'Packing RPC role grants are incorrect.';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where p.oid in (
      'public.start_order_packing(uuid)'::regprocedure,
      'public.set_order_item_packed(uuid,boolean)'::regprocedure,
      'public.set_order_item_packed(uuid,uuid,boolean)'::regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC retains Packing RPC execution.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass)
    or has_table_privilege('authenticated', 'public.orders', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.order_items', 'INSERT,UPDATE,DELETE') then
    raise exception 'Order RLS or direct-write boundaries changed.';
  end if;
end;
$$;

-- Packing mutations did not change accounting, payment, inventory, or snapshots.
do $$
begin
  if exists (
    select 1
    from public.inventory_items
    where user_id = '31111111-1111-1111-1111-111111111111'
      and (status <> 'Sold' or price <> 100 + right(sku, 2)::integer)
  ) then
    raise exception 'Packing RPC changed Inventory state.';
  end if;
  if exists (
    select 1 from public.payment_requests
    where user_id = '31111111-1111-1111-1111-111111111111'
      and (status <> 'Paid' or total_amount <> item_price)
  ) then
    raise exception 'Packing RPC changed Payment Request state.';
  end if;
  if exists (
    select 1 from public.sales s
    join public.inventory_items i on i.id = s.inventory_item_id
    where i.user_id = '31111111-1111-1111-1111-111111111111'
      and s.sale_price <> i.price
  ) then
    raise exception 'Packing RPC changed Sale state.';
  end if;
  if exists (
    select 1 from public.orders
    where user_id = '31111111-1111-1111-1111-111111111111'
      and (customer_name not like 'Hardening Customer %' or total_paid_snapshot <> subtotal_snapshot)
  ) then
    raise exception 'Packing RPC changed Order customer or financial snapshots.';
  end if;
end;
$$;

select 'packing RPC hardening tests passed' as result;

rollback;
