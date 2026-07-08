alter table public.inventory_items
  alter column cost drop not null,
  alter column cost drop default;

alter table public.inventory_purchases
  alter column cost drop not null,
  alter column cost drop default;

alter table public.sales
  alter column cost_snapshot drop not null,
  alter column cost_snapshot drop default;
