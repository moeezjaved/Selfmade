# SEO Department — Design Spec

**Date:** 2026-08-23
**Status:** Design (for review) → phased build
**One-liner:** The autonomous SEO team — "50 AI agents for SEO" as a real product. Audits a brand's site, finds the keywords worth winning, and (the flagship) runs **Programmatic SEO** — generating + publishing SEO pages at scale to each connected Shopify store, then tracking the rankings it earns.

Sibling to the shipped **GEO department** (`geo`) and the **Growth Plan** Lever engine. Same spine: a department + agent-router branch + a `/mission/seo` surface + `mello_tasks` execution + approve-mode.

---

## 1. The 50 agents = 7 clusters

Fifty micro-bots is unbuildable; fifty *tasks* across seven clusters is. Each cluster is one engine; the named agents are its capabilities.

| # | Cluster | Named agents it covers | Output | Dependency |
|---|---|---|---|---|
| 1 | **Keyword & Intent** | keyword-clustering, search-intent, striking-distance, topic-gap, competitor-delta, entity-coverage | ranked keyword targets + gaps | **keyword/SERP API** |
| 2 | **Content Ops** | content-brief, content-QA, title-CTR, meta-rewrite, featured-snippet, people-also-ask, content-decay, refresh-priority | briefs + optimized page copy | Shopify (to publish) |
| 3 | **Programmatic SEO** ⭐ | programmatic-page | pages at scale from a dataset → published | **Shopify** + a dataset |
| 4 | **Technical SEO** | technical-audit, crawl-budget, redirect-chain, canonical, core-web-vitals, log-file, index-bloat, sitemap, 404-recovery, pagination, hreflang, image-SEO, video-SEO | a crawl audit + fixes | site crawl (have) |
| 5 | **Links & Authority** | internal-link, orphan-page, cannibalization, link-prospecting, outreach-writer, digital-PR, toxic-link, anchor-text, author-entity, EEAT | internal-link map + outreach drafts | site crawl + Off-site (have via GEO reach) |
| 6 | **Local SEO** | local-SEO, GBP-optimizer, review-response | GBP + local pages | GBP data (later) |
| 7 | **Measurement** | rank-tracking, GSC-query-miner, traffic-drop-detective, algorithm-watch, forecast, reporting, SEO-roadmap | the scoreboard + roadmap | **Google Search Console** (have `gsc.ts`, mig 157) |

## 2. Programmatic SEO — the flagship

The one that makes this a *product*, not an audit. For a connected Shopify brand:
1. **Pick a template pattern** — e.g. `best {category} for {use-case}`, `{product} vs {competitor}`, `{product} for {audience}` — from the brand's products + the Keyword cluster's terms.
2. **Generate the page set** — the LLM writes each page (unique, genuinely useful, schema'd, internally linked), grounded in the brand + its real products. Honesty rule: no thin/spun doorway pages — each must genuinely answer its query.
3. **Publish to Shopify** — as blog articles / pages via the Admin API, with `published_url` tracked. Approve-mode: the founder approves the batch.
4. **Track** — Measurement cluster watches GSC for the impressions/clicks each page earns; Content-decay flags ones to refresh.

Opt-in + Shopify-gated, as specified.

## 3. Fit with the existing spine (reuse, no rewrite)

- **New department** `seo` in `departments.ts` (emoji 🔎, Marketing, `unlockedBy: 'Shopify + Search Console'`).
- **Agent router** branch → an SEO move resolves to a concrete SEO task (audit / keyword-plan / write-page / publish) → `runTask` (credits, approve-mode inherited).
- **Growth-plan Lever**: the existing `seo` lever's `delta` becomes real once the Keyword cluster + GSC give true volumes/positions.
- **Reuse**: GEO's `describeBrand` (brand understanding), the GEO **Off-site reach** (for link-prospecting/outreach), the site reader (`readLanding`/Jina), `gsc.ts` + `seo_rank_history` (mig 157) for measurement, the `geo_assets`-style asset model for drafts.

### New tables (one migration, `160_seo.sql` — apply crawl-paused)
```
seo_keywords     brand_id, keyword, intent, volume?, difficulty?, position?, cluster, source, created_at
seo_pages        brand_id, kind ('programmatic'|'answer'|'brief'), title, slug, target_keyword,
                 body_markdown, status (draft|approved|published), shopify_article_id, published_url
seo_audit        brand_id, score, issues jsonb (technical findings), pages_crawled, created_at
```
(Rank history reuses the existing `seo_rank_history`.)

## 4. Dependencies — what makes each cluster real vs advisory

1. **Keyword/SERP data** (cluster 1, and honest SEO math) — DataForSEO / SE Ranking / Serper. Without it, no real volumes/difficulty/competitor positions. **The keyword clusters are guesses until this lands.**
2. **Shopify OAuth** (clusters 2, 3) — publish pages + apply on-page fixes. Programmatic SEO *cannot ship pages* without it.
3. **Google Search Console per brand** (cluster 7) — real impressions/clicks/positions. We have `gsc.ts` (service-account, own site); customer brands need their own GSC connected (an OAuth).
4. **Site crawl** (cluster 4, 5) — we can fetch pages now (`readLanding` pattern); a light crawler covers technical audit + internal links **with no new key**.

## 5. Honesty rules (non-negotiable)
- Programmatic pages are **genuinely useful**, never thin/spun doorway pages — each must answer its query for a human.
- Volumes/positions are **real** (from the keyword API / GSC) or clearly labelled estimates — never invented.
- Publishing + on-page changes are **approve-mode**; the founder approves the batch.
- Outreach/PR is **draft → founder sends** (same as GEO off-site), never fake.

## 6. Phased build

- **Phase 1 — Technical SEO Audit (dependency-free).** Crawl the brand's site (sitemap + N pages), report real issues: missing/duplicate titles + metas, missing H1, no schema, broken links, thin content, canonical problems, slow pages. This is the "audit your website" core — needs **no external key**. Ships value + the crawler other clusters reuse.
- **Phase 2 — Keyword & Content brain.** Wire a keyword/SERP API → keyword clustering + intent + striking-distance + content briefs (drafts). Makes the SEO growth-lever real.
- **Phase 3 — Programmatic SEO + Shopify publish.** Generate the page set + publish to Shopify (needs Shopify OAuth). The flagship goes live.
- **Phase 4 — Measurement (GSC) + Links/Authority + Local.** Rank tracking, query miner, traffic-drop; internal-link map + outreach (reuse GEO reach); local/GBP.
- **Later — the "SEO audit your website" theater** (the lead-magnet funnel), once the audit engine is proven.

## 7. Open questions for review
1. **Sequencing vs Shopify:** Programmatic SEO (the flagship) *needs* Shopify OAuth. Build the SEO brain (Phase 1–2, no Shopify) first, then Shopify, then Programmatic (Phase 3)? Or Shopify first so Programmatic ships sooner?
2. **Keyword data provider:** DataForSEO (cheap, comprehensive) vs Serper (cheap SERP) vs Exa (already discussed). Pick one for Phase 2.
3. **GSC connection:** per-brand GSC OAuth now, or start Measurement on the site crawl + rank-tracking API only?
