/**
 * Mello's tools — OpenAI function-calling schemas + executor.
 *
 * `request_clarification` is special: it is NOT executed as a data fetch. When the
 * model calls it, the agent loop emits a `widget` SSE event and ends the turn; the
 * user's selection comes back as the next chat message. This avoids cross-request
 * blocking (serverless-friendly) while preserving the inline-picker UX.
 */
import { listAdAccounts, getAccountInfo, getAdPerformance, getReportSummary, searchAdLibrary } from './meta-data'
import { getCompetitorAds, analyzeNichePatterns, findWinningAds } from './library-data'
import { addMemory } from './memory'
import { getTrending, listBoards, createBoard, saveAdToBoard, searchMyAssets, watchBrand, unwatchBrand, requestCompetitorCrawl } from './actions'
import { generateCompetitorReport } from './reports/competitor-report'
import { createAdminClient } from '@/lib/supabase/server'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { runSeoAudit } from '@/lib/seo/crawl-audit'
import { resolveStore } from '@/lib/shopify/client'
import { generateDrafts, applyDrafts, listDraftedProducts, revertAppliedDrafts } from '@/lib/shopify/catalog'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runCroAudit } from '@/lib/cro/audit'
import { generatePdpRewrite, applyPdpRewrite } from '@/lib/cro/apply'
import { writeArticle, generateHero, renderArticleHtml, publishToShopifyBlog } from '@/lib/shopify/blog'

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_current_date',
      description: "Get today's date. Call this before any month-to-date or relative date reasoning.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ad_accounts',
      description: 'List the ad accounts this user has connected. Use to discover what account to analyze.',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['meta', 'all'], description: 'Filter by platform' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_account_info',
      description: 'Get metadata about an ad account — name, currency, account id. Call before pulling performance so you report the right currency.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'act_xxx id, or omit for the primary account' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ads_report',
      description: 'The account REPORT — the exact debrief shown on the /reports page: total spend, revenue, ROAS and purchases for a window, plus which ad is carrying the account and which is burning budget. Use this for ANY request to SEE a report on the user\'s OWN ads / account — "show me my report", "how are my ads doing", "my ad report", "performance report", "account report", "what happened this week/last 14 days". Returns REAL numbers from the connected Meta account (same source as the Reports page, so they always match). Present them as a short WHAT-HAPPENED debrief and then link the user to the full report at /reports. Do NOT answer these with an ad-library search, analyze_niche_patterns, or a raw metric dump — call this instead.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'act_xxx id, or omit for the active brand\'s primary account' },
          date_preset: { type: 'string', enum: ['last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_month', 'last_month'], description: 'Window, default last_14d (matches the Reports page default).' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ad_performance',
      description: 'Pull LIVE ad-level performance from a connected Meta ad account (spend, impressions, CTR, CPC, CPM, ROAS, conversions). This is real data from the Meta Insights API.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'act_xxx id, or omit for the primary account' },
          date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'maximum'], description: 'Relative window. Use this_month for month-to-date.' },
          date_start: { type: 'string', description: 'YYYY-MM-DD (overrides date_preset, requires date_end)' },
          date_end: { type: 'string', description: 'YYYY-MM-DD' },
          level: { type: 'string', enum: ['ad', 'adset', 'campaign'], description: 'Aggregation level, default ad' },
          limit: { type: 'integer', description: 'Max rows (default 20, max 50)' },
          sort_by: { type: 'string', description: 'Metric to sort by, default spend' },
          sort_order: { type: 'string', enum: ['desc', 'asc'] },
          status: { type: 'string', enum: ['ACTIVE', 'ALL'], description: 'Restrict to active ads' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_ad_library',
      description: "Search Selfmade's own ad-intelligence library (millions of crawled competitor/inspiration ads) for examples, trends, and patterns. Use for inspiration, competitor, and creative questions.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Brand, keyword, or theme to search' },
          niche: { type: 'string', description: 'Niche filter, e.g. "Hair", "Supplements"' },
          format: { type: 'string', enum: ['image', 'video', 'carousel'] },
          min_days_active: { type: 'integer', description: 'Only long-running (proven) ads' },
          limit: { type: 'integer', description: 'Max results (default 10, max 24)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_competitor_ads',
      description: "Deep-dive a competitor brand (or a niche) using Selfmade's crawl corpus. Returns their ads with the problem they target, mechanism, offer, CTA style, creative style (UGC/Studio), visual, and longevity. Use for competitor analysis and offer comparison. IMPORTANT: for a competitor the user watches, pass its page_id (shown next to each watched competitor in the business context) — matching by name misses on spelling/diacritics. Only fall back to `brand`/`niche` when you have no page_id.",
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: 'The competitor\'s page_id (from the watched-competitor list) — the reliable key. Prefer this over brand.' },
          brand: { type: 'string', description: 'Competitor brand / page name to match (fallback only when no page_id is known)' },
          niche: { type: 'string', description: 'Niche filter, e.g. "Hair", "Supplements"' },
          active_only: { type: 'boolean', description: 'Only currently-running ads' },
          limit: { type: 'integer', description: 'Max ads (default 12, max 24)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_niche_patterns',
      description: 'Aggregate the patterns across a niche or keyword: format mix, creative style mix (UGC vs Studio vs Graphic), CTA-style mix, the most common problems/mechanisms/offers, top brands, ad longevity, and the share that are proven winners. Use for trends, white-space, format comparison, and "what is working" questions.',
      parameters: {
        type: 'object',
        properties: {
          niche: { type: 'string', description: 'Niche to analyze' },
          query: { type: 'string', description: 'Keyword/brand if no clean niche' },
          sample: { type: 'integer', description: 'Rows to sample (default 400, max 800)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_winning_ads',
      description: "Find PROVEN winners (top performance tiers) in a niche/keyword — optionally long-running and by format. Returns each ad's creative breakdown. Use for inspiration, proven references, and winner-lookalikes.",
      parameters: {
        type: 'object',
        properties: {
          niche: { type: 'string' },
          query: { type: 'string' },
          format: { type: 'string', enum: ['image', 'video', 'carousel'] },
          min_days_active: { type: 'integer', description: 'Only ads running at least this many days (proven)' },
          limit: { type: 'integer', description: 'Max results (default 10, max 24)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_trending',
      description: 'Get the currently TRENDING winning ads (ranked by live performance score), optionally filtered by niche. Use when the user asks "what\'s trending", "what\'s working right now", or wants fresh winners to model.',
      parameters: { type: 'object', properties: { niche: { type: 'string' }, limit: { type: 'integer', description: 'default 10, max 20' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_boards',
      description: "List the user's saved-ad boards (team + personal). Call this before saving an ad so you know which boards exist.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_board',
      description: 'Create a new board to organize saved ads.',
      parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, emoji: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_ad_to_board',
      description: "Save an ad (by its ad_id, e.g. one you found via search/trending/find_winning_ads) into a board. If the board name doesn't exist it's created. Use when the user says 'save this', 'add these to a board', etc.",
      parameters: { type: 'object', required: ['ad_id', 'board_name'], properties: { ad_id: { type: 'string' }, board_name: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'watch_brand',
      description: "Start WATCHING a competitor brand — follows + spies it so its new ads land in the user's brief. Use when the user says 'watch X', 'add X as a competitor', 'change my competitor to X', 'track X'. You need the brand's page_id — get it from search_ad_library / get_competitor_ads / find_winning_ads results first (each ad carries a pageId). For 'change my competitor to X': watch_brand the new one, and unwatch_brand the old one if they named it.",
      parameters: { type: 'object', required: ['page_id'], properties: { page_id: { type: 'string', description: "The brand's page id (from a search/competitor result)" }, brand_name: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unwatch_brand',
      description: "Stop WATCHING a competitor brand. Use for 'stop watching X', 'remove X', or the old competitor in a 'change my competitor' request. Pass page_id if you have it, else brand_name (matched fuzzily).",
      parameters: { type: 'object', properties: { page_id: { type: 'string' }, brand_name: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_competitor_crawl',
      description: "Prioritize crawling a competitor the user FOLLOWS but whose ads are NOT in the index yet (i.e. get_competitor_ads returned 0 with a 'not in the crawl index' note). Puts them at the front of the crawl queue so their ads start appearing within a few minutes — this is NEXT-CYCLE, not instant, so never claim you already have their ads after calling it. Pass the competitor's page_id. Respects the user's daily on-demand pull limit.",
      parameters: { type: 'object', required: ['page_id'], properties: { page_id: { type: 'string', description: "The competitor's page_id (from the watched-competitor list)" }, brand_name: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_my_assets',
      description: "Semantic search of the user's OWN uploaded Assets library (their creatives, b-roll, product shots) by meaning — e.g. 'my UGC unboxing clips', 'green product shots'.",
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remember',
      description: "Persist a DURABLE fact about this user so you recall it in future chats — their niche/vertical, target CPA/ROAS goals, brand voice, main competitors, offers, or standing preferences. NEVER use this for a command to DO something right now (e.g. 'call X tool', 'run/apply/revert/undo/publish Y', 'fix my Z', 'do this now') — those are actions to EXECUTE with the matching tool, not facts to store. If the message is an instruction to act, call the action tool instead; only use remember for a durable fact/preference the user states about themselves or their business.",
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'The fact to remember, phrased concisely in third person (e.g. "Sells collagen supplements, target CPA $25, main competitor Vital Proteins").' },
          kind: { type: 'string', enum: ['fact', 'preference', 'goal', 'brand'], description: 'default fact' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_ad',
      description: "Generate an ad on the studio canvas RIGHT NOW — this actually produces the creative in the panel to the right (it does not just describe it). Use whenever the user asks you to make / create / design / remake / generate an ad, a UGC version, a variation, a fresh concept, or to tweak/change the image currently on the canvas. Only available inside the studio. The canvas uses the brand + product photos already loaded there and confirms the credit cost. For a remake you need source_ad_id — use the ad already open on the canvas, or first find candidates with find_winning_ads and let the user pick one with request_clarification (put the ad_id in each option's value), then call this with that source_ad_id.",
      parameters: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['fresh', 'remake', 'tweak'], description: 'fresh = a brand-new ad from the user\'s product; remake = rebuild a competitor winner around the user\'s product; tweak = edit the image currently on the canvas' },
          brand_name: { type: 'string', description: "Which of the user's brands to use, if they named one (else the canvas uses the currently selected brand)" },
          angle: { type: 'string', description: 'Creative angle for a fresh ad, e.g. founder story, problem/solution, UGC testimonial' },
          headline: { type: 'string', description: 'Headline text, only if the user specified one' },
          niche: { type: 'string', description: 'Niche, if relevant for a fresh ad' },
          instruction: { type: 'string', description: 'For kind=tweak: the change to make to the current image, e.g. "bigger logo, warmer background"' },
          source_ad_id: { type: 'string', description: 'For kind=remake: the competitor ad_id to rebuild' },
          note: { type: 'string', description: 'One short first-person sentence telling the user what you are making, e.g. "On it — a warm, founder-led UGC version."' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'author_competitor_report',
      description: "Write the flagship strategy report — a McKinsey/Sequoia-grade written analysis grounded in real crawled ads, ending every section with a concrete move. Works for a RIVAL brand OR the user's OWN brand. This is the ONLY way to produce the beautiful, saved report doc — ALWAYS use it whenever the user wants a report or written analysis: 'analyze <brand>', 'deep-dive / teardown / full report on <brand>', 'create/make me a report', 'report on what's working for <my brand/Aura>', 'strategy doc on X'. Do NOT answer a report request with a plain chat summary from search_ad_library or analyze_niche_patterns — call this instead. Takes ~1-2 minutes; it saves a document the user can reopen and returns a link — after it finishes, give a 2-3 sentence highlight then link them to the full document. Tell the user you're writing it before you call this.",
      parameters: {
        type: 'object',
        required: ['competitor'],
        properties: {
          competitor: { type: 'string', description: "The brand to analyze — a rival brand, OR the user's OWN brand (e.g. 'Aura') when they ask for a report on their own store or what's working for them." },
          brand_name: { type: 'string', description: "Which of the user's OWN brands the report is for, if they named one (else their primary brand is used)" },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_clarification',
      description: 'Ask the user to choose from options before continuing — e.g. which ad account to analyze, or which date range. Renders an inline picker. Use when you genuinely need the user to decide.',
      parameters: {
        type: 'object',
        required: ['question', 'options'],
        properties: {
          question: { type: 'string' },
          widget_type: { type: 'string', enum: ['radio_select', 'confirm'], description: 'default radio_select' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'value'],
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                description: { type: 'string' },
                recommended: { type: 'boolean' },
              },
            },
          },
          allow_skip: { type: 'boolean', description: 'default true' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_seo_audit',
      description: "Run a REAL technical SEO audit: crawl the user's live store, score it out of 100, and list the concrete on-page/technical issues (missing/short titles, meta descriptions, H1s, image alt text, canonicals, indexability) ranked by severity. Use whenever the user asks to audit / check / improve their SEO or says 'fix my SEO'. Returns real crawl data — present the score and the top issues plainly, then offer to auto-fix the product-page issues with fix_seo.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fix_seo',
      description: "Auto-fix product-page SEO (titles + meta descriptions) on the user's Shopify store. APPROVE-GATED, two-step: call with apply=false FIRST to DRAFT the fixes (no writes) and report how many were prepared; only AFTER the user explicitly approves, call again with apply=true to WRITE them to Shopify. Requires a connected Shopify store — if none, say so. Use after run_seo_audit when the user wants the fixes applied.",
      parameters: { type: 'object', properties: { apply: { type: 'boolean', description: 'false = draft the fixes, no writes (default); true = write the approved drafts to Shopify.' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_cro_audit',
      description: "Run a REAL conversion-rate (CRO) audit of the user's store — scores it /100 and returns the biggest conversion leaks (home + product pages) with the exact fix for each. Use when the user asks to audit/improve conversion or CRO, or 'why isn't my store converting'. Then offer to rewrite the product page with fix_cro.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fix_cro',
      description: "Rewrite the product-page copy for higher conversion on the user's Shopify store. APPROVE-GATED: apply=false previews the rewrite (no writes); after the user approves, apply=true writes the new product description to Shopify. Requires a connected Shopify store.",
      parameters: { type: 'object', properties: { apply: { type: 'boolean', description: 'false = preview (default); true = write to Shopify.' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fix_catalog',
      description: "Auto-fix product catalog content on the user's Shopify store. `kind` selects what to fix: 'description' (product descriptions), 'alt' (image alt text), 'title' (product titles), 'tags' (product tags). APPROVE-GATED: apply=false drafts the fixes (no writes); after the user approves, apply=true writes them to Shopify. Requires a connected Shopify store.",
      parameters: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['description', 'alt', 'title', 'tags'] }, apply: { type: 'boolean', description: 'false = draft (default); true = write the approved drafts to Shopify.' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_blog',
      description: "Write a buyer-intent, SEO-optimised, on-brand blog article for the user's store. APPROVE-GATED: publish=false drafts it and returns the title + angle (nothing is published); after the user approves, publish=true publishes it live to their Shopify blog. Requires a connected Shopify store. Pass `topic` if the user named one; otherwise it picks the highest-intent buyer question.",
      parameters: { type: 'object', properties: { topic: { type: 'string' }, publish: { type: 'boolean', description: 'false = draft/preview (default); true = publish live to Shopify.' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'undo_catalog',
      description: "Undo previously APPLIED product catalog fixes on the user's Shopify store — restores the ORIGINAL value for every applied draft of the given kind, on the exact store the change landed on. Use when the user says to revert/undo the last catalog or product-SEO fixes. `kind`: 'description' | 'title' | 'tags' | 'seo'.",
      parameters: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['description', 'title', 'tags', 'seo'] } } },
    },
  },
]

// Human labels shown as the live "thinking" step in the UI.
export const TOOL_LABELS: Record<string, string> = {
  get_current_date: 'Checking the date…',
  get_ad_accounts: 'Checking your connected ad accounts…',
  get_account_info: 'Getting account info…',
  get_ad_performance: 'Loading live ad performance…',
  get_ads_report: 'Pulling your ad report…',
  search_ad_library: 'Searching the ad library…',
  get_competitor_ads: 'Analyzing competitor ads…',
  analyze_niche_patterns: 'Analyzing niche patterns…',
  find_winning_ads: 'Finding proven winners…',
  get_trending: 'Pulling trending winners…',
  list_boards: 'Checking your boards…',
  create_board: 'Creating a board…',
  save_ad_to_board: 'Saving to a board…',
  watch_brand: 'Adding a competitor to watch…',
  unwatch_brand: 'Removing a competitor…',
  request_competitor_crawl: 'Prioritizing their crawl…',
  search_my_assets: 'Searching your assets…',
  remember: 'Remembering that…',
  request_clarification: 'Asking for clarification…',
  create_ad: 'Creating on the canvas…',
  author_competitor_report: 'Writing the intelligence report…',
  run_seo_audit: 'Crawling your site for SEO…',
  fix_seo: 'Preparing SEO fixes…',
  run_cro_audit: 'Auditing your store for conversion…',
  fix_cro: 'Rewriting your product page…',
  fix_catalog: 'Preparing catalog fixes…',
  write_blog: 'Writing your blog post…',
  undo_catalog: 'Reverting catalog fixes…',
}

export interface ToolCtx { userId: string }

/** Generate the flagship competitor report, save it as a mello_documents row, return a link for Mello. */
export async function authorCompetitorReport(userId: string, competitor: string, brandNameHint?: string): Promise<any> {
  if (!competitor) return { error: 'Which competitor should I analyze?' }
  const admin = createAdminClient()
  let myBrand: { name: string; industry?: string; website?: string; voice?: string; edge?: string } | null = null
  let brandId: string | null = null
  try {
    // NOTE: brands has NO org_id column — selecting it errors the whole query (bug found in the
    // first live run: the report came out "for You" because this lookup silently nulled).
    let q = admin.from('brands').select('id, name, industry, website, tone, usps').eq('user_id', userId)
    if (brandNameHint) q = q.ilike('name', `%${brandNameHint}%`)
    else q = q.order('created_at', { ascending: true })
    const { data: brand } = await q.limit(1).maybeSingle()
    if (!brand && brandNameHint) {
      // Hinted name didn't match any brand — fall back to the user's primary brand.
      const { data: first } = await admin.from('brands').select('id, name, industry, website, tone, usps').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (first) {
        const arr = (v: any) => Array.isArray(v) ? v.filter(Boolean).join('/') : (v || undefined)
        myBrand = { name: first.name, industry: arr(first.industry), website: first.website || undefined, voice: first.tone || undefined, edge: arr(first.usps) }
        brandId = first.id
      }
    } else if (brand) {
      const arr = (v: any) => Array.isArray(v) ? v.filter(Boolean).join('/') : (v || undefined)
      myBrand = { name: brand.name, industry: arr(brand.industry), website: brand.website || undefined, voice: brand.tone || undefined, edge: arr(brand.usps) }
      brandId = brand.id
    }
  } catch { /* fail-soft */ }

  // Reserve 50 credits up front (competitor_report action, mig 122). If they can't afford it, tell
  // Mello to offer buying credits — don't burn the model call.
  let txId: string | null = null
  try {
    const tx = await reserveCredits(admin, userId, 'competitor_report')
    txId = tx.id
  } catch (e: any) {
    if (e instanceof InsufficientCreditsError) {
      return { error: 'insufficient_credits', need: e.need, have: e.have, note: 'The user does not have enough credits (a report costs 50). Tell them and offer to buy credits — do not proceed.' }
    }
    return { error: 'Could not reserve credits for the report.' }
  }

  let report
  try {
    report = await generateCompetitorReport({ competitorName: competitor, myBrand, userId })
  } catch (e: any) {
    await refundCredits(admin, txId).then(() => {}, () => {})
    return { error: e?.message || 'Report generation failed — check model keys/quota.' }
  }
  if (!report.adCount) await refundCredits(admin, txId).then(() => {}, () => {})  // 0 ads → not worth charging

  const { data: saved } = await admin.from('mello_documents').insert({
    user_id: userId, kind: 'competitor_report', title: report.title,
    subject: competitor, subject_brand_id: brandId, body_md: report.markdown, model: report.model,
    meta: { adCount: report.adCount, ...(report.fallbacks ? { fallbacks: report.fallbacks } : {}), ...(report.usage ? { usage: report.usage } : {}), ...(report.costUsd != null ? { costUsd: report.costUsd } : {}), ...(report.swipe?.length ? { swipe: report.swipe } : {}), ...(report.stats ? { stats: report.stats } : {}), ...(report.creators?.length ? { creators: report.creators } : {}), ...(report.scale ? { scale: report.scale } : {}), ...(report.momentum ? { momentum: report.momentum } : {}), ...(report.funnels?.length ? { funnels: report.funnels } : {}), ...(report.offerSignals?.length ? { offerSignals: report.offerSignals } : {}) },
  }).select('id, title').maybeSingle()
  if (txId && report.adCount) await commitCredits(admin, txId, { model: report.model, costUsd: report.costUsd ?? null, docId: saved?.id }).then(() => {}, () => {})

  return {
    saved: true,
    document_id: saved?.id,
    title: report.title,
    url: saved?.id ? `/documents/${saved.id}` : null,
    model: report.model,
    grounded_on_ads: report.adCount,
    note: 'The full report is saved. Give the user a 2-3 sentence highlight of the sharpest finding and the single most important move, then link them to the full document.',
  }
}

export async function executeTool(name: string, args: any, ctx: ToolCtx): Promise<any> {
  switch (name) {
    case 'get_current_date': {
      const now = new Date()
      return {
        today: now.toISOString().slice(0, 10),
        iso: now.toISOString(),
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        month: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      }
    }
    case 'get_ad_accounts':
      return { accounts: await listAdAccounts(ctx.userId) }
    case 'get_account_info':
      return await getAccountInfo(ctx.userId, args.account_id)
    case 'get_ad_performance':
      return await getAdPerformance(ctx.userId, args)
    case 'get_ads_report':
      return await getReportSummary(ctx.userId, { accountId: args.account_id, date_preset: args.date_preset })
    case 'search_ad_library':
      return await searchAdLibrary(args)
    case 'get_competitor_ads':
      return await getCompetitorAds(args)
    case 'analyze_niche_patterns':
      return await analyzeNichePatterns(args)
    case 'find_winning_ads':
      return await findWinningAds(args)
    case 'get_trending':
      return await getTrending(args)
    case 'list_boards':
      return await listBoards(ctx.userId)
    case 'create_board':
      return await createBoard(ctx.userId, String(args.name || ''), args.emoji || '📋')
    case 'save_ad_to_board':
      return await saveAdToBoard(ctx.userId, String(args.ad_id || ''), String(args.board_name || ''))
    case 'watch_brand':
      return await watchBrand(ctx.userId, String(args.page_id || ''), args.brand_name)
    case 'unwatch_brand':
      return await unwatchBrand(ctx.userId, { pageId: args.page_id, brandName: args.brand_name })
    case 'request_competitor_crawl':
      return await requestCompetitorCrawl(ctx.userId, String(args.page_id || ''), args.brand_name)
    case 'search_my_assets':
      return await searchMyAssets(ctx.userId, String(args.query || ''), args.limit)
    case 'run_seo_audit': {
      const admin = createAdminClient()
      const brandId = await resolveActiveBrandId(admin, ctx.userId).catch(() => null)
      let txId = ''
      try { txId = (await reserveCredits(admin, ctx.userId, 'seo_audit')).id }
      catch (e) { if (e instanceof InsufficientCreditsError) return { ran: false, note: 'Out of credits — an SEO audit costs credits. Tell the user to top up or upgrade to run it.' }; throw e }
      const audit = await runSeoAudit(admin, ctx.userId, brandId).catch(async (e) => { await refundCredits(admin, txId).catch(() => {}); throw e })
      if (!audit.hasData) { await refundCredits(admin, txId).catch(() => {}); return { ran: false, note: audit.note || "Couldn't read the store — the site may be unreachable, or no store is connected. Tell the user to check their store URL or connect Shopify." } }
      await commitCredits(admin, txId, { kind: 'seo_audit', score: audit.score }).catch(() => {})
      const top = (audit.issues || []).slice(0, 8).map((i) => ({ severity: i.severity, title: i.title, pages_affected: i.pages?.length || 0 }))
      return { ran: true, site: audit.site, score: audit.score, pages_crawled: audit.pagesCrawled, total_issues: (audit.issues || []).length, top_issues: top, note: 'Present the score out of 100 and the top issues plainly (most severe first). Then offer to auto-fix the product-page issues (titles + meta) with fix_seo — draft first, then apply after the user approves.' }
    }
    case 'fix_seo': {
      const admin = createAdminClient()
      const brandId = await resolveActiveBrandId(admin, ctx.userId).catch(() => null)
      const store = await resolveStore(admin, ctx.userId, brandId)
      if (!store) return { done: false, note: 'The active brand has NO connected Shopify store — auto-applying SEO fixes needs one. Tell the user to connect this brand\'s store, or switch to the brand that has a connected store. Do NOT apply to any other store.' }
      const shop = { name: store.shop_name || store.shop_domain, domain: store.shop_domain }
      if (args?.apply === true) {
        const { data: drafts } = await admin.from('shopify_catalog_drafts').select('id').eq('store_id', store.id).eq('agent', 'seo').eq('status', 'draft').limit(500)
        const ids = (drafts || []).map((d: any) => d.id)
        if (!ids.length) return { applied: 0, store: shop, note: 'No drafted SEO fixes to apply yet — call fix_seo with apply=false first to draft them.' }
        const res = await applyDrafts(admin, store, ids)
        return { applied: res.applied, failed: res.failed, store: shop, note: `Wrote ${res.applied} product SEO fixes to the store ${shop.name} (${shop.domain})${res.failed ? ` (${res.failed} failed)` : ''}. Tell the user EXACTLY which store was changed — ${shop.name} (${shop.domain}) — and suggest re-running run_seo_audit to see the improved score.` }
      }
      const res = await generateDrafts(admin, store, 'seo', 25)
      const products = res.created ? await listDraftedProducts(admin, store, 'seo', 8).catch(() => []) : []
      return { drafted: res.created, scanned: res.scanned, store: shop, products, note: res.created ? `Drafted ${res.created} product SEO fixes for the store ${shop.name} (${shop.domain}), from ${res.scanned} products (nothing is written yet). FIRST tell the user which store this is for — ${shop.name} (${shop.domain}). The "products" list is that store's REAL catalog — present each as a markdown line with its thumbnail and the before → after title: "![](image) **Title** — before → after". Do NOT mention any product that isn't in this list. Then ask them to approve; when they say yes, call fix_seo with apply=true.` : `Scanned ${res.scanned} products on ${shop.name} and found nothing to improve — their product SEO already looks good.` }
    }
    case 'run_cro_audit': {
      const admin = createAdminClient()
      const { data: b } = await admin.from('brands').select('website').eq('user_id', ctx.userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
      const url = ((b as any)?.website || '').trim()
      if (!url) return { ran: false, note: 'No store URL on file — ask the user for their store website (or connect Shopify), then run again.' }
      let txId = ''
      try { txId = (await reserveCredits(admin, ctx.userId, 'cro_audit')).id }
      catch (e) { if (e instanceof InsufficientCreditsError) return { ran: false, note: 'Out of credits — a CRO audit costs credits. Tell the user to top up or upgrade to run it.' }; throw e }
      const rep = await runCroAudit(url).catch(async (e) => { await refundCredits(admin, txId).catch(() => {}); throw e })
      await commitCredits(admin, txId, { kind: 'cro_audit', score: rep.score }).catch(() => {})
      const leaks = (rep.leaks || []).slice(0, 5).map((l: any) => ({ title: l.title, fix: l.fix }))
      return { ran: true, score: rep.score, verdict: rep.verdict, top_leaks: leaks, note: 'Present the score /100 and the biggest conversion leaks with their fixes (most impactful first). Offer to rewrite the product page for conversion with fix_cro (preview → apply after approval).' }
    }
    case 'fix_cro': {
      const admin = createAdminClient()
      const brandId = await resolveActiveBrandId(admin, ctx.userId).catch(() => null)
      const store = await resolveStore(admin, ctx.userId, brandId)
      if (!store) return { done: false, note: 'No Shopify store connected — rewriting the product page needs Shopify. Tell the user to connect it.' }
      if (args?.apply === true) {
        const { data: d } = await admin.from('geo_assets').select('id, title, target_prompt, body_markdown').eq('user_id', ctx.userId).eq('kind', 'cro_rewrite').eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!d) return { done: false, note: 'No drafted product-page rewrite to apply — call fix_cro with apply=false first.' }
        const res = await applyPdpRewrite(admin, store, brandId, String(d.target_prompt || ''), String(d.body_markdown || ''))
        await admin.from('geo_assets').update({ status: 'published', published_url: res.url }).eq('id', d.id)
        return { applied: true, product: d.title, url: res.url, note: `Published the higher-converting rewrite for "${d.title}". Confirm to the user and share the link.` }
      }
      const rw = await generatePdpRewrite(admin, store, null)
      if (!rw) return { done: false, note: 'Could not generate a product-page rewrite — the store may have no products yet.' }
      await admin.from('geo_assets').insert({ brand_id: store.brand_id, user_id: ctx.userId, kind: 'cro_rewrite', title: rw.title, target_prompt: rw.gid, body_markdown: rw.after, status: 'draft' })
      return { drafted: true, product: rw.title, note: `Drafted and saved a higher-converting rewrite of the product description for "${rw.title}" — not published yet. Give the user a 1-2 line sense of the improvement and ask them to approve; on yes, call fix_cro with apply=true to publish THIS exact rewrite.` }
    }
    case 'fix_catalog': {
      const admin = createAdminClient()
      const brandId = await resolveActiveBrandId(admin, ctx.userId).catch(() => null)
      const store = await resolveStore(admin, ctx.userId, brandId)
      if (!store) return { done: false, note: 'The active brand has NO connected Shopify store — catalog fixes need one. Tell the user to connect this brand\'s store, or switch to the brand that has a connected store. Do NOT apply to any other store.' }
      const shop = { name: store.shop_name || store.shop_domain, domain: store.shop_domain }
      const kind = (['description', 'alt', 'title', 'tags'].includes(String(args?.kind)) ? args.kind : 'description') as 'description' | 'alt' | 'title' | 'tags'
      if (args?.apply === true) {
        const { data: drafts } = await admin.from('shopify_catalog_drafts').select('id').eq('store_id', store.id).eq('agent', kind).eq('status', 'draft').limit(500)
        const ids = (drafts || []).map((d: any) => d.id)
        if (!ids.length) return { applied: 0, store: shop, note: `No drafted ${kind} fixes to apply — call fix_catalog with apply=false first.` }
        const res = await applyDrafts(admin, store, ids)
        return { applied: res.applied, failed: res.failed, kind, store: shop, note: `Wrote ${res.applied} product ${kind} fixes to the store ${shop.name} (${shop.domain}). Tell the user EXACTLY which store was changed — name ${shop.name} (${shop.domain}).` }
      }
      const res = await generateDrafts(admin, store, kind, 25)
      const products = res.created ? await listDraftedProducts(admin, store, kind, 8).catch(() => []) : []
      return { drafted: res.created, scanned: res.scanned, kind, store: shop, products, note: res.created ? `Drafted ${res.created} product ${kind} fixes for the store ${shop.name} (${shop.domain}), from ${res.scanned} products (nothing is written yet). FIRST tell the user which store this is for — ${shop.name} (${shop.domain}). The "products" list is that store's REAL catalog — present each as a markdown line with its thumbnail and the before → after change: "![](image) **Title** — before → after". Do NOT mention any product that isn't in this list. Then ask the user to approve; on yes, call fix_catalog with the same kind and apply=true.` : `Scanned ${res.scanned} products on ${shop.name} — their ${kind} already looks good.` }
    }
    case 'undo_catalog': {
      const admin = createAdminClient()
      const kind = (['description', 'title', 'tags', 'seo'].includes(String(args?.kind)) ? args.kind : 'description') as 'description' | 'title' | 'tags' | 'seo'
      const res = await revertAppliedDrafts(admin, ctx.userId, kind)
      if (!res.reverted && !res.failed) return { reverted: 0, note: `No applied ${kind} fixes to undo.` }
      return { reverted: res.reverted, failed: res.failed, stores: res.stores, note: `Restored the original ${kind} on ${res.reverted} products at ${res.stores.map((s) => `${s.name} (${s.domain})`).join(', ')}${res.failed ? ` (${res.failed} failed)` : ''}. Tell the user exactly which store was reverted.` }
    }
    case 'write_blog': {
      const admin = createAdminClient()
      const brandId = await resolveActiveBrandId(admin, ctx.userId).catch(() => null)
      const store = await resolveStore(admin, ctx.userId, brandId)
      if (!store) return { done: false, note: 'No Shopify store connected — writing/publishing a blog needs Shopify. Tell the user to connect it.' }
      if (args?.publish === true) {
        const { data: d } = await admin.from('geo_assets').select('id, title, body_markdown, published_url').eq('user_id', ctx.userId).eq('brand_id', store.brand_id).eq('kind', 'blog').eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!d) return { done: false, note: 'No drafted blog post to publish — call write_blog with publish=false first to draft one.' }
        const hero = d.published_url && String(d.published_url).startsWith('http') && !String(d.published_url).includes('/blogs/') ? String(d.published_url) : null
        const pub = await publishToShopifyBlog(store, { title: d.title, bodyHtml: d.body_markdown || '', imageUrl: hero, author: store.shop_name || undefined })
        await admin.from('geo_assets').update({ status: 'published', published_url: pub.url, shopify_article_id: String(pub.articleId) }).eq('id', d.id)
        return { published: true, title: d.title, url: pub.url, note: `Published "${d.title}" live to the user's Shopify blog. Share the link.` }
      }
      let txId = ''
      try { txId = (await reserveCredits(admin, ctx.userId, 'blog_draft')).id }
      catch (e) { if (e instanceof InsufficientCreditsError) return { done: false, note: 'Out of credits — writing a blog costs credits. Tell the user to top up or upgrade.' }; throw e }
      const art = await writeArticle(admin, store, ctx.userId, args?.topic ? String(args.topic) : undefined).catch(() => null)
      if (!art) { await refundCredits(admin, txId).catch(() => {}); return { done: false, note: 'Could not draft an article right now — try again with a more specific topic.' } }
      const hero = await generateHero(art, store.shop_name || undefined).catch(() => null)
      const html = renderArticleHtml(art, hero)
      await admin.from('geo_assets').insert({ brand_id: store.brand_id, user_id: ctx.userId, kind: 'blog', title: art.title, target_prompt: args?.topic ? String(args.topic) : art.dek, body_markdown: html, status: 'draft', published_url: hero })
      await commitCredits(admin, txId, { kind: 'blog_draft', title: art.title }).catch(() => {})
      return { drafted: true, title: art.title, dek: art.dek, note: `Drafted and saved a blog post titled "${art.title}" (${art.dek}) — not published yet. Give the user the title + angle and ask them to approve; on yes, call write_blog with publish=true to publish THIS exact draft.` }
    }
    case 'remember':
      await addMemory(ctx.userId, String(args.content || ''), args.kind || 'fact')
      return { remembered: String(args.content || '').slice(0, 400) }
    case 'author_competitor_report':
      return await authorCompetitorReport(ctx.userId, String(args.competitor || '').trim(), args.brand_name)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/** Build the `tool_result` SSE payload — a checkmark + optional sub-item in the UI. */
export function formatToolResult(name: string, result: any): { sub_item?: any; icon?: string } {
  if (name === 'get_ad_accounts') {
    const n = result?.accounts?.length || 0
    const primary = result?.accounts?.find((a: any) => a.is_primary)
    return { icon: 'meta', sub_item: { label: primary ? primary.name : `${n} account(s)`, count: n } }
  }
  if (name === 'get_account_info') {
    return { icon: 'meta', sub_item: { label: `${result?.name} · ${result?.currency}` } }
  }
  if (name === 'get_ad_performance') {
    return { icon: 'chart', sub_item: { label: `Loaded ${result?.count ?? 0} ${result?.level || 'ad'}(s)` } }
  }
  if (name === 'get_ads_report') {
    const cur = result?.currency || ''
    if (result?.spend == null) return { icon: 'chart', sub_item: { label: 'Report ready' } }
    // A clickable TILE: the headline stats in chat, click → the full /reports page. Keeps chat light,
    // the rich page does the deep work (health ring, quadrant, audience heat).
    return {
      icon: 'chart',
      sub_item: {
        label: 'Ad account report',
        href: result.report_url || '/reports',
        cta: 'Open full report',
        stats: [
          { k: 'Spend', v: `${cur} ${result.spend}` },
          { k: 'Revenue', v: `${cur} ${result.revenue}` },
          { k: 'ROAS', v: `${result.roas}x` },
          { k: 'Purchases', v: String(result.purchases ?? 0) },
        ],
      },
    }
  }
  if (name === 'search_ad_library' || name === 'find_winning_ads') {
    return { icon: 'search', sub_item: { label: `Found ${result?.count ?? 0} ad(s)` } }
  }
  if (name === 'get_competitor_ads') {
    return { icon: 'search', sub_item: { label: `Analyzed ${result?.count ?? 0} competitor ad(s)` } }
  }
  if (name === 'request_competitor_crawl') {
    const label = result?.queued ? `Queued ${result?.brand || 'competitor'} for crawl`
      : result?.already_fresh ? 'Already crawled recently'
      : result?.rate_limited ? 'Daily crawl limit reached'
      : 'Could not queue crawl'
    return { icon: 'search', sub_item: { label } }
  }
  if (name === 'analyze_niche_patterns') {
    return { icon: 'chart', sub_item: { label: `Analyzed ${result?.sampled ?? 0} ad(s) in the niche` } }
  }
  if (name === 'author_competitor_report') {
    if (!result?.saved) return { icon: 'chart', sub_item: { label: 'Could not write report' } }
    // Clickable tile → the saved document (/documents/<id>).
    return {
      icon: 'chart',
      sub_item: {
        label: result?.title || 'Strategy report',
        href: result?.url || (result?.document_id ? `/documents/${result.document_id}` : null),
        cta: 'Open the report',
        note: result?.model ? `Written · ${result.model}` : undefined,
      },
    }
  }
  return {}
}
