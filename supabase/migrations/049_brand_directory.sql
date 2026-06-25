-- Brand Directory — the big browse/search catalog of brands (e.g. the ~611K Foreplay list with
-- category + Facebook page id). DISTINCT from the `brands` table, which is the CRAWL QUEUE: this is
-- a searchable index users browse to spy any brand, and the pool we PROMOTE brands from into the
-- crawl. Join key to everything (crawl `brands`, `discovery_ads_index`) is page_id (the FB id).
--
-- APPLY ONLY WHEN THE WRITE LOAD IS QUIET (pause crawl/drain/rollup first) — creating a table forces
-- a PostgREST schema reload, which 503'd the whole API once under load (see migration 046). And run
-- the bulk 611K import AFTER the us-east migration — it's a heavy write the maxed Tokyo DB can't take.

create table if not exists brand_directory (
  page_id          text primary key,          -- Facebook page id — natural key → import dedups on it
  name             text not null,
  avatar_url       text,
  industry         text,
  source_ad_count  int  not null default 0,    -- the source's "# ads" (e.g. Foreplay community ads)
  country          text,
  website          text,
  source           text not null default 'foreplay',
  is_active        bool not null default true,
  imported_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Browse/sort: default feed is ad_count DESC; the (industry, ad_count) composite serves the
-- industry-filtered sort without a full sort. Trigram on name = fast search at 611K rows.
create index if not exists brand_directory_adcount_idx  on brand_directory (source_ad_count desc);
create index if not exists brand_directory_industry_idx on brand_directory (industry, source_ad_count desc);
create index if not exists brand_directory_name_trgm    on brand_directory using gin (name gin_trgm_ops);

-- Public catalog data — readable by any signed-in user; only the service-role admin importer writes.
alter table brand_directory enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='brand_directory' and policyname='brand_directory_read') then
    create policy "brand_directory_read" on brand_directory for select using (true);
  end if;
end $$;
