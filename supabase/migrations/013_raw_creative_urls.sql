-- Raw creative URLs harvested directly from Meta's GraphQL listing payload.
--
-- Background: the indexer was always finding ad_archive_ids in the GraphQL
-- response. After deeper analysis (worker/src/analyze-payload.ts) we learned
-- the SAME response also carries fully-resolved fbcdn URLs in structured
-- form: snapshot.images[].original_image_url, snapshot.videos[].video_hd_url,
-- snapshot.cards[] for carousels. No DOM extraction needed.
--
-- These columns store the raw fbcdn URLs from that payload. The worker's
-- fast path downloads them directly via the proxy and uploads to R2 without
-- launching Playwright. The OLD DOM-extraction path remains as fallback for
-- legacy ads where these columns are NULL.

ALTER TABLE discovery_ads_index
  ADD COLUMN IF NOT EXISTS raw_image_urls          TEXT[],
  ADD COLUMN IF NOT EXISTS raw_video_urls          TEXT[],
  ADD COLUMN IF NOT EXISTS raw_video_preview_urls  TEXT[];

-- Index helps the worker query "which ads still need processing AND have
-- raw URLs ready" quickly across millions of rows.
CREATE INDEX IF NOT EXISTS idx_discovery_ads_index_has_raw
  ON discovery_ads_index (page_id)
  WHERE thumbnail_url IS NULL
    AND video_url IS NULL
    AND raw_image_urls IS NOT NULL;

COMMENT ON COLUMN discovery_ads_index.raw_image_urls IS
  'fbcdn image URLs lifted from snapshot.images[].original_image_url and snapshot.cards[].original_image_url. Used by worker fast path before falling back to DOM extraction.';
COMMENT ON COLUMN discovery_ads_index.raw_video_urls IS
  'fbcdn video URLs (HD preferred, SD fallback) from snapshot.videos[] and snapshot.cards[].';
COMMENT ON COLUMN discovery_ads_index.raw_video_preview_urls IS
  'Video poster frames (snapshot.videos[].video_preview_image_url). Useful for thumbnail-only previews while the full video uploads.';
