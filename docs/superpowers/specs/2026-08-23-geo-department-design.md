# GEO Department — Design Spec

**Date:** 2026-08-23
**Status:** Design (for review) → phased build after approval
**One-liner:** Turn "50 AI agents for GEO" from a lead-magnet slide into a real product a customer *joins* — an autonomous engine that gets a DTC brand cited in AI answers (ChatGPT, Claude, Perplexity, Google AI Overviews) and publishes the content that earns those citations.

---

## 1. Positioning — theater is the hook, joining is the product

- **The theater** (reuse /scan): show the founder they're *invisible* in AI — "when someone asks ChatGPT 'best nicotine alternative,' you're not mentioned; your rival is cited 4×." This is acquisition (mirrors the Ryze "Comment Agent" loop + our own LinkedIn lead-magnet loop).
- **After they join:** the GEO engine runs continuously — tracks their AI visibility over time, and produces + publishes the assets that move it. Not a demo; a working department.

**North-star fit:** GEO is one **Lever** in the growth plan (`Revenue = Traffic × CVR × AOV` → GEO drives *organic + AI-referred Traffic*). It already has a card in `/mission/plan`; this spec makes it real.

## 2. The 50 agents = 6 clusters (buildable)

Fifty microservices is unbuildable. Fifty *tasks* across six agent clusters is. Each cluster is one engine; the "50 agents" are its named capabilities (honest — each maps to a real task).

| # | Cluster | Named agents it covers | Output | Dependency |
|---|---|---|---|---|
| 1 | **Visibility Monitor** | AI citation tracker, ChatGPT/Perplexity/Claude/AI-overviews visibility, prompt coverage, answer gap, share of voice, competitor citation, hallucination watch, prompt testing, consensus monitor, AI traffic analytics, referral tracking, GEO audit | A tracked score + prompt-by-prompt cited/not-cited vs rivals, over time | LLM query budget |
| 2 | **Answer Content** | FAQ, comparison-page, alternative-page, best-of-listicle, quotable-line, original-data, survey-builder, expert-quote, statistic-seeding, citation-source | Published pages AI cites | Shopify blog (publish) |
| 3 | **Crawlability** | LLMs.txt, schema-depth, chunk-optimizer, passage-ranking, crawler-access, bot-log-analyzer, freshness-signal, FAQ-structuring | Files/markup + checklist applied to the site | Site access (Shopify theme) |
| 4 | **Entity & Authority** | Entity-graph, knowledge-panel, Wikipedia-signal, Wikidata-sync, brand-fact-sheet, about-page, author-entity, topical-authority | Structured entity data + advisory playbook | Partly advisory |
| 5 | **Off-site Presence** | Reddit, Quora, review-platform, G2, directory-sync, PR-placement, podcast-mention, YouTube-answer | Drafted answers/profiles; posted via connectors or by the founder | Connectors (some via Unipile) |
| 6 | **Audit & Roadmap** | GEO-audit, GEO-roadmap | The orchestrator: scores the brand, sequences clusters 1–5 into a prioritized plan | — |

## 3. Architecture — fits the existing spine, no rewrite

- **New department** `geo` in `src/lib/company/departments.ts` (emoji 🛰️, division Marketing, `unlockedBy: 'Shopify + LLM budget'`). Its `taskKinds` = the GEO task kinds below.
- **Agent router** (`agents.ts`): add a `geo` alias + a `routeStrategistTask` branch so a GEO move resolves to a concrete GEO task (audit / write-answer / publish / fix-schema) → runs through the existing `runTask` spine (credits, approve-mode, dedupe inherited).
- **Growth-plan Lever**: the existing `geo`/`seo` lever's `delta` becomes real once the Monitor has a baseline (share-of-voice → estimated capturable AI traffic).
- **Reuse**: /scan's LLM-mention checks (Monitor), Creative + the auto-blog engine (Content), Brand Guardian's Reddit read (Off-site), the `mello_tasks` spine (execution), approve-mode (publishing).

### New task kinds (mello_tasks)
`geo_audit`, `geo_monitor` (scheduled), `geo_answer` (write+publish a page), `geo_schema` (generate+apply markup), `geo_offsite` (draft an answer/profile). Each runnable through `runTask`.

## 4. Data model (new tables)

```
geo_prompts        the questions we track per brand
  id, brand_id, prompt_text, intent ('commercial'|'informational'), created_at, active

geo_checks         one run of one prompt against one engine (the tracking history)
  id, brand_id, prompt_id, engine ('chatgpt'|'claude'|'perplexity'|'gemini'|'ai_overview'),
  cited boolean, position int|null, competitors_cited text[], answer_excerpt text,
  cost_usd numeric, checked_at
  → share-of-voice + "climbing over time" chart come from aggregating this

geo_assets         content the Content cluster produces
  id, brand_id, kind ('answer_page'|'faq'|'comparison'|'listicle'|'schema'|'llms_txt'),
  title, target_prompt, body_markdown, status ('draft'|'approved'|'published'|'failed'),
  shopify_article_id text|null, published_url text|null, created_at

geo_audit          the roadmap snapshot
  id, brand_id, score int, share_of_voice numeric, gaps jsonb, roadmap jsonb, created_at
```

Migration gated behind the pause-before-DDL rule (crawl paused / drain before applying).

## 5. Cluster 1 — Visibility Monitor (the join hook, ships first)

- **Prompt set:** derive 15–30 target prompts per brand from its niche + competitors (e.g. "best nicotine alternative", "quit vaping without gum", "Füm vs Aura"). Founder can edit.
- **The run:** for each prompt × engine, ask the real model (LLM APIs we already use; Perplexity API; AI Overviews via SERP). Parse: is the brand cited? which competitors are? position/excerpt. Write a `geo_checks` row.
- **The score:** *Share of voice* = your citations ÷ total brand citations across the prompt set. Tracked over time → the "climbing" chart. Answer gaps = prompts where rivals are cited and you're not (these become Content cluster tasks).
- **Cost honesty:** each full sweep is N prompts × M engines LLM calls. Budget-gated: default weekly sweep, cost estimated up front, cheaper models for the parse step. **This is the main running cost — must be metered per plan.**

## 6. Cluster 2 — Answer Content → publish to Shopify blog

- For each **answer gap**, the Content agent writes the page most likely to earn a citation: direct-answer-first structure, quotable stats, FAQ schema, comparison tables — the format LLMs lift from.
- **Publish target = the customer's Shopify blog** (chosen): `POST /admin/api/blogs/{id}/articles` via Shopify Admin API → real page on *their domain* (best authority). Store `shopify_article_id` + `published_url` on `geo_assets`.
- **Approve-mode:** draft → founder approves → publish. Never auto-publish without a yes.
- **The loop closes:** after publishing, the Monitor re-checks the target prompt over the next weeks → the founder sees "cited" flip from ✗ to ✓ → that's the product proving itself.

## 7. Clusters 3–5 (later phases)

- **Crawlability:** generate `llms.txt`, JSON-LD schema, FAQ markup → apply to the Shopify theme (needs theme write scope) or hand as a checklist. Bot-log/crawler-access = advisory reports.
- **Entity & Authority:** generate a brand fact sheet, about/author entity data, Wikidata-ready structured data; knowledge-panel/Wikipedia are advisory (can't self-edit Wikipedia — honest).
- **Off-site Presence:** draft Reddit/Quora answers, G2/directory profiles, PR angles; posting via connectors where we have them (Unipile), else the founder posts. **Honest:** we draft; we don't fake reviews or astroturf.

## 8. Theater → join flow

1. `/scan`-style GEO theater: enter brand → live "you're not cited in ChatGPT/Claude/Perplexity for these 10 prompts; rival X is cited 6×" → a GEO score.
2. Gate the full report + continuous tracking behind **join** (existing paywall pattern from the scan funnel).
3. On join: seed `geo_prompts`, run the first `geo_audit`, show the roadmap, start the weekly Monitor.

## 9. Dependencies (what makes it real vs a slideshow)

1. **Shopify OAuth** (blog publish + theme scope) — shared with growth-plan Phase 2. *Blocks Content publishing; Monitor works without it.*
2. **LLM/Perplexity/SERP query budget** — the metered running cost of Monitoring. Needs per-plan limits + cost display.
3. **Off-site connectors** — Unipile covers some; rest are draft-and-hand-off. No fake posting, ever.

## 10. Honesty rules (non-negotiable)

- Citations are **really checked** against live models and stored with the answer excerpt — never asserted.
- Share-of-voice and "climbing" charts are computed from `geo_checks` history, not projected.
- We **draft** off-site content; we never post fake reviews or impersonate.
- Wikipedia/knowledge-panel work is labeled **advisory** (we can't self-edit).
- Every publish is approve-mode.

## 11. Phased build (each ships value alone)

- **Phase A — Visibility Monitor + GEO theater.** Prompt set + multi-engine citation checks + share-of-voice + the tracked chart + the join hook. Reuses /scan. *No new integration required.* Ships the "join to watch your AI visibility" product.
- **Phase B — Answer Content + Shopify publish.** (After Shopify OAuth lands.) Answer-gap → write → approve → publish to their blog → Monitor confirms the citation flips. This is the revenue-driving loop.
- **Phase C — Crawlability + Entity + Off-site.** Rounds out the 6 clusters.

## 12. Open questions for review

1. **Monitor cadence + budget:** weekly sweep default? Cost ceiling per plan tier?
2. **Prompt-set size:** 15 / 30 / founder-defined? (drives cost)
3. **Shopify scope:** blog-only first, or blog + theme (for schema/llms.txt) together?
4. **Theater placement:** a new `/scan?mode=geo`, or a dedicated `/geo` funnel?
