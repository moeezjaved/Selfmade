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
export async function getCompetitorWinners(admin: any, userId: string, opts: { poolSize?: number } = {}): Promise<CompetitorWinner[]> {
  const { data: follows } = await admin.from('followed_brands')
    .select('page_id, brand_name').eq('user_id', userId).eq('spied', true).limit(20)
  const pages = (follows || []).filter((f: any) => f.page_id)
  if (!pages.length) return []

  // Bounded per-brand fetch (a single .in() gets swallowed by the highest-volume brand). Longest-running
  // first — that's the signal we rank on, so the sample IS the candidates.
  const perBrand = await Promise.all(pages.slice(0, 12).map((p: any) =>
    admin.from('discovery_ads_index')
      .select('ad_id, page_id, page_name, title, body, hook_type, days_running, is_active, discovery_creatives(asset_type, r2_url, poster_url, position)')
      .eq('page_id', p.page_id)
      .order('days_running', { ascending: false, nullsFirst: false })
      .limit(30)
      .then((r: any) => (r.data || []).map((a: any) => ({ ...a, _brand: p.brand_name || a.page_name })))
      .catch(() => [] as any[])
  ))

  const candidates: CompetitorWinner[] = []
  for (const rows of perBrand) {
    const groups = new Map<string, any[]>()
    for (const a of rows) groups.set(conceptKey(a), [...(groups.get(conceptKey(a)) || []), a])
    for (const g of Array.from(groups.values())) {
      const withMedia = g.filter((a: any) => {
        const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
        return cres.some((c: any) => c.r2_url || c.poster_url)
      })
      const face = withMedia.find((a: any) => a.is_active) || withMedia[0]
      if (!face) continue
      const days = Math.max(...g.map((a: any) => Number(a.days_running) || 0))
      if (days < 7) continue // under a week live proves nothing — skip noise
      const live = g.some((a: any) => a.is_active)
      const cres = Array.isArray(face.discovery_creatives) ? face.discovery_creatives : [face.discovery_creatives]
      const vid = cres.find((c: any) => c?.asset_type === 'video' && c?.r2_url)
      const img = cres.find((c: any) => c?.asset_type !== 'video' && c?.r2_url)
      const isVideo = !!vid && !img
      candidates.push({
        adId: String(face.ad_id),
        pageId: String(face.page_id),
        brandName: String(face._brand || face.page_name || 'Competitor'),
        title: face.title || null,
        hook: face.hook_type || null,
        daysRunning: days,
        variants: g.length,
        isActive: live,
        isVideo,
        image: isVideo ? (vid?.poster_url || null) : (img?.r2_url || vid?.poster_url || null),
        videoUrl: isVideo ? (vid?.r2_url || null) : null,
        why: `${live ? 'Live' : 'Ran'} ${days} days${g.length > 1 ? ` · ${g.length} variants` : ''} — ${live ? 'they keep paying for it, which almost always means it converts' : 'a long run like this usually means it converted'}.`,
      })
    }
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
