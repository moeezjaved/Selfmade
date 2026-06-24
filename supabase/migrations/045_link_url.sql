-- Persist each ad's destination URL so Brand Spy's Landing Pages tab can group funnels.
--
-- The crawler already RECEIVES link_url in Meta's GraphQL payload (ExtractedAd.link_url) — it just
-- never stored it. This adds the column; the crawler writes it going forward (zero extra fetch /
-- IPRoyal). It fills per-brand on the next crawl — and a SPIED brand gets a fresh full crawl
-- immediately, so its Landing Pages populate within minutes. No historical backfill (would need a
-- full re-crawl); going-forward is the practical path.
--
-- Nullable text add → instant, no rewrite. Run with crawl paused per the standing rule.
alter table discovery_ads_index
  add column if not exists link_url text;
