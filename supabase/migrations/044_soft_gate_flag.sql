-- Persist the crawler's soft-gate detection so the admin can filter "soft-gated brands".
--
-- The crawler already computes `softGateSuspect` at runtime (Meta returned has_next_page=false at a
-- suspiciously low count, or truncated the response — e.g. gruns returning 27 of ~14k), but it was
-- never stored, so there was no way to list which brands are affected. This column records WHEN a
-- brand was last flagged soft-gate-truncated; the indexer sets it on a suspect run and clears it
-- (NULL) on a clean complete haul. Admin Brands "🚧 Soft-gated" view reads it.
--
-- Nullable metadata-only add → instant. Run with crawl paused per the standing pause-before-DDL rule.
alter table discovery_brand_crawl_state
  add column if not exists soft_gate_at timestamptz;
