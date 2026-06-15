-- Per-ad media backfill tracking.
--
-- The deep cursor-walk occasionally captures an ad without its media URLs
-- (raw_image_urls / raw_video_urls null). Those ads can't get creatives.
-- The backfill daemon (worker/src/per-ad-backfill.ts) fetches each such ad's
-- individual Ad Library page to recover the URLs, then the normal worker
-- downloads them.
--
-- This column marks ads the backfill has already attempted, so we never loop
-- forever on ads that genuinely have no recoverable media (deleted/expired).

ALTER TABLE discovery_ads_index
  ADD COLUMN IF NOT EXISTS media_backfill_attempted_at TIMESTAMPTZ;

-- Fast lookup of ads that still need a backfill attempt.
CREATE INDEX IF NOT EXISTS idx_ads_needs_media_backfill
  ON discovery_ads_index (indexed_at DESC)
  WHERE raw_image_urls IS NULL
    AND raw_video_urls IS NULL
    AND media_backfill_attempted_at IS NULL;

COMMENT ON COLUMN discovery_ads_index.media_backfill_attempted_at IS
  'When the per-ad media backfill daemon last tried to recover this ad''s media URLs. NULL = not yet attempted.';
