# Creative Pipeline Spec — deduped, poster-first, lazy-video (Atria-style, tighter)

Goal: store every creative (FB CDN expires → must re-host), serve the grid instantly, keep storage/
bandwidth affordable at 5M ads. Modeled on Atria's confirmed architecture, with hash-dedup +
serve-resized-direct on top.

Constraints (confirmed):
- FB CDN URLs are signed + **expire in hours** → must download to our CDN, and **drain fast** or URLs die.
- Research tool → need **breadth** (store all) + **instant** grid (no waiting, no missing images in viewport).
- Video is ~90% of bytes → grid must never load video; defer mp4 to play.

---

## 1. R2 storage — hash-keyed = dedup (the big lever)

One object per UNIQUE creative hash, never per ad. 5M ads ≈ ~1.5M unique creatives.
```
creatives/img/<image_hash>/orig.jpg      # 1080×1920 (detail)
creatives/img/<image_hash>/grid.jpg      # ~338×600  (grid)   ← serve this directly
creatives/vid/<video_hash>/poster.jpg    # poster frame (grid) ← tiny, store for ALL videos
creatives/vid/<video_hash>/sd.mp4        # 360×640   (play)
creatives/vid/<video_hash>/hd.mp4        # 720×1280  (optional / on-demand)
```
**Before upload: check existence by hash → skip if present.** That's the dedup. (VERIFY your current
worker keys R2 by hash, not ad_id — if it's ad_id, this change alone is your ~4× cost cut.)

---

## 2. Schema

```sql
-- One row per UNIQUE creative (the dedup table). Ads point here via image_hash/video_hash.
create table creative_assets (
  hash         text primary key,        -- image_hash OR video_hash
  kind         text not null,           -- 'image' | 'video'
  orig_url     text,                     -- r2 (image original)
  grid_url     text,                     -- r2 (image ~338×600)
  poster_url   text,                     -- r2 (video poster jpg)
  sd_url       text,                     -- r2 (video 360×640)
  hd_url       text,                     -- r2 (video 720×1280, nullable)
  width int, height int, duration_s numeric, bytes int,
  status       text default 'stored',    -- 'stored' | 'failed'
  created_at   timestamptz default now()
);

-- Small WORK QUEUE (the scaling fix — claim from here, NOT a scan of the 5M ads table)
create table creative_queue (
  hash         text primary key,        -- unique creative to fetch
  kind         text,
  src_url      text,                    -- FRESH FB CDN url captured at crawl (expires!)
  ad_archive_id text,                   -- so an EXPIRED src can be re-resolved by re-crawl
  priority     int default 5,           -- active/recent/winner/popular-brand = higher
  attempts     int default 0,
  enqueued_at  timestamptz default now()
);
create index on creative_queue (priority desc, enqueued_at);
```
Why a queue table: claiming from a *small* pending queue (`SKIP LOCKED`) is instant and never bloats —
this is what fixes the 133s "scan discovery_ads_index WHERE thumbnail_url IS NULL" claim that took the DB
down. Done creatives leave the queue; the giant ads table is never UPDATE-churned for creative status.

---

## 3. Worker pipeline (per claim)

```
1. CLAIM:  select N from creative_queue
           order by priority desc, enqueued_at
           for update skip locked limit N         -- instant, no full scan, no races
2. for each hash:
   a. download src_url  (do it FAST — the signed FB url expires)
   b. if 403/expired  → re-resolve: re-crawl ad_archive_id for a fresh url (or mark failed after retries)
   c. VARIANTS (prefer FB-provided over transcoding — see §4):
        image → grid.jpg (resize 338×600 q75, sharp) + orig.jpg
        video → poster.jpg (FB preview frame) + sd.mp4 (FB sd) [+ hd.mp4 optional]
   d. upload each to R2 at the hash-keyed path (skip if already there)
   e. insert creative_assets row (status=stored, urls, dims)
   f. DELETE the creative_queue row
   on error: attempts++ ; attempts≥3 → creative_assets(status=failed) + delete from queue
```

**Enqueue side (at crawl):** when an ad's `image_hash`/`video_hash` is NOT already in `creative_assets`,
insert into `creative_queue` (`ON CONFLICT (hash) DO NOTHING`) with the **fresh** `src_url` + `ad_archive_id`.
Dedup means a creative shared by 50 ads is enqueued once.

---

## 4. Variants — download FB's sizes, don't transcode (CPU saver)

FB's Ad Library already serves a **preview image** + **multiple video resolutions**. Prefer downloading
those over running ffmpeg:
- **Video poster** → download FB's preview frame (no extraction). Tiny, store for ALL videos.
- **Video SD** → download FB's smaller resolution directly (no transcode).
- **Video HD** → download FB's HD only on-demand, or skip (confirm via the Atria query whether SD-only suffices).
- **Image grid size** → the one thing you do generate: `sharp` resize 338×600 (fast, cheap). Or store FB's
  resized variant if it provides one.

ffmpeg transcoding is the expensive path — avoid it by taking FB's provided variants. Only transcode if FB
doesn't supply a small enough version.

---

## 5. The CDN-expiry constraint (the real operational limit)

`src_url` is fresh at crawl but **dies in hours**. So:
- **Drain rate must exceed crawl rate**, or queued URLs expire before download → cascading 403s (this is
  Atria's ~33% gap). Keep the queue drained.
- On expiry (403), **re-resolve via `ad_archive_id`** (re-crawl that one ad for a fresh url) rather than
  losing the creative. That's why the queue stores `ad_archive_id`.
- A trailing backlog is OK (Atria runs ~33% pending), but it can't grow unbounded — monitor
  `queue depth` and `403 rate`; if 403s climb, the queue is draining too slow → add worker concurrency.

---

## 6. Serving rules

| Surface | Image | Video |
|---|---|---|
| **Grid** | `grid_url` (~338×600) **served direct** (no imgproxy) | `poster_url` JPG as background-image — **no mp4** |
| **Detail / hover** | `orig_url` | `sd_url` loaded on play (your CDN, not FB) ; `hd_url` on quality-toggle |
| **Missing/pending** | skeleton placeholder + ensure enqueued | poster if present, else skeleton |

- **Grid never loads video or full-res** → instant, cheap browse.
- **Video = lazy-display of YOUR stored mp4** (no FB refetch → no expiry problem at view time).
- **Serve direct from R2+CDN; skip imgproxy** (you pre-generated grid size — your win over Atria, who
  imgproxy's the original at w:1920 wastefully).

---

## 7. Priority (what downloads first)
`creative_queue.priority` higher for: `is_active`, recent `start_date`, `performance_tier in (winning,
optimized)`, high-`brand_active_ads` brands. So the ads users hit first are ready first; long tail trickles.

---

## 8. Cost shape at 5M
```
5M ads → ~1.5M unique creatives (hash-dedup)
  posters (all videos): tiny (~50KB)  → instant grid, cheap even at 1.5M
  images: grid(338) + orig            → small
  video: SD only (HD skipped/on-demand)→ ~half Atria's video bytes
  = broad + instant + affordable
```

---

## 9. Build order
```
1. creative_assets + creative_queue tables  (+ verify R2 is hash-keyed, not ad_id)
2. Enqueue at crawl: new hash → creative_queue (ON CONFLICT DO NOTHING), with fresh src_url + ad_archive_id
3. Worker: SKIP LOCKED claim from creative_queue → download FB variants → R2 (hash path) → creative_assets → delete queue row
4. 403/expiry → re-resolve via ad_archive_id; retries→failed
5. Serving: grid=grid_url/poster_url direct; detail=orig/sd; lazy mp4 on play; skeleton fallback
6. Priority ordering + queue-depth/403 monitoring
7. Retire the old "UPDATE thumbnail_url on discovery_ads_index" path (kills the bloat + slow-claim for good)
```

This replaces the bloat-and-scan pipeline with a deduped, queue-driven, poster-first one — broad coverage,
instant grid, lazy video from your own CDN, ~4× less storage, and no more 133s claim scans or UPDATE-churn
bloat. It's Atria's proven shape with hash-dedup and serve-resized-direct on top.
```
