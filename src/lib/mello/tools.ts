/**
 * Mello's tools — OpenAI function-calling schemas + executor.
 *
 * `request_clarification` is special: it is NOT executed as a data fetch. When the
 * model calls it, the agent loop emits a `widget` SSE event and ends the turn; the
 * user's selection comes back as the next chat message. This avoids cross-request
 * blocking (serverless-friendly) while preserving the inline-picker UX.
 */
import { listAdAccounts, getAccountInfo, getAdPerformance, searchAdLibrary } from './meta-data'
import { getCompetitorAds, analyzeNichePatterns, findWinningAds } from './library-data'
import { addMemory } from './memory'
import { getTrending, listBoards, createBoard, saveAdToBoard, searchMyAssets, watchBrand, unwatchBrand } from './actions'
import { generateCompetitorReport } from './reports/competitor-report'
import { createAdminClient } from '@/lib/supabase/server'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

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
      description: "Deep-dive a competitor brand (or a niche) using Selfmade's crawl corpus. Returns their ads with the problem they target, mechanism, offer, CTA style, creative style (UGC/Studio), visual, and longevity. Use for competitor analysis and offer comparison.",
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: 'Competitor brand / page name to match' },
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
      name: 'search_my_assets',
      description: "Semantic search of the user's OWN uploaded Assets library (their creatives, b-roll, product shots) by meaning — e.g. 'my UGC unboxing clips', 'green product shots'.",
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remember',
      description: "Persist a DURABLE fact about this user so you recall it in future chats — their niche/vertical, target CPA/ROAS goals, brand voice, main competitors, offers, or preferences. Only for things worth carrying forward, not one-off requests.",
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
      description: "Write the flagship Competitor Intelligence Report — a McKinsey/Sequoia-grade strategy document about a rival brand, grounded in their real crawled ads, ending every section with a concrete move for the user's own brand. Use when the user says 'analyze <competitor>', 'do a deep-dive / teardown / full report on <brand>', 'give me the strategy doc on X', or wants a serious written analysis (NOT a quick chat answer — for a fast verbal read use get_competitor_ads instead). Takes ~1-2 minutes; it saves a document the user can reopen and returns a link. Tell the user you're writing it before you call this.",
      parameters: {
        type: 'object',
        required: ['competitor'],
        properties: {
          competitor: { type: 'string', description: 'The rival brand/company name to analyze' },
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
]

// Human labels shown as the live "thinking" step in the UI.
export const TOOL_LABELS: Record<string, string> = {
  get_current_date: 'Checking the date…',
  get_ad_accounts: 'Checking your connected ad accounts…',
  get_account_info: 'Getting account info…',
  get_ad_performance: 'Loading live ad performance…',
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
  search_my_assets: 'Searching your assets…',
  remember: 'Remembering that…',
  request_clarification: 'Asking for clarification…',
  create_ad: 'Creating on the canvas…',
  author_competitor_report: 'Writing the intelligence report…',
}

export interface ToolCtx { userId: string }

/** Generate the flagship competitor report, save it as a mello_documents row, return a link for Mello. */
async function authorCompetitorReport(userId: string, competitor: string, brandNameHint?: string): Promise<any> {
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
    meta: { adCount: report.adCount, ...(report.fallbacks ? { fallbacks: report.fallbacks } : {}), ...(report.usage ? { usage: report.usage } : {}), ...(report.costUsd != null ? { costUsd: report.costUsd } : {}), ...(report.swipe?.length ? { swipe: report.swipe } : {}), ...(report.stats ? { stats: report.stats } : {}), ...(report.creators?.length ? { creators: report.creators } : {}) },
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
    case 'search_my_assets':
      return await searchMyAssets(ctx.userId, String(args.query || ''), args.limit)
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
  if (name === 'search_ad_library' || name === 'find_winning_ads') {
    return { icon: 'search', sub_item: { label: `Found ${result?.count ?? 0} ad(s)` } }
  }
  if (name === 'get_competitor_ads') {
    return { icon: 'search', sub_item: { label: `Analyzed ${result?.count ?? 0} competitor ad(s)` } }
  }
  if (name === 'analyze_niche_patterns') {
    return { icon: 'chart', sub_item: { label: `Analyzed ${result?.sampled ?? 0} ad(s) in the niche` } }
  }
  if (name === 'author_competitor_report') {
    return { icon: 'chart', sub_item: result?.saved ? { label: `Report written · ${result?.model || 'ai'}` } : { label: 'Could not write report' } }
  }
  return {}
}
