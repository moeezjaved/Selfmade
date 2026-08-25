/**
 * Per-brand ads-studio cache — co-located with the brand kit in brands.brand_kit.adsStudio, so the whole
 * studio (kit, knowledge base, products, audiences, competitors, templates) is warm on arrival instead of
 * recomputed on every open. Sections are domain-stamped so switching stores never serves stale data, and
 * carry a timestamp so they refresh after a couple of weeks. Writes MERGE (never clobber sibling sections).
 */
const norm = (d: string) => (d || '').replace(/^https?:\/\//i, '').replace(/^www\./, '').replace(/\/.*$/, '')

export async function readAdsStudio(admin: any, brandId: string): Promise<any> {
  try {
    const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
    const bk = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
    return (bk.adsStudio && typeof bk.adsStudio === 'object') ? bk.adsStudio : {}
  } catch { return {} }
}

/** Merge a patch into brands.brand_kit.adsStudio without touching sibling keys. */
export async function mergeAdsStudio(admin: any, brandId: string, patch: Record<string, any>): Promise<void> {
  try {
    const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
    const bk = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
    const ads = (bk.adsStudio && typeof bk.adsStudio === 'object') ? bk.adsStudio : {}
    await admin.from('brands').update({ brand_kit: { ...bk, adsStudio: { ...ads, ...patch } } }).eq('id', brandId)
  } catch { /* best-effort */ }
}

/** Read a domain-stamped section (products/audiences/competitors). null on miss / domain-mismatch / stale. */
export function readSection<T>(ads: any, key: string, domain: string, maxAgeMs = 1000 * 60 * 60 * 24 * 14): T | null {
  const s = ads?.[key]
  if (!s || typeof s !== 'object' || norm(s.domain) !== norm(domain)) return null
  if (s.at && Date.now() - Date.parse(s.at) > maxAgeMs) return null
  return (s.data ?? null) as T | null
}

export function sectionPayload<T>(domain: string, data: T) {
  return { domain: norm(domain), at: new Date().toISOString(), data }
}

/** Simple in-flight guard so parallel loads don't launch several 90s discovery runs for one domain. */
export function isBuilding(ads: any, key: string, domain: string, windowMs = 1000 * 60 * 3): boolean {
  const s = ads?.[`${key}Building`]
  return !!s && norm(s.domain) === norm(domain) && s.at && Date.now() - Date.parse(s.at) < windowMs
}
export function buildingPayload(domain: string) { return { domain: norm(domain), at: new Date().toISOString() } }
