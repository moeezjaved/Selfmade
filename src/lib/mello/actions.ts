/**
 * Mello ACTION tools (agent-core rebuild, stage 2) — the "doing" tools that reuse existing infra so
 * Mello can operate, not just analyze: surface trending winners, manage boards, save ads it found,
 * and search the user's own uploaded Assets. All org-scoped via getUserOrg.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { embedText } from '@/lib/assets/enrich'

/** Trending winners (performance_score-ranked), optionally by niche — mirrors the /trending logic. */
export async function getTrending(params: { niche?: string; limit?: number }) {
  const admin = createAdminClient() as any
  const limit = Math.min(20, Math.max(1, params.limit || 10))
  let q = admin.from('discovery_ads_index')
    .select('ad_id, page_name, performance_score, format_style, hook_type, days_running, niche')
    .eq('has_creative', true).gt('performance_score', 0)
    .order('performance_score', { ascending: false }).limit(limit)
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  const { data } = await q
  return {
    niche: params.niche || 'all niches', count: (data || []).length,
    ads: (data || []).map((a: any) => ({ ad_id: a.ad_id, brand: a.page_name, score: Math.round((a.performance_score || 0) * 100) / 100, format: a.format_style, hook: a.hook_type, days_running: a.days_running })),
  }
}

/** The user's boards (team + own personal). */
export async function listBoards(userId: string) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const { data } = await admin.from('discovery_boards')
    .select('id, name, emoji, visibility').eq('org_id', org.orgId).or(`visibility.eq.team,created_by.eq.${userId}`)
  return { boards: (data || []).map((b: any) => ({ id: b.id, name: b.name, emoji: b.emoji, shared: b.visibility === 'team' })) }
}

/** Create a board (personal). */
export async function createBoard(userId: string, name: string, emoji = '📋') {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const { data, error } = await admin.from('discovery_boards')
    .insert({ user_id: userId, created_by: userId, org_id: org.orgId, name: String(name).slice(0, 60), emoji, visibility: 'personal' }).select('id, name').single()
  if (error) return { error: error.message }
  return { created: true, board: { id: data.id, name: data.name } }
}

/** Save an ad (by ad_id, e.g. from search/trending results) into a board — creating it by name if needed. */
export async function saveAdToBoard(userId: string, adId: string, boardName: string) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  let { data: board } = await admin.from('discovery_boards').select('id, name').eq('org_id', org.orgId).ilike('name', boardName).limit(1).maybeSingle()
  if (!board) {
    const { data: nb } = await admin.from('discovery_boards').insert({ user_id: userId, created_by: userId, org_id: org.orgId, name: String(boardName).slice(0, 60), emoji: '📌', visibility: 'personal' }).select('id, name').single()
    board = nb
  }
  const { data: ad } = await admin.from('discovery_ads_index').select('ad_id, page_id, page_name').eq('ad_id', String(adId)).maybeSingle()
  if (!ad) return { error: 'ad not found' }
  await admin.from('discovery_saved_ads').upsert(
    { user_id: userId, org_id: org.orgId, board_id: board.id, ad_id: ad.ad_id, page_id: ad.page_id, page_name: ad.page_name, ad_data: {} },
    { onConflict: 'user_id,board_id,ad_id' })
  return { saved: true, board: board.name, ad: ad.page_name }
}

/** Semantic search the user's own uploaded Assets library. */
export async function searchMyAssets(userId: string, query: string, limit = 12) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const emb = await embedText(query)
  let assets: any[] = []
  let semantic = false
  if (emb) {
    semantic = true
    const { data } = await admin.rpc('search_assets', { p_org: org.orgId, p_query: emb as any, p_limit: Math.min(24, limit) })
    assets = (data || []).map((a: any) => ({ id: a.id, name: a.file_name, type: a.file_type, scene: a.scene, tags: a.tags }))
  } else {
    const { data } = await admin.from('assets').select('id, file_name, file_type, scene, tags').eq('org_id', org.orgId).ilike('file_name', `%${query}%`).limit(limit)
    assets = (data || []).map((a: any) => ({ id: a.id, name: a.file_name, type: a.file_type, scene: a.scene, tags: a.tags }))
  }
  // Semantic search returns the CLOSEST assets even when nothing truly matches, so guard against
  // Mello force-attributing an unrelated asset to a product/person the user named.
  const note = !assets.length
    ? `No assets match "${query}" in the user's library. Tell them plainly you couldn't find one — do NOT substitute an unrelated asset.`
    : semantic
      ? `These are the CLOSEST assets by similarity, NOT verified matches. NEVER say an asset is "for" or "the" specific product/person the user named unless that exact name literally appears in the asset's name or tags. If the user asked for a specific named thing (e.g. "${query}") and it does not appear in these names/tags, tell them you couldn't find an asset for it — never invent an association.`
      : `Assets whose file name contains "${query}".`
  return { assets, note }
}

/** Watch a competitor brand — Mello follows + spies it so its new ads land in the brief. Needs the
 *  page_id (from search_ad_library / get_competitor_ads / find_winning_ads results). */
export async function watchBrand(userId: string, pageId: string, brandName?: string) {
  const admin = createAdminClient() as any
  if (!pageId) return { error: 'page_id required — search for the brand first to get its id' }
  const { data: existing } = await admin.from('followed_brands').select('id').eq('user_id', userId).eq('page_id', String(pageId)).maybeSingle()
  if (!existing) await admin.from('followed_brands').insert({ user_id: userId, page_id: String(pageId), brand_name: brandName || null, spied: true })
  else await admin.from('followed_brands').update({ spied: true, ...(brandName ? { brand_name: brandName } : {}) }).eq('id', existing.id)
  return { watching: true, brand: brandName || pageId }
}

// Default crawl markets — mirrors src/app/api/discovery/brand-spy/route.ts so a Mello-queued crawl
// behaves identically to a UI spy.
const CRAWL_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'MX', 'BR', 'IN', 'JP', 'SG', 'AE', 'ZA']

/**
 * Prioritize crawling a competitor the user follows but that isn't in the ad index yet (Phase 2.2 —
 * makes Mello's "I can prioritize their crawl" offer a REAL action, not a dead promise). Reuses the exact
 * mechanism behind the app's on-demand pull (/api/discovery/brand-spy?crawlOnly): bump the crawl term to
 * tier-0 (priority 9, last_crawled_at null) so the droplet crawler takes it next pass. Honest about
 * timing — this is NEXT-CYCLE (minutes), never an instant fetch. Respects the per-plan expressPulls daily
 * cap and logs BRAND_PULLED so accounting matches the rest of the app.
 */
export async function requestCompetitorCrawl(userId: string, pageId: string, brandName?: string) {
  const admin = createAdminClient() as any
  const pid = String(pageId || '').trim()
  if (!pid || !/^\d+$/.test(pid)) return { error: 'A numeric competitor page_id is required (from the watched-competitor list).' }

  // Resolve a display name (prefer the follow row) so the queue + activity log read as the brand, not a number.
  let name = (brandName || '').trim()
  try {
    const { data: f } = await admin.from('followed_brands').select('brand_name').eq('user_id', userId).eq('page_id', pid).maybeSingle()
    if (!name && f?.brand_name) name = String(f.brand_name)
  } catch { /* best-effort */ }
  if (!name) name = pid

  // Freshness guard — don't burn a pull re-crawling a brand we refreshed in the last 12h.
  try {
    const { data: term } = await admin.from('discovery_crawl_terms').select('last_crawled_at, crawling_at').eq('page_id', pid).maybeSingle()
    const freshCut = Date.now() - 12 * 3600 * 1000
    const lastCrawled = term?.last_crawled_at ? Date.parse(term.last_crawled_at) : 0
    const crawlingNow = term?.crawling_at ? Date.parse(term.crawling_at) > Date.now() - 30 * 60 * 1000 : false
    if (lastCrawled > freshCut || crawlingNow) {
      return { queued: false, already_fresh: true, brand: name, note: `${name} was crawled recently — their ads should already be available. Try get_competitor_ads with this page_id again; if still empty, the crawl may still be running.` }
    }
  } catch { /* if the guard read fails, fall through and queue anyway */ }

  // Per-plan daily cap on on-demand pulls (expressPulls), counted against the billing owner.
  try {
    const { resolveBillingOwner } = await import('@/lib/org')
    const { requireUnder } = await import('@/lib/entitlements')
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const { count: pullsToday } = await admin.from('activity_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('action_type', 'BRAND_PULLED').gte('created_at', startOfDay.toISOString())
    const billingOwner = await resolveBillingOwner(admin, userId).catch(() => userId)
    const gate = await requireUnder(admin, billingOwner, 'expressPulls', pullsToday || 0)
    if (gate) return { queued: false, rate_limited: true, brand: name, note: gate.message || `You've hit today's on-demand crawl limit. It resets tomorrow, or upgrade for more.` }
  } catch { /* if the gate check fails, don't block the queue */ }

  // Enqueue at tier 0 (upsert the crawl term) — identical to ensureTracked(..., forceFresh=true).
  try {
    const { data: ex } = await admin.from('discovery_crawl_terms').select('page_id, is_active').eq('page_id', pid).maybeSingle()
    if (ex) {
      await admin.from('discovery_crawl_terms').update({ is_active: true, last_crawled_at: null, priority: 9 }).eq('page_id', pid)
    } else {
      await admin.from('discovery_crawl_terms').insert({ term: name, page_id: pid, term_type: 'brand', category: 'General', is_active: true, priority: 9, last_crawled_at: null, countries: CRAWL_COUNTRIES })
    }
  } catch (e: any) {
    return { error: `Couldn't queue the crawl: ${e?.message || 'unknown error'}` }
  }
  try { const { logActivity } = await import('@/lib/activity'); await logActivity(admin, userId, 'BRAND_PULLED', `Pulled ads for ${name}`) } catch { /* non-fatal */ }

  return { queued: true, brand: name, immediate: false, note: `Put ${name} at the front of the crawl queue. Their ads will start appearing within a few minutes as the crawler pulls them in — tell the user that and offer to re-check shortly. Do NOT claim you have their ads yet.` }
}

/** Stop watching a competitor — by page_id, or by (fuzzy) brand name if that's all Mello has. */
export async function unwatchBrand(userId: string, opts: { pageId?: string; brandName?: string }) {
  const admin = createAdminClient() as any
  let q = admin.from('followed_brands').delete().eq('user_id', userId)
  if (opts.pageId) q = q.eq('page_id', String(opts.pageId))
  else if (opts.brandName) q = q.ilike('brand_name', `%${opts.brandName}%`)
  else return { error: 'need a page_id or brand_name to unwatch' }
  const { data } = await q.select('page_id, brand_name')
  return { unwatched: (data || []).length, removed: (data || []).map((r: any) => r.brand_name || r.page_id) }
}
