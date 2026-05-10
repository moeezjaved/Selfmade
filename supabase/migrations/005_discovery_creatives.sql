-- Per-creative storage for carousel ads (multi-image / multi-video).
-- Each row = one slide in an ad. Single-image ads have 1 row.
-- Backwards compat: discovery_ads_index.thumbnail_url + video_url remain
-- (set to position-0 creative). New code reads from this table.

create table if not exists discovery_creatives (
  id          uuid primary key default gen_random_uuid(),
  ad_id       text not null references discovery_ads_index(ad_id) on delete cascade,
  position    smallint not null default 0,        -- order within carousel
  asset_type  text not null check (asset_type in ('image', 'video')),
  r2_url      text not null,
  hash        text,
  created_at  timestamptz not null default now(),
  unique (ad_id, position, asset_type)
);

create index if not exists discovery_creatives_ad_id_idx
  on discovery_creatives (ad_id);

create index if not exists discovery_creatives_hash_idx
  on discovery_creatives (hash)
  where hash is not null;

comment on table discovery_creatives is
  'One row per carousel slide. Single-image ads have 1 row. Atria-style.';
