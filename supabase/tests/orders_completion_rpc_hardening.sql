\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('51111111-1111-1111-1111-111111111111'),
  ('52222222-2222-2222-2222-222222222222');

insert into public.inventory_items (id, user_id, sku, name, cost, price, status, locked)
select
  ('daaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 9 then '52222222-2222-2222-2222-222222222222'::uuid else '51111111-1111-1111-1111-111111111111'::uuid end,
  'NK-C' || lpad(n::text, 2, '0'), 'Completion Item ' || n, 40 + n, 100 + n, 'Reserved', false
from generate_series(1, 9) n;

insert into public.payment_requests (
  id, user_id, request_number, inventory_item_id, customer_name, customer_contact,
  shipping_address, item_name_snapshot, item_price, shipping_fee, shipping_mode,
  courier, discount, total_amount, status
)
select
  ('dbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 9 then '52222222-2222-2222-2222-222222222222'::uuid else '51111111-1111-1111-1111-111111111111'::uuid end,
  'PR-COMPLETE-' || lpad(n::text, 2, '0'),
  ('daaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'))::uuid,
  'Completion Customer ' || n, '0919000000' || n, 'Completion Address ' || n,
  'Completion Item ' || n, 100 + n, 0, 'fee_now', 'Test Courier', 0, 100 + n, 'Pending'
from generate_series(1, 9) n;

select set_config('request.jwt.claim.sub', '51111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select public.mark_payment_request_paid(
  ('dbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid, 'GCash'
) from generate_series(1, 8) n;
reset role;

select set_config('request.jwt.claim.sub', '52222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select public.mark_payment_request_paid('dbbbbbbb-bbbb-bbbb-bbbb-000000000009', 'GoTyme');
reset role;

-- Build rollback-only lifecycle fixtures as database owner.
update public.orders set fulfillment_status = 'shipped', packed_at = now(), shipped_at = now()
where source_payment_request_id in (
  'dbbbbbbb-bbbb-bbbb-bbbb-000000000001',
  'dbbbbbbb-bbbb-bbbb-bbbb-000000000006',
  'dbbbbbbb-bbbb-bbbb-bbbb-000000000009'
);
update public.orders set fulfillment_status = 'packing'
where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000003';
update public.orders set fulfillment_status = 'packed', packed_at = now()
where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000004';
update public.orders set fulfillment_status = 'completed', packed_at = now(), shipped_at = now(), completed_at = now()
where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000005';
update public.orders set fulfillment_status = 'shipped', packed_at = now(), shipped_at = null
where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000008';
alter table public.orders drop constraint orders_fulfillment_status_check;
update public.orders set fulfillment_status = 'unknown_status'
where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000007';

select set_config('request.jwt.claim.sub', '51111111-1111-1111-1111-111111111111', true);
set local role authenticated;

do $$
declare
  v_valid uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000001');
  v_ready uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000002');
  v_packing uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000003');
  v_packed uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000004');
  v_completed uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000005');
  v_unknown uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000007');
  v_missing_shipped_at uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000008');
  v_other uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000009');
  v_shipped_at timestamptz := (select shipped_at from public.orders where id = v_valid);
begin
  begin perform public.mark_order_completed(v_valid, null, null); raise exception 'Null completion time accepted.';
  exception when raise_exception then if sqlerrm <> 'Completion date and time are required.' then raise; end if; end;
  begin perform public.mark_order_completed(v_valid, v_shipped_at - interval '1 second', null); raise exception 'Completion before shipping accepted.';
  exception when raise_exception then if sqlerrm <> 'Completion date and time cannot be before shipping.' then raise; end if; end;
  begin perform public.mark_order_completed(v_valid, now(), repeat('x', 2001)); raise exception 'Oversized completion note accepted.';
  exception when raise_exception then if sqlerrm <> 'Completion note is too long.' then raise; end if; end;
  begin perform public.mark_order_completed(v_ready, now(), null); raise exception 'Ready Order completed.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  begin perform public.mark_order_completed(v_packing, now(), null); raise exception 'Packing Order completed.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  begin perform public.mark_order_completed(v_packed, now(), null); raise exception 'Packed Order completed.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  begin perform public.mark_order_completed(v_completed, now(), null); raise exception 'Completed Order completed again.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  begin perform public.mark_order_completed(v_unknown, now(), null); raise exception 'Unknown-status Order completed.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  begin perform public.mark_order_completed(v_missing_shipped_at, now(), null); raise exception 'Missing shipped timestamp accepted.';
  exception when raise_exception then if sqlerrm <> 'Completion date and time cannot be before shipping.' then raise; end if; end;
  begin perform public.mark_order_completed(v_other, now(), null); raise exception 'Cross-owner Order completed.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
  begin perform public.mark_order_completed('ffffffff-ffff-ffff-ffff-ffffffffffff', now(), null); raise exception 'Missing Order completed.';
  exception when raise_exception then if sqlerrm <> 'Order not found.' then raise; end if; end;
end;
$$;

select public.mark_order_completed(
  (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000001'),
  now(), null
);

do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000001');
begin
  if not exists (
    select 1 from public.orders where id = v_order_id
      and fulfillment_status = 'completed' and completed_at is not null
  ) then raise exception 'Valid completion did not persist.'; end if;
  if (select count(*) from public.order_fulfillment_events
      where order_id = v_order_id and from_status = 'shipped' and to_status = 'completed'
        and metadata ->> 'action' = 'mark_completed') <> 1
  then raise exception 'Completion did not create exactly one event.'; end if;
  begin perform public.mark_order_completed(v_order_id, now(), null); raise exception 'Duplicate completion accepted.';
  exception when raise_exception then if sqlerrm <> 'Only Shipped Orders can be marked Completed.' then raise; end if; end;
  if (select count(*) from public.order_fulfillment_events where order_id = v_order_id and metadata ->> 'action' = 'mark_completed') <> 1
  then raise exception 'Duplicate completion created another event.'; end if;
end;
$$;

reset role;

create or replace function public.fail_test_completion_event()
returns trigger
language plpgsql
as $$
begin
  if new.order_id = (
    select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000006'
  ) and new.metadata ->> 'action' = 'mark_completed' then
    raise exception 'Injected completion event failure.';
  end if;
  return new;
end;
$$;

create trigger fail_test_completion_event
before insert on public.order_fulfillment_events
for each row execute function public.fail_test_completion_event();

set local role authenticated;
do $$
declare
  v_order_id uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000006');
begin
  begin perform public.mark_order_completed(v_order_id, now(), null); raise exception 'Injected completion failure unexpectedly succeeded.';
  exception when raise_exception then if sqlerrm <> 'Injected completion event failure.' then raise; end if; end;
end;
$$;
reset role;

drop trigger fail_test_completion_event on public.order_fulfillment_events;
drop function public.fail_test_completion_event();

do $$
declare
  v_failed_order uuid := (select id from public.orders where source_payment_request_id = 'dbbbbbbb-bbbb-bbbb-bbbb-000000000006');
begin
  if not exists (select 1 from public.orders where id = v_failed_order and fulfillment_status = 'shipped' and completed_at is null)
    or exists (select 1 from public.order_fulfillment_events where order_id = v_failed_order and metadata ->> 'action' = 'mark_completed')
  then raise exception 'Completion event failure did not roll back atomically.'; end if;

  if not has_function_privilege('authenticated', 'public.mark_order_completed(uuid,timestamp with time zone,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.mark_order_completed(uuid,timestamp with time zone,text)', 'EXECUTE')
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
      where p.oid = 'public.mark_order_completed(uuid,timestamp with time zone,text)'::regprocedure
        and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ) then raise exception 'Completion RPC grants are incorrect.'; end if;
  if not (select prosecdef from pg_proc where oid = 'public.mark_order_completed(uuid,timestamp with time zone,text)'::regprocedure)
    or (select proconfig from pg_proc where oid = 'public.mark_order_completed(uuid,timestamp with time zone,text)'::regprocedure) <> array['search_path=public']
  then raise exception 'Completion RPC security settings are incorrect.'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.order_fulfillment_events'::regclass)
    or has_table_privilege('authenticated', 'public.orders', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.order_fulfillment_events', 'INSERT,UPDATE,DELETE')
  then raise exception 'Order RLS or direct-write boundary changed.'; end if;

  if exists (select 1 from public.inventory_items where id::text like 'daaaaaaa%' and status <> 'Sold')
    or exists (select 1 from public.payment_requests where id::text like 'dbbbbbbb%' and status <> 'Paid')
    or exists (select 1 from public.sales s join public.inventory_items i on i.id = s.inventory_item_id where i.id::text like 'daaaaaaa%' and s.sale_price <> i.price)
    or exists (select 1 from public.orders where source_payment_request_id::text like 'dbbbbbbb%'
      and (customer_name not like 'Completion Customer %' or total_paid_snapshot <> subtotal_snapshot))
  then raise exception 'Completion changed protected business-domain state.'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform public.mark_order_completed('ffffffff-ffff-ffff-ffff-ffffffffffff', now(), null);
    raise exception 'Anonymous completion unexpectedly executed.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select 'completion RPC hardening tests passed' as result;

rollback;
