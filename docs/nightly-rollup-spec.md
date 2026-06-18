# Nightly Rollup Job Spec

The shared backbone under the **filters**, the **Performance Score**, and the **trends**. One job,
one pass, run nightly in the worker. Everything downstream (Performance tier filter/sort, "Most used",
niche counts, "newly scaling"/"saturating") reads what this produces.

> Capture that must happen in the CRAWL, not here (prerequisites):
> - `first_seen timestamptz default now()` — set on INSERT of a new ad.
> - On crawl-diff, when an ad disappears: `is_active=false`, `end_date = last_seen`.
> The rollup READS these; it can't reconstruct them.

---

## Columns to add (one-time migration)

```sql
alter table discovery_ads_index add column if not exists first_seen timestamptz default now();
alter table discovery_ads_index add column if not exists end_date date;          -- set by crawl-diff
alter table discovery_ads_index add column if not exists creative_reuse_count int default 0;
alter table discovery_ads_index add column if not exists brand_active_ads int default 0;
alter table discovery_ads_index add column if not exists performance_score numeric(4,3) default 0;
alter table discovery_ads_index add column if not exists niche text;

-- Tier auto-derives from score (no need to write it in the job)
alter table discovery_ads_index add column if not exists performance_tier text
  generated always as (
    case when performance_score >= 0.80 then 'winning'
         when performance_score >= 0.60 then 'optimized'
         when performance_score >= 0.40 then 'growing'
         when performance_score >= 0.20 then 'scaling'
         else 'testing' end
  ) stored;

-- Indexes for the new filter/sort paths
create index if not exists idx_ads_perf_tier on discovery_ads_index (performance_tier);
create index if not exists idx_ads_perf_score on discovery_ads_index (performance_score desc);
create index if not exists idx_ads_niche on discovery_ads_index (niche);
create index if not exists idx_ads_reuse on discovery_ads_index (creative_reuse_count desc);
create index if not exists idx_ads_start on discovery_ads_index (start_date);
create index if not exists idx_ads_first_seen on discovery_ads_index (first_seen desc);

-- Niche mapping (seed once from docs/discovery-filters-spec.md §2a)
create table if not exists niche_map (industry text primary key, niche text not null);
```

---

## Step 1 — creative_reuse_count (per ad: reuse of its creative within the brand)

Aggregate first (avoid O(n²) correlated subqueries), then write back.
```sql
create temp table tmp_reuse on commit drop as
select page_id, coalesce(image_hash, video_hash) as ckey, count(*) as reuse
from discovery_ads_index
where coalesce(image_hash, video_hash) is not null
group by page_id, coalesce(image_hash, video_hash);

update discovery_ads_index a
set creative_reuse_count = r.reuse
from tmp_reuse r
where a.page_id = r.page_id
  and coalesce(a.image_hash, a.video_hash) = r.ckey;
```

## Step 2 — brand_active_ads (per brand: # active ads)

```sql
create temp table tmp_brand on commit drop as
select page_id, count(*) filter (where is_active) as active_ads
from discovery_ads_index
group by page_id;

update discovery_ads_index a
set brand_active_ads = b.active_ads
from tmp_brand b
where a.page_id = b.page_id;
```

## Step 3 — performance_score (tier auto-derives from the generated column)

Same formula as the filters spec. Runs AFTER steps 1–2 (it reads their outputs).
```sql
update discovery_ads_index
set performance_score = round(least(1.0, greatest(0.0,
      ( 0.45 * least(1.0, ln(1 + greatest(0, coalesce(days_running,0))) / ln(181))   -- runtime, 180d cap
      + 0.30 * least(1.0, coalesce(creative_reuse_count,0) / 20.0)                   -- reuse, 20 cap
      + 0.25 * least(1.0, coalesce(brand_active_ads,0) / 100.0) )                    -- brand vol, 100 cap
      * (case when is_active then 1.0 else 0.5 end)                                  -- inactive penalty
    )), 3);
-- performance_tier updates itself (generated column).
```

## Step 4 — niche (map granular industries → coarse niche)

```sql
update discovery_ads_index a
set niche = m.niche
from niche_map m
where m.industry = any(a.industries)            -- first matching industry wins; refine priority if needed
  and (a.niche is distinct from m.niche);
update discovery_ads_index set niche = 'Other' where niche is null;
```

## Step 5 — niche_counts (powers "TOP NICHES" ordering)

```sql
create table if not exists niche_counts (niche text primary key, active_ads int, total_ads int, updated_at timestamptz);
truncate niche_counts;
insert into niche_counts
select niche, count(*) filter (where is_active), count(*), now()
from discovery_ads_index group by niche;
```

---

## Step 6 — trend rollups (the moat — small tables the insights read)

**Brand weekly velocity** — powers "newly scaling" / "saturating":
```sql
create table if not exists brand_weekly_stats (
  page_id text, week date, new_ads int, stopped_ads int, active_ads int,
  primary key (page_id, week)
);
truncate brand_weekly_stats;
insert into brand_weekly_stats
select page_id,
       date_trunc('week', d)::date as week,
       count(*) filter (where date_trunc('week', start_date) = date_trunc('week', d)) as new_ads,
       count(*) filter (where end_date is not null and date_trunc('week', end_date) = date_trunc('week', d)) as stopped_ads,
       count(*) filter (where start_date <= d and (end_date is null or end_date > d)) as active_ads
from discovery_ads_index,
     lateral generate_series(date_trunc('week', now()) - interval '12 weeks',
                             date_trunc('week', now()), interval '1 week') as d
group by page_id, date_trunc('week', d);
```
*(Keep the window bounded — last ~12 weeks — so this stays cheap. "Newly scaling" = brand whose
latest-week `new_ads` >> its trailing average. "Saturating" = rising `stopped_ads` / falling `new_ads`.)*

**Niche × angle monthly** — powers "trending angles":
```sql
create table if not exists niche_angle_monthly (
  niche text, angle text, month date, new_ads int,
  primary key (niche, angle, month)
);
truncate niche_angle_monthly;
insert into niche_angle_monthly
select niche, angle, date_trunc('month', start_date)::date as month, count(*)
from discovery_ads_index
where start_date >= now() - interval '12 months' and angle is not null
group by niche, angle, date_trunc('month', start_date);
```

---

## Dependency order (must run in this sequence)

```
1. creative_reuse_count   ─┐
2. brand_active_ads       ─┴─> 3. performance_score (reads 1 & 2; tier auto-derives)
4. niche                  ────> 5. niche_counts (reads 4)
6. trend rollups (read start_date/end_date/niche/angle — independent of 1–3)
```

---

## Scale path (at 1–25M ads)

Full nightly recompute is fine up to ~1–2M rows. Beyond that, go **incremental**:
- Only recompute ads **touched by the last crawl** + their **brand-mates** (same `page_id`), since
  `brand_active_ads`/`creative_reuse_count` only change when a brand's set changes.
- Keep `niche_counts` and trend rollups as full rebuilds (they're tiny — aggregate tables, not 25M rows).
- The 25M-row UPDATES are the cost; scope them with `where page_id in (<brands crawled today>)`.

---

## Scheduling & monitoring

- **Cron:** nightly (after the day's crawl waves settle), in the worker — needs the durable `--env-file`
  (same env-consolidation the classification cron needs).
- **Idempotent:** safe to re-run; every step is recompute-from-source.
- **Admin (System Health):** log last run, duration, rows updated per step, and any step failure.
- **Margin/sanity:** after run, spot-check tier distribution (e.g. ~5–10% Winning is healthy; if 50% are
  Winning, the cut-points are too loose — tune against the search eval).
```
