/**
 * Competitor winners — the ranked pool of "your rivals' winning ads right now", from public signal only.
 *
 * We can NEVER see a rival's ROAS. What we CAN see (Ad Library via our crawl) is how they BEHAVE:
 * advertisers kill losers within days, so an ad that is (a) still live, (b) running a long time, and
 * (c) exists as many near-variants is one they keep paying for — the strongest outside evidence it
 * converts. Rank = daysRunning × (1 + log2(variants)) × liveBoost. Pure-DB (followed_brands +
 * discovery_ads_index), zero Graph calls. Shared by the brief's competitor card and the Creative
 * Strategist so both reason off the same winners.
 */

// A manual add stores brand_name = "Facebook page <id>" — treat that (and blanks/bare ids) as
// unresolved so the crawler's real page_name wins instead of showing the placeholder as the name.
const isPlaceholderName = (n: unknown): boolean => {
  const t = String(n ?? '').trim()
  return !t || /^\d+$/.test(t) || /^facebook page\s+\d+$/i.test(t)
}

export type CompetitorWinner = {
  adId: string
  pageId: string
  brandName: string
  title: string | null
  hook: string | null
  daysRunning: number
  variants: number
  isActive: boolean
  isVideo: boolean
  image: string | null      // poster (video) or the image itself
  videoUrl: string | null   // mp4 when the winner is a video
  why: string               // plain-English evidence line
}

// Variant key: advertisers duplicate the same concept with identical copy — group by normalized
// title+body head. Cheap, no embeddings, and it matches how dupes actually look in the library.
const conceptKey = (a: any) =>
  `${String(a.title || '').toLowerCase().trim().slice(0, 80)}|${String(a.body || '').toLowerCase().trim().slice(0, 120)}`

const score = (m: CompetitorWinner) => m.daysRunning * (1 + Math.log2(Math.max(1, m.variants))) * (m.isActive ? 1.5 : 0.6)

/** The ranked pool of distinct rivals' winning ads (one hero per rival). Empty when nothing is spied. */
export async function getCompetitorWinners(admin: any, userId: string, opts: { poolSize?: number; brandId?: string | null } = {}): Promise<CompetitorWinner[]> {
  let q = admin.from('followed_brands').select('page_id, brand_name').eq('user_id', userId).eq('spied', true)
  if (opts.brandId) q = q.eq('brand_id', opts.brandId)   // scope to ONE of the founder's brands when picked
  const { data: follows } = await q.limit(20)
  const pages = (follows || []).filter((f: any) => f.page_id)
  if (!pages.length) return []

  // Bounded per-brand fetch — NO discovery_creatives embed (that correlated join per row × 15 × N brands
  // was the slow part that timed the strategy out under crawl load). Use the has_creative flag to know
  // which ads have media, pick the hero per concept, THEN fetch creatives once for just those heroes.
  // Ordered days_running DESC → rides mig-150's (page_id, days_running) index = a fast range scan.
  const perBrand = await Promise.all(pages.slice(0, 12).map((p: any) =>
    admin.from('discovery_ads_index')
      .select('ad_id, page_id, page_name, title, body, hook_type, days_running, is_active, has_creative')
      .eq('page_id', p.page_id)
      .order('days_running', { ascending: false, nullsFirst: false })
      .limit(15)
      .then((r: any) => (r.data || []).map((a: any) => ({ ...a, _brand: (isPlaceholderName(p.brand_name) ? a.page_name : p.brand_name) || a.page_name })))
      .catch(() => [] as any[])
  ))

  // First pass: pick a hero ad per concept-group (has_creative + longest-running/active), collect ad_ids.
  type Cand = { face: any; days: number; live: boolean; variants: number; brandName: string }
  const cands: Cand[] = []
  for (const rows of perBrand) {
    const groups = new Map<string, any[]>()
    for (const a of rows) groups.set(conceptKey(a), [...(groups.get(conceptKey(a)) || []), a])
    for (const g of Array.from(groups.values())) {
      const withMedia = g.filter((a: any) => a.has_creative)
      const face = withMedia.find((a: any) => a.is_active) || withMedia[0]
      if (!face) continue
      const days = Math.max(...g.map((a: any) => Number(a.days_running) || 0))
      if (days < 7) continue // under a week live proves nothing — skip noise
      cands.push({ face, days, live: g.some((a: any) => a.is_active), variants: g.length, brandName: String(face._brand || face.page_name || 'Competitor') })
    }
  }

  // Single bounded creatives fetch for ONLY the chosen heroes (was one correlated subquery per candidate row).
  const heroIds = Array.from(new Set(cands.map(c => String(c.face.ad_id))))
  const creativesByAd = new Map<string, any[]>()
  if (heroIds.length) {
    const { data: cres } = await admin.from('discovery_creatives')
      .select('ad_id, asset_type, r2_url, poster_url, position').in('ad_id', heroIds)
    for (const c of (cres || []) as any[]) creativesByAd.set(String(c.ad_id), [...(creativesByAd.get(String(c.ad_id)) || []), c])
  }

  const candidates: CompetitorWinner[] = []
  for (const c of cands) {
    const cres = creativesByAd.get(String(c.face.ad_id)) || []
    const vid = cres.find((x: any) => x?.asset_type === 'video' && x?.r2_url)
    const img = cres.find((x: any) => x?.asset_type !== 'video' && x?.r2_url)
    const isVideo = !!vid && !img
    const image = isVideo ? (vid?.poster_url || null) : (img?.r2_url || vid?.poster_url || null)
    if (!image) continue   // hero must have a usable thumbnail (matches the old withMedia guarantee)
    candidates.push({
      adId: String(c.face.ad_id), pageId: String(c.face.page_id), brandName: c.brandName,
      title: c.face.title || null, hook: c.face.hook_type || null, daysRunning: c.days, variants: c.variants,
      isActive: c.live, isVideo, image, videoUrl: isVideo ? (vid?.r2_url || null) : null,
      why: `${c.live ? 'Live' : 'Ran'} ${c.days} days${c.variants > 1 ? ` · ${c.variants} variants` : ''} — ${c.live ? 'they keep paying for it, which almost always means it converts' : 'a long run like this usually means it converted'}.`,
    })
  }

  candidates.sort((a, b) => score(b) - score(a))
  // One hero per rival — variety beats 3 ads from the same brand.
  const seen = new Set<string>()
  const distinct: CompetitorWinner[] = []
  for (const m of candidates) {
    if (seen.has(m.pageId)) continue
    seen.add(m.pageId)
    distinct.push(m)
    if (distinct.length >= (opts.poolSize || 8)) break
  }
  return distinct
}
