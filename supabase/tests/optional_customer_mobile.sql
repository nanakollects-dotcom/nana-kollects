\set ON_ERROR_STOP on

begin;

insert into auth.users(id) values
  ('73111111-1111-4111-8111-111111111111');

insert into public.collections(id, user_id, name) values
  ('7d111111-1111-4111-8111-111111111111', '73111111-1111-4111-8111-111111111111', 'Optional Contact');

insert into public.inventory_items (
  id, user_id, collection_id, sku, name, cost, price, status
) values
  ('7b111111-1111-4111-8111-111111111111', '73111111-1111-4111-8111-111111111111', '7d111111-1111-4111-8111-111111111111', 'OC-001', 'Legacy Blank', 40, 75, 'Available'),
  ('7b222222-2222-4222-8222-222222222222', '73111111-1111-4111-8111-111111111111', '7d111111-1111-4111-8111-111111111111', 'OC-002', 'Legacy Contact', 45, 80, 'Available'),
  ('7b333333-3333-4333-8333-333333333333', '73111111-1111-4111-8111-111111111111', '7d111111-1111-4111-8111-111111111111', 'OC-003', 'Multi Blank One', 50, 100, 'Available'),
  ('7b444444-4444-4444-8444-444444444444', '73111111-1111-4111-8111-111111111111', '7d111111-1111-4111-8111-111111111111', 'OC-004', 'Multi Blank Two', 60, 125, 'Available');

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.payment_requests to authenticated;
grant update on public.inventory_items to authenticated;

select set_config('request.jwt.claim.sub', '73111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
declare
  v_legacy_blank public.payment_requests%rowtype;
  v_legacy_contact public.payment_requests%rowtype;
  v_multi jsonb;
  v_request_id uuid;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
begin
  select * into v_legacy_blank
  from public.create_payment_request(
    '7b111111-1111-4111-8111-111111111111',
    'Legacy Blank Customer',
    null,
    null,
    75,
    0,
    'pickup',
    null,
    0,
    current_date + 1,
    null,
    '{}'::jsonb
  );

  if v_legacy_blank.customer_contact is not null then
    raise exception 'Legacy blank contact was not stored as null.';
  end if;

  perform public.cancel_payment_request(v_legacy_blank.id);
  if (select status from public.inventory_items where id = '7b111111-1111-4111-8111-111111111111') <> 'Available' then
    raise exception 'Legacy cancellation did not release the blank-contact item.';
  end if;

  select * into v_legacy_contact
  from public.create_payment_request(
    '7b222222-2222-4222-8222-222222222222',
    'Legacy Contact Customer',
    '09171234567',
    null,
    80,
    0,
    'pickup',
    null,
    0,
    current_date + 1,
    null,
    '{}'::jsonb
  );

  if v_legacy_contact.customer_contact <> '09171234567' then
    raise exception 'Existing mobile contact was changed.';
  end if;
  perform public.cancel_payment_request(v_legacy_contact.id);

  v_multi := public.create_payment_request_v2(
    '[
      {"inventory_item_id":"7b333333-3333-4333-8333-333333333333","unit_price":100},
      {"inventory_item_id":"7b444444-4444-4444-8444-444444444444","unit_price":125}
    ]'::jsonb,
    'Multi Blank Customer',
    '',
    'Controlled shipping address',
    25,
    'fee_now',
    'J&T',
    0,
    current_date + 1,
    null,
    '{}'::jsonb
  );
  v_request_id := (v_multi -> 'payment_request' ->> 'id')::uuid;

  if (select customer_contact from public.payment_requests where id = v_request_id) is not null then
    raise exception 'Multi-item blank contact was not stored as null.';
  end if;

  perform public.mark_multi_item_payment_request_paid_v1(v_request_id, 'GCash');

  if (select count(*) from public.sales where source_payment_request_id = v_request_id) <> 1 then
    raise exception 'Blank-contact payment did not create exactly one Sale.';
  end if;
  if (select count(*) from public.orders where source_payment_request_id = v_request_id) <> 1 then
    raise exception 'Blank-contact payment did not create exactly one Order.';
  end if;

  select * into v_order
  from public.orders
  where source_payment_request_id = v_request_id;

  if v_order.customer_contact is not null then
    raise exception 'Order contact snapshot was not null.';
  end if;
  if (select customer_contact_snapshot from public.sales where source_payment_request_id = v_request_id) is not null then
    raise exception 'Sale contact snapshot was not null.';
  end if;

  perform public.start_order_packing(v_order.id);
  for v_item in
    select * from public.order_items where order_id = v_order.id order by id
  loop
    perform public.set_order_item_packed(v_order.id, v_item.id, true);
  end loop;
  perform public.mark_order_packed(v_order.id);
  perform public.mark_order_shipped(
    v_order.id,
    'J&T',
    'OPTIONAL-CONTACT-TRACKING',
    null,
    now(),
    'Controlled shipping note'
  );
  perform public.mark_order_completed(v_order.id, now(), 'Controlled completion note');

  if (select fulfillment_status from public.orders where id = v_order.id) <> 'completed' then
    raise exception 'Blank-contact Order did not complete.';
  end if;
  if (select count(*) from public.order_fulfillment_events where order_id = v_order.id) <> 5 then
    raise exception 'Blank-contact Order lifecycle event count is invalid.';
  end if;
end;
$$;

reset role;

do $$
begin
  if (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_requests'
      and column_name = 'customer_contact'
  ) <> 'YES' then
    raise exception 'Payment Request customer_contact is still required.';
  end if;

  if (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'customer_contact'
  ) <> 'YES' then
    raise exception 'Order customer_contact is still required.';
  end if;
end;
$$;

rollback;
