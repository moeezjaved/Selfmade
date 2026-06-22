-- Accurate "ads with a creative" for the admin health dashboard.
--
-- Phase 2 made the worker append-only: it writes creatives ONLY to
-- discovery_creatives and NO LONGER sets discovery_ads_index.thumbnail_url/video_url.
-- So the old thumbnail-based health metrics under-report (drained ads show as
-- "missing"). This counts the distinct ads that actually have a creative row, using
-- the discovery_creatives_ad_id_idx index. STABLE + instant to create (the scan only
-- runs when the function is called, on an admin page load).
create or replace function discovery_ads_with_creative_count()
returns bigint
language sql
stable
as $$
  select count(distinct ad_id)::bigint from discovery_creatives;
$$;
