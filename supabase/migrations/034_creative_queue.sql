-- Creative-queue refactor, PHASE 1: the CLAIM path only.
--
-- The worker found its next job by scanning discovery_ads_index for
-- `thumbnail_url IS NULL AND … raw_urls NOT NULL` — an O(corpus) anti-scan that hit
-- ~133s at 700K (almost every ad is already processed, so it scans most of the table
-- to find the few pending). A dedicated work-queue holds ONLY pending jobs (thousands,
-- not millions), so the claim is O(pending) at any corpus size, and FOR UPDATE SKIP
-- LOCKED removes the claim races too.
--
-- PHASE 1 CHANGES THE CLAIM ONLY. The write path (updateAdCreative / saveCreatives) and
-- serving are untouched — so this is independently safe and does NOT lower the CPU floor
-- (the per-ad UPDATE churn is unchanged; that's Phase 2's append-only + serving work).

create table if not exists creative_queue (
  ad_id       text primary key,
  enqueued_at timestamptz not null default now(),
  claimed_at  timestamptz,
  attempts    int not null default 0
);
-- supports the claim scan: unclaimed first, then by age; cheap stale-reclaim too.
create index if not exists creative_queue_claim_idx on creative_queue (claimed_at nulls first, enqueued_at);

-- Enqueue a job when an ad GETS raw URLs — on insert (new crawl) or when the per-ad
-- backfill sets them — and the ad isn't already processed/failed. Fires ONLY on
-- raw_*_urls changes, so the drain's updateAdCreative (thumbnail/hash cols) never
-- triggers it → zero overhead on the hot write path.
create or replace function enqueue_creative() returns trigger language plpgsql as $$
begin
  if (new.raw_image_urls is not null or new.raw_video_urls is not null)
     and new.thumbnail_url is null and new.video_url is null
     and new.creative_extraction_failed_at is null then
    insert into creative_queue (ad_id) values (new.ad_id) on conflict (ad_id) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists trg_enqueue_creative on discovery_ads_index;
create trigger trg_enqueue_creative
  after insert or update of raw_image_urls, raw_video_urls on discovery_ads_index
  for each row execute function enqueue_creative();

-- O(pending) claim: SKIP LOCKED a batch of pending jobs, mark claimed (3-min stale
-- reclaim, give up after 6 attempts), join the ad for its raw URLs. Returns the same
-- shape the worker already consumes.
create or replace function claim_creative_queue(p_batch int)
returns table(ad_id text, snapshot_url text, format text, page_name text,
              raw_image_urls text[], raw_video_urls text[], raw_video_preview_urls text[])
language sql as $$
  with claimed as (
    update creative_queue q
    set claimed_at = now(), attempts = attempts + 1
    from (
      select cq.ad_id from creative_queue cq
      where (cq.claimed_at is null or cq.claimed_at < now() - interval '3 minutes')
        and cq.attempts < 6
      order by cq.enqueued_at
      limit p_batch
      for update skip locked
    ) c
    where q.ad_id = c.ad_id
    returning q.ad_id
  )
  select a.ad_id, a.snapshot_url, a.format, a.page_name,
         a.raw_image_urls, a.raw_video_urls, a.raw_video_preview_urls
  from claimed cl
  join discovery_ads_index a on a.ad_id = cl.ad_id
  where a.creative_extraction_failed_at is null;
$$;
grant execute on function claim_creative_queue(int) to service_role;

-- One-time backfill: seed the queue from the current pending set (the old claim's exact
-- filter). One O(corpus) scan, run once here in the clean window.
insert into creative_queue (ad_id)
select ad_id from discovery_ads_index
where thumbnail_url is null and video_url is null
  and creative_extraction_failed_at is null
  and (raw_image_urls is not null or raw_video_urls is not null)
on conflict (ad_id) do nothing;
