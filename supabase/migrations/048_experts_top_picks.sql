-- Experts / Top Picks — expert-curated packs of favorite ads, each ad carrying a Canva
-- template link, sold to users (experts earn a revenue share). Four tables, all hanging off
-- the existing discovery_ads_index corpus. Admin curates via /admin/experts; users browse at
-- /discovery/top-picks.
--
-- APPLY ONLY WHEN THE WRITE LOAD IS QUIET (pause crawl/drain/rollup first) — creating tables
-- forces a PostgREST schema reload, which 503'd the whole API once under load (see migration 046).

-- ── Experts: the curators (admin-managed) ───────────────────────────────────
create table if not exists experts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  handle             text,                       -- @handle (optional)
  avatar_url         text,
  bio                text,
  revenue_share_pct  numeric not null default 50,-- % of each pack sale the expert earns
  sort_order         int  not null default 0,
  is_published       bool not null default false,
  created_at         timestamptz not null default now()
);

-- ── Packs: a curated set an expert sells (e.g. "50 Ads | 50 Templates") ──────
create table if not exists expert_packs (
  id                   uuid primary key default gen_random_uuid(),
  expert_id            uuid not null references experts(id) on delete cascade,
  title                text not null,
  description          text,
  cover_url            text,
  price_cents          int  not null default 0,  -- 0 = free; else current price (e.g. 9900 = $99)
  original_price_cents int,                       -- struck-through "was" price (early-bird)
  is_early_bird        bool not null default false,
  gate                 text not null default 'free' check (gate in ('free','core','paid')),
  sort_order           int  not null default 0,
  is_published         bool not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists expert_packs_expert_idx on expert_packs(expert_id);

-- ── Pack ↔ ad join: which ads are in a pack + that ad's Canva template ───────
-- ad_id is discovery_ads_index's key (text). No FK so a corpus re-index can't break a pack;
-- the serving join tolerates a missing ad (it just drops out of the grid).
create table if not exists expert_pack_ads (
  id                  uuid primary key default gen_random_uuid(),
  pack_id             uuid not null references expert_packs(id) on delete cascade,
  ad_id               text not null,
  canva_template_url  text,                       -- "Edit in template" opens this (stored-link MVP)
  position            int  not null default 0,
  created_at          timestamptz not null default now(),
  unique (pack_id, ad_id)
);
create index if not exists expert_pack_ads_pack_idx on expert_pack_ads(pack_id, position);

-- ── Purchases: who has unlocked which pack (drives gating + expert earnings) ──
create table if not exists expert_pack_purchases (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  pack_id          uuid not null references expert_packs(id) on delete cascade,
  price_paid_cents int  not null default 0,
  created_at       timestamptz not null default now(),
  unique (user_id, pack_id)
);
create index if not exists expert_pack_purchases_user_idx on expert_pack_purchases(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Catalog tables (experts/packs/pack_ads) are PUBLIC read — the serving client lists them and
-- the API does the published-filter + paid-gating. Only the service-role admin writes them.
-- Purchases are private — a user sees only their own.
alter table experts                enable row level security;
alter table expert_packs           enable row level security;
alter table expert_pack_ads        enable row level security;
alter table expert_pack_purchases  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='experts' and policyname='experts_read') then
    create policy "experts_read" on experts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='expert_packs' and policyname='expert_packs_read') then
    create policy "expert_packs_read" on expert_packs for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='expert_pack_ads' and policyname='expert_pack_ads_read') then
    create policy "expert_pack_ads_read" on expert_pack_ads for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='expert_pack_purchases' and policyname='purchases_own_read') then
    create policy "purchases_own_read" on expert_pack_purchases for select using (auth.uid() = user_id);
  end if;
end $$;
