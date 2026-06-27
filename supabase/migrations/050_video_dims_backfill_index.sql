-- Partial index for the mp4-poster dims backfill. It now targets videos missing width (asset_type
-- video + width IS NULL) to stamp each video's real aspect so the masonry sizes video cards
-- correctly (no flat-125% fallback). This index makes that keyset scan fast; rows drop out of the
-- index as dims get stamped, so it shrinks to nothing as the backfill converges.
--
-- Built CONCURRENTLY so it doesn't lock discovery_creatives while the drain/poster are writing.
create index concurrently if not exists dc_vid_undim
  on discovery_creatives (ad_id)
  where asset_type = 'video' and width is null;
