-- Track ads where creative extraction failed (deactivated, expired token, etc.)
-- so the worker skips them instead of retrying forever.

alter table discovery_ads_index
  add column if not exists creative_extraction_failed_at timestamptz,
  add column if not exists creative_extraction_attempts smallint default 0;

create index if not exists discovery_ads_extraction_failed_idx
  on discovery_ads_index (creative_extraction_failed_at)
  where creative_extraction_failed_at is not null;
