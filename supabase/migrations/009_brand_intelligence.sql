-- Brand intelligence schema upgrade.
-- Goals:
--   1. Brands have explicit categories (not derived from ad text)
--   2. Ads inherit their brand's categories for fast filtering
--   3. Follower count + verification flag enable quality gating
--   4. Pending brands queue for auto-discovery review
--   5. Seed terms drive category-based auto-discovery

-- 1. Brand categories ─────────────────────────────────────────
alter table discovery_crawl_terms
  add column if not exists categories text[] default '{}',
  add column if not exists follower_count integer,
  add column if not exists verified boolean default false,
  add column if not exists website text,
  add column if not exists picture text,
  add column if not exists notes text;

-- 2. Per-ad brand categories (denormalized for fast filtering) ──
alter table discovery_ads_index
  add column if not exists brand_categories text[] default '{}';

create index if not exists discovery_ads_brand_categories_idx
  on discovery_ads_index using gin (brand_categories);

-- 3. Brand crawl state additions ─────────────────────────────
alter table discovery_brand_crawl_state
  add column if not exists follower_count integer,
  add column if not exists last_followers_check_at timestamptz;

-- 4. Pending brands queue (auto-discovery → review) ──────────
create table if not exists discovery_pending_brands (
  page_id           text primary key,
  page_name         text not null,
  picture           text,
  website           text,
  follower_count    integer,
  ad_count_estimate integer,
  discovered_via    text,                       -- which seed term found it
  discovered_at     timestamptz not null default now(),
  reviewed_at       timestamptz,
  approved          boolean,                    -- null = unreviewed
  rejected_reason   text,
  sample_ad_ids     text[],                     -- first 10 ads we saw, for review
  categories        text[] default '{}'         -- proposed categories
);

create index if not exists discovery_pending_brands_unreviewed_idx
  on discovery_pending_brands (discovered_at desc)
  where reviewed_at is null;

-- 5. Auto-discovery seed terms ──────────────────────────────
create table if not exists discovery_seed_terms (
  id              uuid primary key default gen_random_uuid(),
  term            text not null unique,
  category        text,                         -- broader bucket for the term
  is_active       boolean default true,
  min_followers   integer default 30000,        -- per-seed quality gate
  countries       text[] default '{US}',
  last_run_at     timestamptz,
  brands_found    integer default 0,
  notes           text,
  created_at      timestamptz default now()
);

-- 6. Seed the auto-discovery terms with 50 popular DTC categories
insert into discovery_seed_terms (term, category) values
  -- Health & Beauty
  ('skincare', 'beauty'),
  ('hair growth', 'beauty'),
  ('anti-aging', 'beauty'),
  ('makeup', 'beauty'),
  ('fragrance', 'beauty'),
  ('hair care', 'beauty'),
  ('mens grooming', 'beauty'),
  -- Supplements & Health
  ('protein powder', 'supplements'),
  ('vitamins', 'supplements'),
  ('pre workout', 'supplements'),
  ('collagen', 'supplements'),
  ('mushroom coffee', 'supplements'),
  ('probiotics', 'supplements'),
  -- Fitness & Apparel
  ('gymwear', 'apparel'),
  ('athleisure', 'apparel'),
  ('activewear', 'apparel'),
  ('yoga pants', 'apparel'),
  ('shapewear', 'apparel'),
  ('swimwear', 'apparel'),
  ('mens fashion', 'apparel'),
  ('womens fashion', 'apparel'),
  ('shoes', 'apparel'),
  ('sneakers', 'apparel'),
  ('jewelry', 'apparel'),
  -- Home & Living
  ('mattress', 'home'),
  ('bedding', 'home'),
  ('cookware', 'home'),
  ('air purifier', 'home'),
  ('smart home', 'home'),
  -- Pet
  ('dog food', 'pet'),
  ('pet supplements', 'pet'),
  ('cat litter', 'pet'),
  -- Food & Beverage
  ('meal kit', 'food'),
  ('snack box', 'food'),
  ('coffee subscription', 'food'),
  ('plant based', 'food'),
  ('protein bar', 'food'),
  ('energy drink', 'food'),
  -- Tech & Gadgets
  ('headphones', 'tech'),
  ('smart watch', 'tech'),
  ('phone accessories', 'tech'),
  -- Wellness
  ('meditation app', 'wellness'),
  ('sleep aid', 'wellness'),
  ('cbd', 'wellness'),
  ('mental health', 'wellness'),
  -- Baby & Kids
  ('baby products', 'baby'),
  ('kids clothing', 'baby'),
  -- Travel & Outdoor
  ('luggage', 'outdoor'),
  ('camping gear', 'outdoor'),
  ('cycling', 'outdoor')
on conflict (term) do nothing;

comment on table discovery_pending_brands is
  'Brands found by auto-discovery, awaiting human review before crawling.';
comment on table discovery_seed_terms is
  'Category terms that auto-discovery searches across Meta to find new brands.';
