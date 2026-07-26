-- collation_count: Meta's "N ads use this creative and text" — how many concurrent duplicates of one
-- creative the advertiser is running RIGHT NOW. The single strongest "this is their winner today"
-- signal (they're actively scaling spend behind it). Captured by the Playwright crawler per ad.
-- Nullable, no default → cheap ALTER even on the large table. Apply with crawl+drain paused.

alter table public.discovery_ads_index add column if not exists collation_count integer;
