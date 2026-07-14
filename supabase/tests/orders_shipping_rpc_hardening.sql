\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('41111111-1111-1111-1111-111111111111'),
  ('42222222-2222-2222-2222-222222222222');

insert into public.inventory_items (id, user_id, sku, name, cost, price, status, locked)
select
  ('caaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 9 then '42222222-2222-2222-2222-222222222222'::uuid else '41111111-1111-1111-1111-111111111111'::uuid end,
  'NK-S' || lpad(n::text, 2, '0'), 'Shipping Item ' || n, 40 + n, 100 + n, 'Reserved', false
from generate_series(1, 9) n;

insert into public.payment_requests (
  id, user_id, request_number, inventory_item_id, customer_name, customer_contact,
  shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
  courier, discount, total_amount, status
)
select
  ('cbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 9 then '42222222-2222-2222-2222-222222222222'::uuid else '41111111-1111-1111-1111-111111111111'::uuid end,
  'PR-SHIP-' || lpad(n::text, 2, '0'),
  ('caaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'))::uuid,
  'Shipping Customer ' || n, '0918000000' || n,
  case when n in (6, 8) then null else 'Shipping Address ' || n end,
  'Shipping Item ' || n, 100 + n, 0,
  case when n = 6 then 'pickup' else 'fee_now' end,
  case when n = 6 then null else 'Test Courier' end,
  0, 100 + n, 'Pending'
from generate_series(1, 9) n;

select set_config('request.jwt.claim.sub', '41111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select public.mark_payment_request_paid(
  ('cbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid, 'GCash'
) from generate_series(1, 8) n;
reset role;

select set_config('request.jwt.claim.sub', '42222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select public.mark_payment_request_paid('cbbbbbbb-bbbb-bbbb-bbbb-000000000009', 'GoTyme');
reset role;

-- Build rollback-only lifecycle fixtures as database owner.
update public.orders set fulfillment_status = 'packed', packed_at = now()
where source_payment_request_id in (
  'cbbbbbbb-bbbb-bbbb-bbbb-000000000001',
  'cbbbbbbb-bbbb-bbbb-bbbb-000000000006',
  'cbbbbbbb-bbbb-bbbb-bbbb-000000000007',
  'cbbbbbbb-bbbb-bbbb-bbbb-000000000008',
  'cbbbbbbb-bbbb-bbbb-bbbb-000000000009'
);
update public.orders set fulfillment_status = 'packing'
where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000003';
update public.orders set fulfillment_status = 'shipped', packed_at = now(), shipped_at = now()
where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000004';
update public.orders set fulfillment_status = 'completed', packed_at = now(), shipped_at = now(), completed_at = now()
where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000005';
update public.order_items set checked_at = now(), checked_by = user_id;
delete from public.order_items where order_id = (
  select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000007'
);

select set_config('request.jwt.claim.sub', '41111111-1111-1111-1111-111111111111', true);
set local role authenticated;

do $$
declare
  v_valid uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001');
  v_ready uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000002');
  v_packing uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000003');
  v_shipped uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000004');
  v_completed uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000005');
  v_pickup uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000006');
  v_itemless uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000007');
  v_no_address uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000008');
  v_other uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000009');
begin
  begin perform public.mark_order_shipped(v_valid, '', 'TRACK-1', null, now(), null); raise exception 'Blank courier accepted.';
  exception when raise_exception then if sqlerrm <> 'Courier is required before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_valid, 'J&T', '', null, now(), null); raise exception 'Blank tracking accepted.';
  exception when raise_exception then if sqlerrm <> 'Tracking number is required before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_valid, 'J&T', '', 'No tracking', now(), null); raise exception 'No-tracking path accepted.';
  exception when raise_exception then if sqlerrm <> 'Tracking number is required before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_valid, 'J&T', 'TRACK-1', null, null, null); raise exception 'Null shipped time accepted.';
  exception when raise_exception then if sqlerrm <> 'Shipped date and time are required.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_ready, 'J&T', 'TRACK-2', null, now(), null); raise exception 'Ready Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_packing, 'J&T', 'TRACK-3', null, now(), null); raise exception 'Packing Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_shipped, 'J&T', 'TRACK-4', null, now(), null); raise exception 'Shipped Order shipped again.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_completed, 'J&T', 'TRACK-5', null, now(), null); raise exception 'Completed Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_pickup, 'Pickup', 'TRACK-6', null, now(), null); raise exception 'Pickup Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Pickup Orders cannot be marked Shipped.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_itemless, 'J&T', 'TRACK-7', null, now(), null); raise exception 'Itemless Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Every required Order Item must be checked before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_no_address, 'J&T', 'TRACK-8', null, now(), null); raise exception 'Addressless Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Shipping address is required before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_other, 'J&T', 'TRACK-9', null, now(), null); raise exception 'Cross-owner Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
  begin perform public.mark_order_shipped('ffffffff-ffff-ffff-ffff-ffffffffffff', 'J&T', 'TRACK-X', null, now(), null); raise exception 'Missing Order shipped.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
end;
$$;

-- Database-only malformed and unknown-state fixtures prove the RPC rejects
-- states that normal table constraints prevent. The outer transaction restores
-- every dropped constraint and row change.
reset role;
alter table public.order_items drop constraint order_items_check_actor_pair;
alter table public.order_items drop constraint order_items_checked_by_owner;
update public.order_items
set checked_by = null
where order_id = (
  select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001'
);
alter table public.orders drop constraint orders_fulfillment_status_check;
update public.orders
set fulfillment_status = 'unknown_status'
where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000008';

set local role authenticated;
do $$
declare
  v_malformed uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001');
  v_unknown uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000008');
begin
  begin perform public.mark_order_shipped(v_malformed, 'J&T', 'TRACK-M', null, now(), null); raise exception 'Malformed checklist shipped.';
  exception when raise_exception then if sqlerrm <> 'Every required Order Item must be checked before shipping.' then raise; end if; end;
  begin perform public.mark_order_shipped(v_unknown, 'J&T', 'TRACK-U', null, now(), null); raise exception 'Unknown status shipped.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
end;
$$;

reset role;
update public.order_items
set checked_by = user_id
where order_id = (
  select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001'
);
set local role authenticated;

select public.mark_order_shipped(
  (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001'),
  'J&T Express', 'TRACK-VALID-1', null, now(), 'Handle with care'
);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'cbbbbbbb-bbbb-bbbb-bbbb-000000000001');
begin
  if not exists (
    select 1 from public.orders where id = v_order_id and fulfillment_status = 'shipped'
      and courier = 'J&T Express' and tracking_number = 'TRACK-VALID-1'
      and shipped_at is not null and shipping_note = 'Handle with care'
  ) then raise exception 'Valid shipment fields did not persist.'; end if;
  if (select count(*) from public.order_fulfillment_events where order_id = v_order_id and from_status = 'packed' and to_status = 'shipped' and metadata ->> 'action' = 'mark_shipped') <> 1
  then raise exception 'Shipment did not create exactly one event.'; end if;
  begin perform public.mark_order_shipped(v_order_id, 'J&T Express', 'TRACK-VALID-1', null, now(), null); raise exception 'Duplicate shipment accepted.';
  exception when raise_exception then if sqlerrm <> 'Only Packed Orders can be marked Shipped.' then raise; end if; end;
  if (select count(*) from public.order_fulfillment_events where order_id = v_order_id and metadata ->> 'action' = 'mark_shipped') <> 1
  then raise exception 'Duplicate shipment created another event.'; end if;
end;
$$;

reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)', 'EXECUTE')
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
      where p.oid = 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)'::regprocedure
        and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ) then raise exception 'Shipping RPC grants are incorrect.'; end if;
  if not (select prosecdef from pg_proc where oid = 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)'::regprocedure)
    or (select proconfig from pg_proc where oid = 'public.mark_order_shipped(uuid,text,text,text,timestamp with time zone,text)'::regprocedure) <> array['search_path=public']
  then raise exception 'Shipping RPC security settings are incorrect.'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.order_fulfillment_events'::regclass)
    or has_table_privilege('authenticated', 'public.orders', 'INSERT,UPDATE,DELETE')
  then raise exception 'Order RLS or direct-write boundary changed.'; end if;
  if exists (select 1 from public.inventory_items where id::text like 'caaaaaaa%' and status <> 'Sold')
    or exists (select 1 from public.payment_requests where id::text like 'cbbbbbbb%' and status <> 'Paid')
    or exists (select 1 from public.sales s join public.inventory_items i on i.id = s.inventory_item_id where i.id::text like 'caaaaaaa%' and s.sale_price <> i.price)
    or exists (select 1 from public.orders where source_payment_request_id::text like 'cbbbbbbb%' and (customer_name not like 'Shipping Customer %' or total_paid_snapshot <> subtotal_snapshot))
  then raise exception 'Shipping changed protected business-domain state.'; end if;
end;
$$;

select 'shipping RPC hardening tests passed' as result;

rollback;
