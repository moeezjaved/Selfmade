-- Perceptual hash deduplication for creatives.
-- pHash for images (visual similarity), MD5 for videos (byte equality).

alter table discovery_ads_index
  add column if not exists image_hash text,
  add column if not exists video_hash text;

create index if not exists discovery_ads_image_hash_idx
  on discovery_ads_index (image_hash)
  where image_hash is not null;

create index if not exists discovery_ads_video_hash_idx
  on discovery_ads_index (video_hash)
  where video_hash is not null;

comment on column discovery_ads_index.image_hash is
  '16-char hex perceptual hash (pHash). Same value across visually-identical images.';
comment on column discovery_ads_index.video_hash is
  '32-char hex MD5 of video file bytes. Same value when video files are byte-identical.';
