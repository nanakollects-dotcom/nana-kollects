\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into public.inventory_items (
  id, user_id, sku, name, cost, price, status, locked
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'NK-T01', 'Test Item 1', 40, 100, 'Reserved', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'NK-T02', 'Rollback Item', 50, 120, 'Reserved', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '22222222-2222-2222-2222-222222222222', 'NK-T03', 'Other User Item', 60, 140, 'Reserved', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', '11111111-1111-1111-1111-111111111111', 'NK-T04', 'Pickup Item', 70, 160, 'Reserved', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', '11111111-1111-1111-1111-111111111111', 'NK-T05', 'Failure Item', 80, 180, 'Reserved', false);

insert into public.payment_requests (
  id, user_id, request_number, inventory_item_id, customer_name, customer_contact,
  shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
  courier, discount, total_amount, status
) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '11111111-1111-1111-1111-111111111111', 'PR-TEST-001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Customer One', '09170000001', 'Test Address', 'Test Item 1', 100, 10, 'fee_now', 'J&T', 5, 105, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '11111111-1111-1111-1111-111111111111', 'PR-TEST-002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Rollback Customer', '09170000002', 'Test Address', 'Rollback Item', 120, 0, 'fee_now', 'J&T', 0, 120, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '22222222-2222-2222-2222-222222222222', 'PR-TEST-003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Customer Two', '09170000003', 'Other Address', 'Other User Item', 140, 0, 'fee_now', 'J&T', 0, 140, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', '11111111-1111-1111-1111-111111111111', 'PR-TEST-004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'Pickup Customer', '09170000004', null, 'Pickup Item', 160, 0, 'pickup', null, 0, 160, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', '11111111-1111-1111-1111-111111111111', 'PR-TEST-005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'Failure Customer', '09170000005', 'Failure Address', 'Failure Item', 180, 0, 'fee_now', 'J&T', 0, 180, 'Pending');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'GCash');
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'GCash');
reset role;

do $$
begin
  if (select status from public.payment_requests where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'Paid' then
    raise exception 'Payment Request was not marked Paid.';
  end if;
  if (select status from public.inventory_items where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') <> 'Sold' then
    raise exception 'Inventory was not marked Sold.';
  end if;
  if (select count(*) from public.sales where inventory_item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') <> 1 then
    raise exception 'Sale creation was not idempotent.';
  end if;
  if (select count(*) from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 1 then
    raise exception 'Order creation was not idempotent.';
  end if;
  if (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 1 then
    raise exception 'Order Item creation was not idempotent.';
  end if;
  if (select count(*) from public.order_fulfillment_events e join public.orders o on o.id = e.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1' and e.from_status is null and e.to_status = 'ready_to_pack') <> 1 then
    raise exception 'Initial fulfillment event creation was not idempotent.';
  end if;

  begin
    update public.orders
    set subtotal_snapshot = subtotal_snapshot + 1
    where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
    raise exception 'Order financial snapshot update unexpectedly succeeded.';
  exception
    when raise_exception then
      if sqlerrm <> 'Order source and financial snapshots are immutable.' then
        raise;
      end if;
  end;

  begin
    update public.order_items
    set selling_price_snapshot = selling_price_snapshot + 1
    where order_id = (
      select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
    );
    raise exception 'Order Item financial snapshot update unexpectedly succeeded.';
  exception
    when raise_exception then
      if sqlerrm <> 'Order Item source and financial snapshots are immutable.' then
        raise;
      end if;
  end;
end;
$$;

create or replace function public.fail_test_sale_insert()
returns trigger
language plpgsql
as $$
begin
  if new.inventory_item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2' then
    raise exception 'Injected Sale creation failure.';
  end if;
  return new;
end;
$$;

create trigger fail_test_sale_insert
before insert on public.sales
for each row execute function public.fail_test_sale_insert();

do $$
begin
  begin
    perform public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'GoTyme');
    raise exception 'Expected injected Sale creation failure.';
  exception
    when raise_exception then
      if sqlerrm <> 'Injected Sale creation failure.' then raise; end if;
  end;

  if (select status from public.payment_requests where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') <> 'Pending'
    or (select status from public.inventory_items where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2') <> 'Reserved'
    or exists (select 1 from public.sales where inventory_item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')
    or exists (select 1 from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') then
    raise exception 'Failed finalization did not roll back completely.';
  end if;
end;
$$;

drop trigger fail_test_sale_insert on public.sales;
drop function public.fail_test_sale_insert();

set local role authenticated;
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 'GCash');
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', 'GoTyme');
reset role;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'GCash');
reset role;

select set_config(
  'test.other_order_id',
  (select id::text from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3'),
  true
);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

select public.start_order_packing(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
);

do $$
begin
  begin
    perform public.start_order_packing(
      (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
    );
    raise exception 'Already-packing Order unexpectedly started again.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_packed(v_order_id);
    raise exception 'Packed unexpectedly succeeded with an incomplete checklist.';
  exception
    when raise_exception then
      if sqlerrm <> 'Check every required Order Item before marking Packed.' then raise; end if;
  end;
end;
$$;

select public.set_order_item_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  true
);

do $$
begin
  if (select fulfillment_status from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'packing' then
    raise exception 'Checking the final item incorrectly marked the Order Packed.';
  end if;
  if not exists (
    select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
      and oi.checked_at is not null and oi.checked_by = '11111111-1111-1111-1111-111111111111'
  ) then
    raise exception 'Checklist state did not persist.';
  end if;
end;
$$;

select public.set_order_item_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  true
);
select public.set_order_item_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  false
);

do $$
begin
  if (select fulfillment_status from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'packing' then
    raise exception 'Checklist mutation unexpectedly changed the Order lifecycle status.';
  end if;
end;
$$;

select public.set_order_item_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  true
);
select public.mark_order_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
);
do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_packed(v_order_id);
    raise exception 'Packed Order unexpectedly transitioned again.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Packing Orders can be marked Packed.' then raise; end if;
  end;
end;
$$;
select public.reopen_order_packing(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
);
select public.reopen_order_packing(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
);

do $$
begin
  if (select fulfillment_status from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'packing'
    or (select packed_at from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') is not null
    or not exists (
      select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
      where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1' and oi.checked_at is not null
    ) then
    raise exception 'Reopen Packing did not preserve the checklist and clear Packed state.';
  end if;
end;
$$;

select public.mark_order_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_completed(v_order_id, now(), 'Too early');
    raise exception 'Shipment completed before Shipped.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if;
  end;
end;
$$;

reset role;
update public.order_items
set checked_at = null, checked_by = null
where order_id = (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_shipped(v_order_id, 'J&T', 'TRACK-001', null, now(), null);
    raise exception 'Shipping unexpectedly ignored an incomplete checklist.';
  exception
    when raise_exception then
      if sqlerrm <> 'Every required Order Item must be checked before shipping.' then raise; end if;
  end;
end;
$$;

reset role;
update public.order_items
set checked_at = now(), checked_by = user_id
where order_id = (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_shipped(v_order_id, '', 'TRACK-001', null, now(), null);
    raise exception 'Shipping unexpectedly accepted a blank courier.';
  exception
    when raise_exception then
      if sqlerrm <> 'Courier is required before shipping.' then raise; end if;
  end;

  begin
    perform public.mark_order_shipped(v_order_id, 'J&T', '', '', now(), null);
    raise exception 'Shipping unexpectedly accepted blank tracking information.';
  exception
    when raise_exception then
      if sqlerrm <> 'Tracking number is required before shipping.' then raise; end if;
  end;

  begin
    perform public.mark_order_shipped(v_order_id, 'J&T', '', 'No tracking', now(), null);
    raise exception 'Shipping unexpectedly accepted a no-tracking path.';
  exception
    when raise_exception then
      if sqlerrm <> 'Tracking number is required before shipping.' then raise; end if;
  end;
end;
$$;

select public.mark_order_shipped(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  'J&T', 'TRACK-001', null, now(), 'Handled with care'
);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_shipped(v_order_id, 'J&T', 'TRACK-001', null, now(), 'Handled with care');
    raise exception 'Shipped Order unexpectedly transitioned again.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.reopen_order_packing(v_order_id);
    raise exception 'Shipped Order unexpectedly reopened.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Packed Orders can be reopened for packing.' then raise; end if;
  end;
end;
$$;

select public.mark_order_completed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  now(), 'Delivered'
);
do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
begin
  begin
    perform public.mark_order_completed(v_order_id, now(), 'Delivered');
    raise exception 'Completed Order unexpectedly transitioned again.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
  v_item_id uuid := (
    select oi.id from public.order_items oi where oi.order_id = v_order_id
  );
begin
  begin
    perform public.set_order_item_packed(v_order_id, v_item_id, false);
    raise exception 'Completed Order checklist unexpectedly changed.';
  exception
    when raise_exception then
      if sqlerrm not like 'Checklist changes require%' then raise; end if;
  end;
  begin
    perform public.start_order_packing(v_order_id);
    raise exception 'Completed Order unexpectedly restarted packing.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Ready to Pack Orders can start packing.' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_pickup_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4');
begin
  begin
    perform public.mark_order_packed(v_pickup_order_id);
    raise exception 'Pickup skipped directly to Packed.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Packing Orders can be marked Packed.' then raise; end if;
  end;
  begin
    perform public.mark_order_completed(v_pickup_order_id, now(), null);
    raise exception 'Pickup completed before Packed.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if;
  end;
end;
$$;

select public.start_order_packing(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4')
);
select public.set_order_item_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4'),
  (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4'),
  true
);
select public.mark_order_packed(
  (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4')
);

do $$
declare
  v_pickup_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4');
begin
  begin
    perform public.mark_order_shipped(v_pickup_order_id, 'Pickup', null, 'Pickup', now(), null);
    raise exception 'Pickup Order was falsely marked Shipped.';
  exception
    when raise_exception then
      if sqlerrm <> 'Pickup Orders cannot be marked Shipped.' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_pickup_order_id uuid := (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4');
begin
  begin
    perform public.mark_order_completed(v_pickup_order_id, now(), 'Customer handoff');
    raise exception 'Packed Pickup Order unexpectedly completed through the shipment flow.';
  exception
    when raise_exception then
      if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.start_order_packing(current_setting('test.other_order_id')::uuid);
    raise exception 'Cross-user lifecycle mutation unexpectedly succeeded.';
  exception
    when raise_exception then
      if sqlerrm <> 'Order not found.' then raise; end if;
  end;
end;
$$;

reset role;

create or replace function public.fail_test_fulfillment_event()
returns trigger
language plpgsql
as $$
begin
  if new.order_id = (
    select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5'
  ) and new.metadata ->> 'action' = 'start_packing' then
    raise exception 'Injected fulfillment event failure.';
  end if;
  return new;
end;
$$;

create trigger fail_test_fulfillment_event
before insert on public.order_fulfillment_events
for each row execute function public.fail_test_fulfillment_event();

set local role authenticated;
do $$
begin
  begin
    perform public.start_order_packing(
      (select id from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5')
    );
    raise exception 'Injected failure unexpectedly succeeded.';
  exception
    when raise_exception then
      if sqlerrm <> 'Injected fulfillment event failure.' then raise; end if;
  end;
end;
$$;
reset role;

drop trigger fail_test_fulfillment_event on public.order_fulfillment_events;
drop function public.fail_test_fulfillment_event();

do $$
begin
  if (select fulfillment_status from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5') <> 'ready_to_pack'
    or (select count(*) from public.order_fulfillment_events e join public.orders o on o.id = e.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5') <> 1 then
    raise exception 'Injected event failure did not roll back status and event atomically.';
  end if;
  if (select count(*) from public.order_fulfillment_events e join public.orders o on o.id = e.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 7 then
    raise exception 'Shipment transition retries wrote an unexpected number of events.';
  end if;
  if (select count(*) from public.order_fulfillment_events e join public.orders o on o.id = e.order_id where o.source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4') <> 3 then
    raise exception 'Pickup transitions wrote an unexpected number of events.';
  end if;
  if (select status from public.inventory_items where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') <> 'Sold'
    or (select price from public.inventory_items where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') <> 100
    or (select sale_price from public.sales where inventory_item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1') <> 100
    or (select total_amount from public.payment_requests where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 105 then
    raise exception 'Fulfillment lifecycle changed stock, payment, or accounting authority.';
  end if;
  if has_function_privilege('anon', 'public.start_order_packing(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_order_item_packed(uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.set_order_item_packed(uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_order_item_packed(uuid,uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.mark_order_packed(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.mark_order_completed(uuid,timestamp with time zone,text)', 'EXECUTE') then
    raise exception 'Lifecycle RPC execution grants are incorrect.';
  end if;
end;
$$;

set local role authenticated;

do $$
begin
  if (select count(*) from public.orders) <> 3
    or (select count(*) from public.order_items) <> 3
    or (select count(*) from public.order_fulfillment_events) <> 11 then
    raise exception 'RLS exposed another user''s Order domain rows.';
  end if;

  begin
    insert into public.orders (
      user_id, order_number, source_payment_request_id, customer_name, customer_contact,
      fulfillment_method, subtotal_snapshot, total_paid_snapshot, payment_confirmed_at
    ) values (
      '11111111-1111-1111-1111-111111111111', 'ORD-DIRECT-WRITE',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Blocked', '09170000000',
      'shipment', 1, 1, now()
    );
    raise exception 'Direct Order insert unexpectedly succeeded.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.orders set shipping_note = 'Blocked direct update';
    raise exception 'Direct Order update unexpectedly succeeded.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.orders;
    raise exception 'Direct Order delete unexpectedly succeeded.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select 'orders phase 1 tests passed' as result;
rollback;
