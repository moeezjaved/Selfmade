-- Keyword search was seq-scanning 2.36M rows: the OR matches search_vector (full-text), topics, and
-- industries — and NONE of them had a GIN index (only brand_categories did, migration 009). At this
-- corpus size that's multi-second and blows the statement timeout → the "Unexpected token … not
-- valid JSON" error (an HTML error page parsed as JSON). These three GIN indexes make the search
-- index-backed → sub-second (Atria-speed).
--
-- BUILD WITH WRITERS PAUSED (pause crawl + drain + backfills first — pause-before-DDL rule) so the
-- index build doesn't fight live writes. Each builds in ~1–3 min on 2.36M rows. (If you'd rather not
-- pause, run each as CREATE INDEX CONCURRENTLY individually — but that can't run inside a txn block.)
create index if not exists discovery_ads_search_vector_gin on discovery_ads_index using gin (search_vector);
create index if not exists discovery_ads_topics_gin        on discovery_ads_index using gin (topics);
create index if not exists discovery_ads_industries_gin    on discovery_ads_index using gin (industries);
