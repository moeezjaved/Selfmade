/**
 * DataForSEO client — real Google SERP ranks + search volume for the audit's Google-visibility section.
 * Gated on env (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD): when absent, the scan falls back to its honest
 * "connect a search source" placeholder. Cheap, pay-as-you-go — a handful of SERP calls per scan.
 */
const LOGIN = process.env.DATAFORSEO_LOGIN || ''
const PASSWORD = process.env.DATAFORSEO_PASSWORD || ''
const BASE = 'https://api.dataforseo.com/v3'

export function dfsConfigured(): boolean { return !!(LOGIN && PASSWORD) }

function authHeader(): string {
  const b64 = typeof btoa === 'function' ? btoa(`${LOGIN}:${PASSWORD}`) : Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64')
  return `Basic ${b64}`
}

async function post(path: string, payload: any[]): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.status_code >= 40000) throw new Error(j.status_message || `DataForSEO ${r.status}`)
  return j
}

export type SerpRow = { domain: string; url: string; position: number }
export type SerpResult = { keyword: string; volume: number | null; top: SerpRow[]; yourPosition: number | null }

const rootDomain = (u: string) => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u.replace(/^www\./, '') } }

/** Live Google organic SERP for one keyword (US/English). Returns the top results + where `yourDomain` ranks. */
export async function serpGoogle(keyword: string, yourDomain: string): Promise<SerpResult | null> {
  try {
    const j = await post('/serp/google/organic/live/advanced', [{ keyword, location_code: 2840, language_code: 'en', depth: 50 }])
    const items = j?.tasks?.[0]?.result?.[0]?.items || []
    const organic = items.filter((it: any) => it.type === 'organic' && it.domain).map((it: any) => ({ domain: String(it.domain).replace(/^www\./, ''), url: it.url || '', position: it.rank_absolute || it.rank_group || 0 }))
    const yd = rootDomain(yourDomain)
    const mine = organic.find((o: SerpRow) => o.domain === yd)
    return { keyword, volume: null, top: organic.slice(0, 10), yourPosition: mine ? mine.position : null }
  } catch { return null }
}

export type SerpOrganicItem = { domain: string; url: string; title: string; snippet: string; position: number }
/** DataForSEO location_code for the big DTC markets — used to discover competitors in the store's own market. */
export const MARKET_LOCATION: Record<string, number> = {
  pakistan: 2586, india: 2356, bangladesh: 2050, 'united states': 2840, usa: 2840, us: 2840,
  'united kingdom': 2826, uk: 2826, uae: 2784, 'united arab emirates': 2784, 'saudi arabia': 2682,
  canada: 2124, australia: 2036, nigeria: 2566, kenya: 2404, 'south africa': 2710, philippines: 2608,
  indonesia: 2360, malaysia: 2458, turkey: 2792, germany: 2276, france: 2250, brazil: 2076, mexico: 2484,
}
/** Live Google organic SERP with title + snippet for competitor DISCOVERY. locationCode defaults to US. */
export async function serpDiscover(keyword: string, locationCode = 2840): Promise<SerpOrganicItem[]> {
  try {
    const j = await post('/serp/google/organic/live/advanced', [{ keyword, location_code: locationCode, language_code: 'en', depth: 30 }])
    const items = j?.tasks?.[0]?.result?.[0]?.items || []
    return items.filter((it: any) => it.type === 'organic' && it.domain).map((it: any) => ({
      domain: String(it.domain).replace(/^www\./, ''), url: it.url || '',
      title: String(it.title || ''), snippet: String(it.description || it.snippet || ''),
      position: it.rank_absolute || it.rank_group || 0,
    }))
  } catch { return [] }
}

export type BacklinkSummary = { backlinks: number; referringDomains: number; rank: number }
/** Backlink profile for a domain — for the backlink-gap finding. */
export async function backlinksSummary(domain: string): Promise<BacklinkSummary | null> {
  try {
    const j = await post('/backlinks/summary/live', [{ target: domain, internal_list_limit: 1, backlinks_status_type: 'live' }])
    const r = j?.tasks?.[0]?.result?.[0]
    if (!r) return null
    return { backlinks: Number(r.backlinks) || 0, referringDomains: Number(r.referring_domains) || 0, rank: Number(r.rank) || 0 }
  } catch { return null }
}

/** Search volume for a batch of keywords. */
export async function searchVolume(keywords: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (!keywords.length) return out
  try {
    const j = await post('/keywords_data/google_ads/search_volume/live', [{ keywords: keywords.slice(0, 20), location_code: 2840, language_code: 'en' }])
    const items = j?.tasks?.[0]?.result || []
    for (const it of items) if (it.keyword) out[String(it.keyword).toLowerCase()] = Number(it.search_volume) || 0
  } catch { /* volumes optional */ }
  return out
}
