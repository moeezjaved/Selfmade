/**
 * Brand Guardian — the defensive employee. Watches your spied competitors and warns you when one makes a
 * move you should react to, from the crawl data we already own (followed_brands + discovery_ads_index).
 * The core signal is a diff: a rival that suddenly launches a batch of NEW ads is pushing budget / testing
 * a new angle — the thing you want to hear about the morning it happens, with a counter-move ready.
 * Grounded only in real counts; nothing invented. Zero Graph calls.
 */

export type GuardianAlert = {
  pageId: string
  brand: string
  kind: 'scaling' | 'new_ads'
  newCount: number          // ads that first appeared inside the window
  activeCount: number       // ads currently live
  headline: string          // plain-English what happened
  detail: string            // the counter-move
  image?: string | null     // a sample of the new creative
  href: string              // go see their ads
}

const H = 3600_000

export async function scanBrandGuardian(admin: any, userId: string, opts: { days?: number; brandId?: string | null } = {}): Promise<GuardianAlert[]> {
  const days = opts.days || 7
  const since = new Date(Date.now() - days * 24 * H).toISOString()

  let q = admin.from('followed_brands').select('page_id, brand_name').eq('user_id', userId).eq('spied', true)
  if (opts.brandId) q = q.eq('brand_id', opts.brandId)   // scope to the picked brand's competitors
  const { data: follows } = await q.limit(20)
  const pages = (follows || []).filter((f: any) => f.page_id)
  if (!pages.length) return []

  const results = await Promise.all(pages.slice(0, 15).map(async (p: any) => {
    try {
      const [activeRes, newRes] = await Promise.all([
        admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', p.page_id).eq('is_active', true),
        admin.from('discovery_ads_index')
          .select('ad_id, title, first_seen_at, discovery_creatives(asset_type, r2_url, poster_url)')
          .eq('page_id', p.page_id).gte('first_seen_at', since).order('first_seen_at', { ascending: false }).limit(5),
      ])
      const activeCount = activeRes.count || 0
      const newRows = (newRes.data || []) as any[]
      const newCount = newRows.length
      if (newCount === 0) return null
      // A sample of the new creative for the card.
      let image: string | null = null
      for (const r of newRows) {
        const cres = Array.isArray(r.discovery_creatives) ? r.discovery_creatives : (r.discovery_creatives ? [r.discovery_creatives] : [])
        const c = cres.find((x: any) => x?.r2_url || x?.poster_url)
        if (c) { image = c.poster_url || c.r2_url; break }
      }
      const brand = p.brand_name || 'A competitor'
      const scaling = newCount >= 3
      return {
        pageId: String(p.page_id), brand, kind: scaling ? 'scaling' : 'new_ads', newCount, activeCount, image,
        headline: scaling
          ? `${brand} launched ${newCount} new ads this week — they're pushing.`
          : `${brand} put out ${newCount} new ad${newCount === 1 ? '' : 's'}.`,
        detail: scaling
          ? `A burst of new creative usually means budget behind a winner. See what they're running and make your version before they take the audience.`
          : `Worth a look — the concept they just tried might be one to answer.`,
        href: `/discovery/brand-spy/${p.page_id}`,
      } as GuardianAlert
    } catch { return null }
  }))

  return (results.filter(Boolean) as GuardianAlert[]).sort((a, b) => b.newCount - a.newCount).slice(0, 5)
}
