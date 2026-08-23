-- 159_geo_assets.sql — GEO Answer Content (Phase B). The pages the Content agent writes to win back the
-- answer gaps (questions where rivals are cited and the brand isn't). Drafts now; publishing to the
-- customer's Shopify blog fills shopify_article_id/published_url once Shopify OAuth lands.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.geo_assets (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid references public.brands(id) on delete cascade,
  user_id           uuid not null,
  kind              text default 'answer_page',   -- answer_page | faq | comparison | listicle
  title             text,
  target_prompt     text,                         -- the buyer question this page answers
  body_markdown     text,
  status            text default 'draft',         -- draft | approved | published | failed
  shopify_article_id text,
  published_url     text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_geo_assets_brand on public.geo_assets(brand_id, created_at desc);

alter table public.geo_assets enable row level security;
grant all on public.geo_assets to service_role;
