-- Precomputed "What to make next" (Creative Strategist) per brand. Computing it live on every brief open
-- meant a slow scan of discovery_ads_index (under crawl load) + an LLM call, which timed out and hid the
-- card. Instead a nightly cron computes it once per brand (when the DB is quiet) and stores it here; the
-- brief card reads this instantly. The live route write-throughs on a cold cache so a brand-new brand
-- still fills in, but the steady state is a fast table read — no live scan, no live model call.
create table if not exists creative_strategy_cache (
  user_id      uuid not null,
  brand_id     uuid,                          -- null = the "All brands" view
  data         jsonb not null,                -- the full CreativeStrategy { summary, ideas[] }
  computed_at  timestamptz not null default now()
);

-- One row per (user, brand). coalesce so the nullable "all brands" row dedupes too.
create unique index if not exists csc_user_brand
  on creative_strategy_cache (user_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Only the service role (server) reads/writes this — lock it down.
alter table creative_strategy_cache enable row level security;
grant all on creative_strategy_cache to service_role;
