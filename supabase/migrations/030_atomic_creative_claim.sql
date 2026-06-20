-- Atomic creative-claim for the worker (job-queue pattern).
--
-- The streaming worker's plain-SELECT claim kept handing out the SAME ads: under
-- Supabase pooler read-after-write lag, a just-saved thumbnail wasn't yet visible
-- to the next claim read, so ~35% of downloads were re-processed (wasted). This
-- marks rows creative_claimed_at=now() and returns them under FOR UPDATE SKIP
-- LOCKED, so every claim hands out DISTINCT, not-recently-claimed ads — no dupes,
-- no in-memory state, consistent on the primary. Stale claims (process died
-- before saving) become reclaimable after 3 minutes.
alter table discovery_ads_index add column if not exists creative_claimed_at timestamptz;
-- (claim WHERE+ORDER is already covered by idx_ads_worker_claim — no new index needed)

create or replace function claim_creative_ads(p_batch int)
returns table(
  ad_id text,
  snapshot_url text,
  format text,
  page_name text,
  raw_image_urls text[],
  raw_video_urls text[],
  raw_video_preview_urls text[]
)
language sql
as $$
  update discovery_ads_index t
  set creative_claimed_at = now()
  from (
    select s.ad_id
    from discovery_ads_index s
    where s.thumbnail_url is null
      and s.video_url is null
      and s.creative_extraction_failed_at is null
      and (s.raw_image_urls is not null or s.raw_video_urls is not null)
      and (s.creative_claimed_at is null or s.creative_claimed_at < now() - interval '3 minutes')
    order by s.is_active desc, s.last_seen desc
    limit p_batch
    for update skip locked
  ) c
  where t.ad_id = c.ad_id
  returning t.ad_id, t.snapshot_url, t.format, t.page_name,
            t.raw_image_urls, t.raw_video_urls, t.raw_video_preview_urls;
$$;
