-- Atria-style no-reflow grid (foundation): store each creative's pixel dimensions
-- so the client can reserve the exact card height BEFORE the image loads → zero
-- layout reflow. Captured at crawl time via sharp (images); videos get a sensible
-- client-side fallback until video-dimension parsing lands.
--
-- ADD COLUMN with no default is metadata-only in Postgres 11+ (instant, no table
-- rewrite, no lock contention) — safe even on the 1.5M-row creatives table.
alter table discovery_creatives add column if not exists width  int;
alter table discovery_creatives add column if not exists height int;

comment on column discovery_creatives.width  is 'Original creative pixel width (sharp at crawl time). Null = unknown → client falls back to a default aspect.';
comment on column discovery_creatives.height is 'Original creative pixel height. Used with width to reserve card height pre-load (no reflow).';
