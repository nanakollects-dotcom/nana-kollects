\set ON_ERROR_STOP on

begin;

insert into auth.users(id) values
  ('71111111-1111-4111-8111-111111111111'),
  ('72222222-2222-4222-8222-222222222222');

insert into public.collections(id, user_id, name) values
  ('7c111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', 'Multi A'),
  ('7c222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111', 'Multi B'),
  ('7c999999-9999-4999-8999-999999999999', '72222222-2222-4222-8222-222222222222', 'Other Owner');

insert into public.inventory_items (
  id, user_id, collection_id, sku, name, cost, price, status
) values
  ('7a111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '7c111111-1111-4111-8111-111111111111', 'M-001', 'Multi One', 60, 100, 'Available'),
  ('7a222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111', '7c222222-2222-4222-8222-222222222222', 'M-002', 'Multi Two', 90, 150, 'Available'),
  ('7a333333-3333-4333-8333-333333333333', '71111111-1111-4111-8111-111111111111', '7c111111-1111-4111-8111-111111111111', 'M-003', 'Cancel One', 40, 75, 'Available'),
  ('7a444444-4444-4444-8444-444444444444', '71111111-1111-4111-8111-111111111111', '7c222222-2222-4222-8222-222222222222', 'M-004', 'Cancel Two', 50, 85, 'Available'),
  ('7a555555-5555-4555-8555-555555555555', '71111111-1111-4111-8111-111111111111', '7c111111-1111-4111-8111-111111111111', 'M-005', 'Failure One', 35, 65, 'Available'),
  ('7a666666-6666-4666-8666-666666666666', '71111111-1111-4111-8111-111111111111', '7c222222-2222-4222-8222-222222222222', 'M-006', 'Failure Two', 45, 95, 'Available'),
  ('7a777777-7777-4777-8777-777777777777', '71111111-1111-4111-8111-111111111111', '7c111111-1111-4111-8111-111111111111', 'M-007', 'Single Item', 20, 55, 'Available'),
  ('7a888888-8888-4888-8888-888888888888', '71111111-1111-4111-8111-111111111111', '7c222222-2222-4222-8222-222222222222', 'M-008', 'Legacy Cancel', 25, 60, 'Available'),
  ('7a999999-9999-4999-8999-999999999999', '72222222-2222-4222-8222-222222222222', '7c999999-9999-4999-8999-999999999999', 'X-001', 'Other Owner Item', 10, 20, 'Available');

insert into public.inventory_items (
  id, user_id, collection_id, sku, name, cost, price, status
)
select
  gen_random_uuid(),
  '71111111-1111-4111-8111-111111111111',
  case when number % 2 = 0 then '7c111111-1111-4111-8111-111111111111'::uuid else '7c222222-2222-4222-8222-222222222222'::uuid end,
  'MAX-' || lpad(number::text, 3, '0'),
  'Maximum Item ' || number,
  number,
  number + 10,
  'Available'
from generate_series(1, 51) number;

-- Plain PostgreSQL does not provide Supabase's default authenticated read grants.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.payment_requests to authenticated;
grant update on public.inventory_items to authenticated;

select set_config('request.jwt.claim.sub', '71111111-1111-4111-8111-111111111111', true);
set local role authenticated;

-- Empty, malformed, duplicate, cross-owner, and oversized selections fail safely.
do $$
begin
  begin
    perform public.create_payment_request_v2(
      '[]'::jsonb, 'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Empty selection unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Empty selection unexpectedly succeeded.' then raise; end if;
  end;

  begin
    perform public.create_payment_request_v2(
      '{}'::jsonb, 'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Malformed selection unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Malformed selection unexpectedly succeeded.' then raise; end if;
  end;

  begin
    perform public.create_payment_request_v2(
      '[{"inventory_item_id":"not-an-id","unit_price":10}]'::jsonb,
      'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Invalid identifier unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Invalid identifier unexpectedly succeeded.' then raise; end if;
  end;

  begin
    perform public.create_payment_request_v2(
      '[{"inventory_item_id":"7a777777-7777-4777-8777-777777777777","unit_price":-1}]'::jsonb,
      'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Negative price unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Negative price unexpectedly succeeded.' then raise; end if;
  end;

  begin
    perform public.create_payment_request_v2(
      '[{"inventory_item_id":"7a777777-7777-4777-8777-777777777777","unit_price":55},{"inventory_item_id":"7a777777-7777-4777-8777-777777777777","unit_price":55}]'::jsonb,
      'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Duplicate selection unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Duplicate selection unexpectedly succeeded.' then raise; end if;
  end;

  begin
    perform public.create_payment_request_v2(
      '[{"inventory_item_id":"7a999999-9999-4999-8999-999999999999","unit_price":20}]'::jsonb,
      'Customer', '09170000000', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Cross-owner selection unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Cross-owner selection unexpectedly succeeded.' then raise; end if;
  end;
end;
$$;

-- One-item compatibility through the versioned foundation.
select set_config(
  'test.single_request',
  (
    public.create_payment_request_v2(
      '[{"inventory_item_id":"7a777777-7777-4777-8777-777777777777","unit_price":55}]'::jsonb,
      'Single Customer', '09170000001', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    ) -> 'payment_request' ->> 'id'
  ),
  true
);

do $$
begin
  if (select count(*) from public.payment_request_items where payment_request_id = current_setting('test.single_request')::uuid) <> 1
    or (select count(*) from public.inventory_reservations where payment_request_id = current_setting('test.single_request')::uuid) <> 1
    or (select status from public.inventory_items where id = '7a777777-7777-4777-8777-777777777777') <> 'Reserved' then
    raise exception 'One-item creation did not persist atomically.';
  end if;
end;
$$;

select public.cancel_multi_item_payment_request_v1(current_setting('test.single_request')::uuid);
select public.cancel_multi_item_payment_request_v1(current_setting('test.single_request')::uuid);

do $$
begin
  if (select status from public.inventory_items where id = '7a777777-7777-4777-8777-777777777777') <> 'Available'
    or exists (select 1 from public.inventory_reservations where payment_request_id = current_setting('test.single_request')::uuid)
    or (select status from public.payment_requests where id = current_setting('test.single_request')::uuid) <> 'Cancelled' then
    raise exception 'One-item cancellation did not release atomically.';
  end if;
end;
$$;

-- Untouched legacy single-item RPCs remain functional with additive columns.
select set_config(
  'test.legacy_paid_request',
  (
    public.create_payment_request(
      '7a777777-7777-4777-8777-777777777777', 'Legacy Paid Customer',
      '09170000007', '', 55, 0, 'pickup', '', 0, current_date + 1, '', '{}'::jsonb
    )
  ).id::text,
  true
);
select public.mark_payment_request_paid(current_setting('test.legacy_paid_request')::uuid, 'GCash');

select set_config(
  'test.legacy_cancel_request',
  (
    public.create_payment_request(
      '7a888888-8888-4888-8888-888888888888', 'Legacy Cancel Customer',
      '09170000008', '', 60, 0, 'pickup', '', 0, current_date + 1, '', '{}'::jsonb
    )
  ).id::text,
  true
);
select public.cancel_payment_request(current_setting('test.legacy_cancel_request')::uuid);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = current_setting('test.legacy_paid_request')::uuid);
begin
  if (select status from public.payment_requests where id = current_setting('test.legacy_paid_request')::uuid) <> 'Paid'
    or (select count(*) from public.sales where inventory_item_id = '7a777777-7777-4777-8777-777777777777') <> 1
    or (select count(*) from public.order_items where order_id = v_order_id and line_total_snapshot = selling_price_snapshot) <> 1
    or exists (
      select 1 from public.sales
      where inventory_item_id = '7a777777-7777-4777-8777-777777777777'
        and (merchandise_subtotal_snapshot is null or total_paid_snapshot is null or sale_timestamp is null)
    ) then raise exception 'Legacy single-item finalization compatibility failed.'; end if;
  if (select status from public.payment_requests where id = current_setting('test.legacy_cancel_request')::uuid) <> 'Cancelled'
    or (select status from public.inventory_items where id = '7a888888-8888-4888-8888-888888888888') <> 'Available' then
    raise exception 'Legacy single-item cancellation compatibility failed.';
  end if;
end;
$$;

-- Two-item, multiple-collection finalization.
select set_config(
  'test.paid_request',
  (
    public.create_payment_request_v2(
      '[{"inventory_item_id":"7a111111-1111-4111-8111-111111111111","unit_price":100},{"inventory_item_id":"7a222222-2222-4222-8222-222222222222","unit_price":150}]'::jsonb,
      'Paid Customer', '09170000002', 'Safe Address', 25, 'fee_now', 'J&T', 25,
      current_date + 1, '', '{}'::jsonb
    ) -> 'payment_request' ->> 'id'
  ),
  true
);

select public.mark_multi_item_payment_request_paid_v1(current_setting('test.paid_request')::uuid, 'GCash');
select public.mark_multi_item_payment_request_paid_v1(current_setting('test.paid_request')::uuid, 'GCash');

do $$
declare
  v_sale_id uuid := (select id from public.sales where source_payment_request_id = current_setting('test.paid_request')::uuid);
  v_order_id uuid := (select id from public.orders where source_payment_request_id = current_setting('test.paid_request')::uuid);
begin
  if (select count(*) from public.sales where source_payment_request_id = current_setting('test.paid_request')::uuid) <> 1
    or (select count(*) from public.sale_items where sale_id = v_sale_id) <> 2
    or (select count(*) from public.orders where source_payment_request_id = current_setting('test.paid_request')::uuid) <> 1
    or (select count(*) from public.order_items where order_id = v_order_id) <> 2
    or (select count(*) from public.order_fulfillment_events where order_id = v_order_id and from_status is null and to_status = 'ready_to_pack') <> 1 then
    raise exception 'Paid transaction graph count mismatch.';
  end if;
  if (select sum(allocated_discount_snapshot) from public.sale_items where sale_id = v_sale_id) <> 25
    or (select sum(net_item_revenue_snapshot) from public.sale_items where sale_id = v_sale_id) <> 225
    or (select aggregate_cogs_snapshot from public.sales where id = v_sale_id) <> 150
    or (select aggregate_profit_snapshot from public.sales where id = v_sale_id) <> 75
    or (select shipping_fee_snapshot from public.sales where id = v_sale_id) <> 25
    or (select total_paid_snapshot from public.sales where id = v_sale_id) <> 250 then
    raise exception 'Paid transaction financial snapshots do not reconcile.';
  end if;
  if exists (
    select 1 from public.inventory_items
    where id in ('7a111111-1111-4111-8111-111111111111', '7a222222-2222-4222-8222-222222222222')
      and (status <> 'Sold' or payment_status <> 'Paid')
  ) or exists (
    select 1 from public.inventory_reservations where payment_request_id = current_setting('test.paid_request')::uuid
  ) then raise exception 'Paid Inventory or reservation state is incorrect.'; end if;
end;
$$;

-- Existing Order lifecycle works with multiple Order Items.
select public.start_order_packing((select id from public.orders where source_payment_request_id = current_setting('test.paid_request')::uuid));
select public.set_order_item_packed(o.id, oi.id, true)
from public.orders o
join public.order_items oi on oi.order_id = o.id
where o.source_payment_request_id = current_setting('test.paid_request')::uuid
order by oi.id;
select public.mark_order_packed((select id from public.orders where source_payment_request_id = current_setting('test.paid_request')::uuid));

-- Multi-item cancellation releases every item and creates no financial graph.
select set_config(
  'test.cancel_request',
  (
    public.create_payment_request_v2(
      '[{"inventory_item_id":"7a333333-3333-4333-8333-333333333333","unit_price":75},{"inventory_item_id":"7a444444-4444-4444-8444-444444444444","unit_price":85}]'::jsonb,
      'Cancel Customer', '09170000003', '', 0, 'pickup', '', 10,
      current_date + 1, '', '{}'::jsonb
    ) -> 'payment_request' ->> 'id'
  ),
  true
);
select public.cancel_multi_item_payment_request_v1(current_setting('test.cancel_request')::uuid);
select public.cancel_multi_item_payment_request_v1(current_setting('test.cancel_request')::uuid);

do $$
begin
  if exists (
    select 1 from public.inventory_items
    where id in ('7a333333-3333-4333-8333-333333333333', '7a444444-4444-4444-8444-444444444444')
      and status <> 'Available'
  ) or exists (select 1 from public.sales where source_payment_request_id = current_setting('test.cancel_request')::uuid)
    or exists (select 1 from public.orders where source_payment_request_id = current_setting('test.cancel_request')::uuid) then
    raise exception 'Cancellation created financial history or left an item reserved.';
  end if;
end;
$$;

-- Fifty items succeeds; fifty-one fails without reserving anything.
select set_config(
  'test.max_request',
  (
    public.create_payment_request_v2(
      (
        select jsonb_agg(jsonb_build_object('inventory_item_id', id, 'unit_price', price) order by sku)
        from (select id, price, sku from public.inventory_items where sku like 'MAX-%' order by sku limit 50) chosen
      ),
      'Maximum Customer', '09170000004', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    ) -> 'payment_request' ->> 'id'
  ),
  true
);

do $$
begin
  if (select count(*) from public.payment_request_items where payment_request_id = current_setting('test.max_request')::uuid) <> 50
    or (select count(*) from public.inventory_reservations where payment_request_id = current_setting('test.max_request')::uuid) <> 50 then
    raise exception 'Fifty-item request count mismatch.';
  end if;
end;
$$;
select public.cancel_multi_item_payment_request_v1(current_setting('test.max_request')::uuid);

do $$
begin
  begin
    perform public.create_payment_request_v2(
      (
        select jsonb_agg(jsonb_build_object('inventory_item_id', id, 'unit_price', price) order by sku)
        from public.inventory_items where sku like 'MAX-%'
      ),
      'Too Many', '09170000005', '', 0, 'pickup', '', 0,
      current_date + 1, '', '{}'::jsonb
    );
    raise exception 'Fifty-one-item request unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Fifty-one-item request unexpectedly succeeded.' then raise; end if;
  end;
  if exists (select 1 from public.inventory_items where sku like 'MAX-%' and status <> 'Available') then
    raise exception 'Oversized request changed Inventory.';
  end if;
end;
$$;

-- Failure injection at every finalization write stage proves atomic rollback.
reset role;
create function public.sprint17b_fail_finalization_stage() returns trigger language plpgsql as $$
begin
  if current_setting('test.sprint17b_failure_stage', true) = tg_table_name || ':' || tg_op then
    raise exception 'Injected finalization write failure.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger sprint17b_fail_sale_header before insert on public.sales
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_sale_items before insert on public.sale_items
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_inventory_update before update on public.inventory_items
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_request_update before update on public.payment_requests
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_order_header before insert on public.orders
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_order_items before insert on public.order_items
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_order_event before insert on public.order_fulfillment_events
for each row execute function public.sprint17b_fail_finalization_stage();
create trigger sprint17b_fail_reservation_delete before delete on public.inventory_reservations
for each row execute function public.sprint17b_fail_finalization_stage();

do $$
declare
  v_stage text;
  v_number integer := 0;
  v_item_a uuid;
  v_item_b uuid;
  v_request_id uuid;
begin
  foreach v_stage in array array[
    'sales:INSERT', 'sale_items:INSERT', 'inventory_items:UPDATE',
    'payment_requests:UPDATE', 'orders:INSERT', 'order_items:INSERT',
    'order_fulfillment_events:INSERT', 'inventory_reservations:DELETE'
  ] loop
    v_number := v_number + 1;
    v_item_a := gen_random_uuid();
    v_item_b := gen_random_uuid();

    insert into public.inventory_items (
      id, user_id, collection_id, sku, name, cost, price, status
    ) values
      (v_item_a, '71111111-1111-4111-8111-111111111111', '7c111111-1111-4111-8111-111111111111',
       'FAIL-' || v_number || '-A', 'Failure stage A', 10, 20, 'Available'),
      (v_item_b, '71111111-1111-4111-8111-111111111111', '7c222222-2222-4222-8222-222222222222',
       'FAIL-' || v_number || '-B', 'Failure stage B', 15, 30, 'Available');

    v_request_id := (
      public.create_payment_request_v2(
        jsonb_build_array(
          jsonb_build_object('inventory_item_id', v_item_a, 'unit_price', 20),
          jsonb_build_object('inventory_item_id', v_item_b, 'unit_price', 30)
        ),
        'Failure Customer', '09170000006', '', 0, 'pickup', '', 0,
        current_date + 1, '', '{}'::jsonb
      ) -> 'payment_request' ->> 'id'
    )::uuid;

    if v_number = 1 then
      perform set_config('test.failure_request', v_request_id::text, true);
    end if;
    perform set_config('test.sprint17b_failure_stage', v_stage, true);
    begin
      perform public.mark_multi_item_payment_request_paid_v1(v_request_id, 'GoTyme');
      raise exception 'Injected finalization unexpectedly succeeded at %.', v_stage;
    exception when others then
      if sqlerrm like 'Injected finalization unexpectedly succeeded at %' then raise; end if;
    end;
    perform set_config('test.sprint17b_failure_stage', '', true);

    if (select status from public.payment_requests where id = v_request_id) <> 'Pending'
      or exists (select 1 from public.sales where source_payment_request_id = v_request_id)
      or exists (select 1 from public.orders where source_payment_request_id = v_request_id)
      or (select count(*) from public.inventory_items where id in (v_item_a, v_item_b) and status = 'Reserved') <> 2
      or (select count(*) from public.inventory_reservations where payment_request_id = v_request_id) <> 2 then
      raise exception 'Injected failure at % did not roll back completely.', v_stage;
    end if;
  end loop;
end;
$$;

drop trigger sprint17b_fail_sale_header on public.sales;
drop trigger sprint17b_fail_sale_items on public.sale_items;
drop trigger sprint17b_fail_inventory_update on public.inventory_items;
drop trigger sprint17b_fail_request_update on public.payment_requests;
drop trigger sprint17b_fail_order_header on public.orders;
drop trigger sprint17b_fail_order_items on public.order_items;
drop trigger sprint17b_fail_order_event on public.order_fulfillment_events;
drop trigger sprint17b_fail_reservation_delete on public.inventory_reservations;
drop function public.sprint17b_fail_finalization_stage();

-- Immutable snapshots block changes; manual Sale semantics remain available.
do $$
declare
  v_sale_id uuid := (select id from public.sales where source_payment_request_id = current_setting('test.paid_request')::uuid);
begin
  begin
    update public.sale_items set unit_price_snapshot = unit_price_snapshot + 1 where sale_id = v_sale_id;
    raise exception 'Sale Item snapshot update unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Sale Item snapshot update unexpectedly succeeded.' then raise; end if;
  end;
  begin
    delete from public.sales where id = v_sale_id;
    raise exception 'Paid Sale deletion unexpectedly succeeded.';
  exception when others then
    if sqlerrm = 'Paid Sale deletion unexpectedly succeeded.' then raise; end if;
  end;
end;
$$;

-- RLS ownership and direct-write grants.
set local role authenticated;
do $$
begin
  begin
    insert into public.payment_request_items (
      user_id, payment_request_id, inventory_item_id, sku_snapshot,
      item_name_snapshot, unit_price_snapshot, line_total_snapshot
    ) values (
      '71111111-1111-4111-8111-111111111111', current_setting('test.failure_request')::uuid,
      '7a777777-7777-4777-8777-777777777777', 'M-007', 'Single Item', 55, 55
    );
    raise exception 'Direct child insert unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '72222222-2222-4222-8222-222222222222', true);
do $$
begin
  if exists (select 1 from public.payment_request_items where user_id = '71111111-1111-4111-8111-111111111111')
    or exists (select 1 from public.sale_items where user_id = '71111111-1111-4111-8111-111111111111')
    or exists (select 1 from public.inventory_reservations where user_id = '71111111-1111-4111-8111-111111111111') then
    raise exception 'Cross-owner RLS read unexpectedly succeeded.';
  end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.cancel_multi_item_payment_request_v1(current_setting('test.failure_request')::uuid);
    raise exception 'Anonymous RPC execution unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
