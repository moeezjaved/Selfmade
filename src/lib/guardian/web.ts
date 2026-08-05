/**
 * Brand Guardian — the rival-website watcher. For each spied competitor we take the host from their ads'
 * landing pages (discovery_ads_index.landing_url), fetch the storefront, and read the price + any offer
 * banner with plain regex. Comparing against last scan (guardian_site_snapshot) flags a price DROP or a
 * new offer — the morning they do it. Free: plain fetch + parse, no LLM, no paid API. Best-effort per site.
 */

export type SiteAlert = {
  pageId: string; brand: string; kind: 'price' | 'offer'
  headline: string; detail: string; url: string
}

const hostOf = (u: string) => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return '' } }
const PRICE = /(?:Rs\.?|PKR|USD|\$|€|£)\s?[\d,]{2,}(?:\.\d{2})?/i
const OFFER = /(free shipping|free delivery|\d{1,2}%\s*off|flat\s*\d{1,2}%|sale\b|clearance|discount|buy\s*\d\s*get|bundle deal)/i

export async function scanRivalSites(admin: any, userId: string): Promise<SiteAlert[]> {
  const { data: follows } = await admin.from('followed_brands')
    .select('page_id, brand_name').eq('user_id', userId).eq('spied', true).limit(15)
  const rivals = (follows || []).filter((f: any) => f.page_id).slice(0, 8)
  if (!rivals.length) return []

  const { data: snaps } = await admin.from('guardian_site_snapshot').select('*').eq('user_id', userId)
  const prevMap: Record<string, any> = {}
  for (const s of (snaps || []) as any[]) prevMap[s.page_id] = s

  const results = await Promise.all(rivals.map(async (r: any) => {
    const pageId = String(r.page_id)
    const brand = r.brand_name || 'A competitor'
    try {
      // Their website host — from one of their ad landing pages, else the last one we stored.
      let host = prevMap[pageId]?.website || ''
      if (!host) {
        const { data: ad } = await admin.from('discovery_ads_index').select('landing_url')
          .eq('page_id', pageId).not('landing_url', 'is', null).order('last_seen_at', { ascending: false }).limit(1).maybeSingle()
        host = hostOf(ad?.landing_url || '')
      }
      if (!host) return null

      const res = await fetch(`https://${host}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; selfmade-guardian/1.0)' }, signal: AbortSignal.timeout(10000) })
      if (!res.ok) return null
      const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      const price = (text.match(PRICE) || [])[0]?.replace(/\s+/g, ' ').trim() || null
      const offer = (text.match(OFFER) || [])[0]?.toLowerCase() || null
      const prev = prevMap[pageId]
      const out: SiteAlert[] = []
      if (price && prev?.last_price && price !== prev.last_price) {
        out.push({ pageId, brand, kind: 'price', headline: `${brand} changed their price`, detail: `Was ${prev.last_price}, now ${price} on their site. Consider matching or countering.`, url: `https://${host}` })
      }
      if (offer && (!prev?.last_offer || offer !== String(prev.last_offer).toLowerCase())) {
        out.push({ pageId, brand, kind: 'offer', headline: `${brand} is pushing an offer`, detail: `Their site now shows “${offer}”. Answer it before it pulls your shoppers.`, url: `https://${host}` })
      }
      // Remember for next time (records the baseline on the first scan, silently).
      await admin.from('guardian_site_snapshot').upsert({ user_id: userId, page_id: pageId, website: host, last_price: price, last_offer: offer, updated_at: new Date().toISOString() }, { onConflict: 'user_id,page_id' })
      return out
    } catch { return null }
  }))

  return (results.filter(Boolean) as SiteAlert[][]).flat().slice(0, 5)
}
