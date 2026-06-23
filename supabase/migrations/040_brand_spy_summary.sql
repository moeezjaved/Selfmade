-- Brand Spy list breakdown — per-brand Active / Inactive / format counts shown in the
-- directory (Foreplay-style: "2110 Active · 12715 Inactive · 🎬1426 🖼️684").
--
-- discovery_brand_crawl_state already has one row per brand (page_id, ads_indexed). These
-- nullable columns hold the split + creative mix so the LIST can show them without
-- aggregating the 1.4M-row discovery_ads_index. The Brand Spy detail engine populates them
-- (best-effort) every time a brand is viewed, and the crawler can too.
--
-- Nullable metadata-only adds → instant, no table rewrite. Still, run with crawl+drain
-- PAUSED per the standing pause-before-DDL rule (a PostgREST schema reload under load has
-- 503'd the API before). The table is small (~10K rows) so the reload is the only risk.
alter table discovery_brand_crawl_state
  add column if not exists active_count   int,
  add column if not exists video_count    int,
  add column if not exists image_count    int,
  add column if not exists carousel_count int,
  add column if not exists stats_at       timestamptz;   -- when the split was last computed
