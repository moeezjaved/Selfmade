-- 162_shopify_catalog.sql — the Catalog cluster's approval queue. Every agent DRAFTS a change here first;
-- nothing is written to the store until the founder approves and we run applyDrafts (write_products scope).
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.shopify_catalog_drafts (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.shopify_stores(id) on delete cascade,
  brand_id      uuid references public.brands(id) on delete cascade,
  user_id       uuid not null,
  product_gid   text not null,               -- gid://shopify/Product/<id>
  product_title text,
  agent         text not null,               -- seo | description | alt
  proposal      jsonb not null,              -- shape depends on agent (see catalog.ts)
  status        text default 'draft',        -- draft | applied | skipped | failed
  error         text,
  created_at    timestamptz default now(),
  applied_at    timestamptz
);
create index if not exists idx_catalog_drafts_store on public.shopify_catalog_drafts(store_id, status, created_at desc);
create index if not exists idx_catalog_drafts_product on public.shopify_catalog_drafts(product_gid);

alter table public.shopify_catalog_drafts enable row level security;
grant all on public.shopify_catalog_drafts to service_role;
