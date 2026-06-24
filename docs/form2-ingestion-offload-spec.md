# Form 2 — Ingestion ↔ Serving Split (spec for the build tab)

**Problem:** crawl/drain/rollup writes and user-facing serving reads contend on one Supabase MEDIUM
box → serving is slow and the DB maxes out, capping crawl concurrency. **Goal:** move all
high-volume crawl WRITES off the serving DB so (a) search serves in 1–2s like Atria regardless of
crawl load, and (b) the crawler can run flat-out (conc 24+) toward 5M without choking Supabase.

> Do the cheap wins FIRST. (1) sort indexes 036/038 — DONE 2026-06-24 (12s→sub-second). (2) read
> replica (`SUPABASE_READ_URL`, code already shipped via `createReadClient`) isolates serving reads.
> Build Form 2 only once conc-24 write load actually maxes the primary. This spec is the durable
> endgame, not the first move.

## Target architecture
```
[Droplet(s): crawler + drain + rollup] --writes--> [INGESTION DB]
                                                         |
                                          sync worker (delta, every ~2–5 min)
                                                         v
[users / app] --reads--> [SERVING DB = Supabase]  <-- upsert serving-ready slice
```
- **Ingestion DB:** all crawl writes land here. Re-crawlable data → LOW durability bar (a dead
  ingestion DB = re-crawl, not data loss). This is why droplet-PG is acceptable here.
- **Serving DB (Supabase):** read-only for crawl data + read/write for USER data. Never receives a
  crawl write again.

## Table classification
**Move to ingestion (write-heavy, crawl-owned):**
- `discovery_ads_index` (1.4M+ rows, the hot insert/update path)
- `discovery_creatives` (drain writes R2 URLs)
- `creative_queue` (drain claim queue — migration 030/034)
- `discovery_brand_crawl_state` (crawl-state: cursor, ads_indexed, soft_gate_at, …)
- `discovery_crawl_terms` (brand queue + claim: crawling_at, last_crawled_at, full_crawled_at)
- `crawler_runs` (run logs)
- nightly rollup outputs (performance_score, niche, performance_tier on discovery_ads_index)

**Stay on Supabase (user-owned, low write volume — NOT the bottleneck):**
- auth, `credit_transactions`, `credit_pricing`, boards, saved ads, following, `meta_accounts`,
  any Mello/agent tables. These keep read+write on Supabase.

**Synced ingestion→serving (serving needs a read copy):**
- `discovery_ads_index`, `discovery_creatives`, `discovery_brand_crawl_state`. The serving copy is
  what `db-search` / brand-spy / discovery read. Slightly stale (sync lag) is fine for ad discovery.

## Sync mechanism — watermark delta ETL (the real engineering)
Logical replication INTO Supabase isn't reliable (managed subscriber). Use a **batched delta sync
worker** on the droplet:
1. Each synced table needs a monotonic change marker. `discovery_ads_index` already has
   `last_seen` / `indexed_at`; add `updated_at timestamptz default now()` + a trigger to bump it on
   UPDATE if not present. Keep a `sync_state(table, last_watermark)` row in ingestion.
2. Loop per table: `SELECT … WHERE updated_at > last_watermark ORDER BY updated_at LIMIT 5000`,
   upsert the batch into Supabase (`onConflict` = pk), advance the watermark to the max row's
   `updated_at`. Repeat until a batch returns < limit. Sleep ~2–5 min, go again.
3. Deletes: crawl rarely hard-deletes ads; for `discovery_crawl_terms` removals (1-strike junk),
   either skip syncing terms (serving doesn't need the queue) or tombstone. **Serving doesn't need
   `discovery_crawl_terms`/`creative_queue`/`crawler_runs` at all** — only ads + creatives + state.
4. Batched + keyset = sidesteps the 8s PostgREST timeout (same pattern as the nightly rollup,
   [[project_discovery_filters_rollup]]). Idempotent: re-running a batch just re-upserts.

## Cutover order (zero-downtime)
1. Provision ingestion DB; run ALL migrations on it (it gets the same crawl schema).
2. One-time backfill: bulk copy current Supabase crawl tables → ingestion (pg_dump of those tables
   → restore, or COPY). Now ingestion is a full mirror.
3. Flip crawl/drain/rollup connection env (worker `SUPABASE_URL`/PG conn) → ingestion DB. Crawl now
   writes ONLY to ingestion. **Supabase stops receiving crawl writes from this moment.**
4. Start the sync worker (ingestion→Supabase). Supabase serving data stays fresh (minus sync lag).
5. Serving app unchanged (reads Supabase / its replica). Verify search still returns rows.
6. Monitor: ingestion write health, sync lag (max(updated_at) ingestion vs serving), row counts match.

**Rollback:** point crawl env back at Supabase, stop sync worker. Supabase resumes direct writes
(it was a superset). No data loss because the backfill + sync kept it current.

## Variants — pick on ops appetite
- **2a — droplet-PG (cheapest, you own ops):** Postgres on a **dedicated small DB droplet**
  (~$24–48/mo; do NOT co-locate on the crawler droplet — PG wants its own RAM/IO and the crawler is
  CPU-bound). Durability bar is low (re-crawlable) so a **daily `pg_dump` → R2** is sufficient
  backup. You own vacuum tuning (you already did this work for Supabase).
- **2b — managed (a bit more $, near-zero ops):** ingestion on **Neon** (serverless PG, autoscaling,
  branching, managed backups) or a 2nd Supabase project. No 3am vacuum/backup duty. For a solo
  budget-but-time-constrained founder this is usually the right trade.

**Recommendation:** start **2b (Neon)** if you value time over the ~$20–40/mo delta — it removes the
durability/vacuum ownership entirely and the sync worker is identical. Drop to **2a** only if every
dollar matters more than ops hours.

## Risks / gotchas
- **Schema drift:** every future migration must run on BOTH DBs. Add a deploy checklist line.
- **Sync lag:** serving is N min behind. Fine for discovery; surface "data as of" (brand-spy already
  does). Tighten the loop if needed.
- **Don't sync the queue tables:** `discovery_crawl_terms` (claim churns `crawling_at` constantly —
  syncing it would be pure noise). Serving never reads it.
- **RLS:** synced crawl tables use the service role on serving (same as today). User-table RLS
  unaffected — they never left Supabase.
- **Then, and only then, droplet #2:** with writes off Supabase, a 2nd crawler's doubled writes hit
  the ingestion DB (cheap/scalable), not the serving box. That's when [[project_multi_droplet_scaling]]
  becomes a clean 2× win.
