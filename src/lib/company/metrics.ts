/**
 * Canonical company stats — the SINGLE source for counts that appear in BOTH the Morning Brief and
 * Mello's chat, so they can never disagree (Phase 10). The brief renders "N ads read overnight"; when a
 * founder asks Mello "how many competitor ads did we analyze?", it runs THIS same query. Solved at the
 * data layer, not by prompt instructions.
 *
 * Brand scoping mirrors assemble.ts: a selected brand restricts to its watched competitors' page_ids;
 * a brand with no competitors → NO_PAGE sentinel (returns 0, not everything); All-brands → global.
 */
const NO_PAGE = '__none__'

/** Resolve the page_ids of the competitors this brand watches (null = All-brands / global). */
export async function brandScopePages(admin: any, userId: string, brandId?: string | null): Promise<string[] | null> {
  if (!brandId) return null
  try {
    const { data } = await admin.from('followed_brands').select('page_id').eq('user_id', userId).eq('brand_id', brandId)
    const ids = (data || []).map((r: any) => String(r.page_id)).filter(Boolean)
    return ids.length ? ids : [NO_PAGE]
  } catch { return null }
}

/** Competitor ads read/crawled in the last 24h — the brief's "ads read overnight" number. */
export async function getAdsScanned24h(admin: any, userId: string, brandId?: string | null): Promise<number> {
  const scopePages = await brandScopePages(admin, userId, brandId)
  return countAdsScanned24h(admin, scopePages)
}

/** The exact count query, given already-resolved scope pages (so assemble.ts can pass its own). */
export async function countAdsScanned24h(admin: any, scopePages: string[] | null): Promise<number> {
  const H24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  try {
    if (scopePages) {
      const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).gte('created_at', H24).in('page_id', scopePages)
      return count || 0
    }
    const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'estimated', head: true }).gte('created_at', H24)
    return count || 0
  } catch { return 0 }
}

/** How many competitors this brand is actively spying on (matches the brief's "Watching N"). */
export async function getSpiedCount(admin: any, userId: string, brandId?: string | null): Promise<number> {
  try {
    let q = admin.from('followed_brands').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('spied', true)
    if (brandId) q = q.eq('brand_id', brandId)
    const { count } = await q
    return count || 0
  } catch { return 0 }
}
