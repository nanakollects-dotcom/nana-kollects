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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '22222222-2222-2222-2222-222222222222', 'NK-T03', 'Other User Item', 60, 140, 'Reserved', false);

insert into public.payment_requests (
  id, user_id, request_number, inventory_item_id, customer_name, customer_contact,
  shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
  courier, discount, total_amount, status
) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '11111111-1111-1111-1111-111111111111', 'PR-TEST-001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Customer One', '09170000001', 'Test Address', 'Test Item 1', 100, 10, 'fee_now', 'J&T', 5, 105, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '11111111-1111-1111-1111-111111111111', 'PR-TEST-002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Rollback Customer', '09170000002', 'Test Address', 'Rollback Item', 120, 0, 'fee_now', 'J&T', 0, 999, 'Pending'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '22222222-2222-2222-2222-222222222222', 'PR-TEST-003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Customer Two', '09170000003', 'Other Address', 'Other User Item', 140, 0, 'fee_now', 'J&T', 0, 140, 'Pending');

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

do $$
begin
  begin
    perform public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'GoTyme');
    raise exception 'Expected Order total constraint failure.';
  exception
    when check_violation then null;
  end;

  if (select status from public.payment_requests where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') <> 'Pending'
    or (select status from public.inventory_items where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2') <> 'Reserved'
    or exists (select 1 from public.sales where inventory_item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')
    or exists (select 1 from public.orders where source_payment_request_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') then
    raise exception 'Failed finalization did not roll back completely.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select public.mark_payment_request_paid('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'GCash');
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

do $$
begin
  if (select count(*) from public.orders) <> 1
    or (select count(*) from public.order_items) <> 1
    or (select count(*) from public.order_fulfillment_events) <> 1 then
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
