-- 164_shopify_orders.sql — real Shopify orders = TRUE revenue (the mission ladder's real numbers) AND the
-- denominator for SEO/channel attribution. Each order carries its referrer + landing page, so we can label
-- the channel (organic / paid / social / email / referral / direct) and read organic revenue directly —
-- a first honest cut of "SEO contribution to revenue" without needing GA.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.shopify_orders (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.shopify_stores(id) on delete cascade,
  brand_id         uuid references public.brands(id) on delete cascade,
  user_id          uuid not null,
  order_id         bigint not null,            -- Shopify numeric order id
  name             text,                        -- e.g. #1001
  total_price      numeric default 0,
  currency         text,
  financial_status text,
  source_name      text,                        -- web | pos | shopify_draft_order | ...
  landing_site     text,
  referring_site   text,
  channel          text,                        -- organic | paid | social | email | referral | direct
  processed_at     timestamptz,                 -- when the order was placed
  synced_at        timestamptz default now(),
  unique (store_id, order_id)
);
create index if not exists idx_shopify_orders_store on public.shopify_orders(store_id, processed_at desc);
create index if not exists idx_shopify_orders_channel on public.shopify_orders(store_id, channel);
create index if not exists idx_shopify_orders_brand on public.shopify_orders(brand_id, processed_at desc);

alter table public.shopify_orders enable row level security;
grant all on public.shopify_orders to service_role;
