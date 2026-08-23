-- 161_shopify.sql — Shopify department foundation. The connection every Shopify agent stands on.
-- Door-agnostic (like meta_accounts): a store row is filled either by the BYO custom-app token door
-- (/api/shopify/connect) OR, later, by the Partner-app OAuth button — every downstream agent reads
-- shopify_stores the same way regardless of which door filled it.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

-- One connected store per (user, brand). access_token is AES-encrypted (encryptToken), never stored raw.
create table if not exists public.shopify_stores (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brands(id) on delete cascade,
  user_id       uuid not null,
  shop_domain   text not null,               -- e.g. my-store.myshopify.com
  access_token  text not null,               -- encrypted
  scopes        text,                         -- granted scopes, comma-joined
  storefront    text,                         -- public storefront URL if custom domain
  shop_name     text,
  plan_name     text,
  currency      text,
  door          text default 'byo',           -- byo | oauth
  status        text default 'active',        -- active | revoked | error
  last_sync     timestamptz,
  connected_at  timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, shop_domain)
);
create index if not exists idx_shopify_stores_brand on public.shopify_stores(brand_id);
create index if not exists idx_shopify_stores_user on public.shopify_stores(user_id);

-- Product cache: what the Catalog cluster reads/rewrites. Kept in our DB so agents diff against the
-- live store without hammering the Admin API. gid = Shopify global id (gid://shopify/Product/123).
create table if not exists public.shopify_products (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.shopify_stores(id) on delete cascade,
  brand_id      uuid references public.brands(id) on delete cascade,
  user_id       uuid not null,
  gid           text not null,               -- gid://shopify/Product/<id>
  handle        text,
  title         text,
  body_html     text,
  product_type  text,
  vendor        text,
  tags          text,
  status        text,                         -- active | draft | archived
  seo_title     text,
  seo_description text,
  image_count   int default 0,
  images_missing_alt int default 0,
  variant_count int default 0,
  price_min     numeric,
  price_max     numeric,
  raw           jsonb,                        -- full node for anything not columnised
  synced_at     timestamptz default now(),
  unique (store_id, gid)
);
create index if not exists idx_shopify_products_store on public.shopify_products(store_id);
create index if not exists idx_shopify_products_brand on public.shopify_products(brand_id, synced_at desc);

alter table public.shopify_stores enable row level security;
alter table public.shopify_products enable row level security;
grant all on public.shopify_stores to service_role;
grant all on public.shopify_products to service_role;
