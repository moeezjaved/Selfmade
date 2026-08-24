/**
 * Live Meta Ad Library engine for the ads workspace — the piece that lets us show a competitor's REAL
 * running ads (like Lapis), and DISCOVER in-niche advertisers Google organic misses.
 *
 * Two capabilities, both token-free (uses the same public Ad Library path + droplet/proxy infra the
 * crawler uses — see src/app/api/admin/brands/preview/route.ts, whose parsers this mirrors):
 *   • fetchLiveAdsByPage(pageId)  — a specific advertiser's active ads (droplet primary, proxy fallback).
 *   • searchAdLibrary(query)      — keyword search → advertisers (pageId + name + destination domain + ads),
 *                                    used both for BREADTH (new rivals) and to attach live ads to known ones.
 *
 * Everything degrades gracefully: with no droplet/proxy env, calls return [] and the workspace still shows
 * the Google-discovered rivals (accuracy), just without live ads.
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export type LiveAd = { adId: string; pageId: string; pageName: string; body: string; title: string; isActive: boolean; images: string[]; videos: string[]; link: string }
export type Advertiser = { pageId: string; pageName: string; domain: string | null; ads: LiveAd[] }

const rootDomain = (u: string): string | null => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase() } catch { return null } }

function buildProxyAgent(): ProxyAgent | undefined {
  const host = process.env.WORKER_PROXY_HOST, user = process.env.WORKER_PROXY_USER, pass = process.env.WORKER_PROXY_PASS
  if (!host || !user || !pass) return undefined
  const port = process.env.WORKER_PROXY_PORT || '12321'
  const sid = Math.random().toString(36).slice(2, 10)
  const country = (process.env.WORKER_PROXY_COUNTRY || 'us').toLowerCase()
  const stickyPass = `${pass}_session-${sid}_lifetime-5m_country-${country}`
  return new ProxyAgent(`http://${encodeURIComponent(user)}:${encodeURIComponent(stickyPass)}@${host}:${port}`)
}

/** Brace-match every ad_archive_id to its enclosing JSON object. Mirrors the verified indexer parser. */
function extractAdsBraceMatched(text: string): any[] {
  const found: any[] = []
  const re = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) positions.push(m.index)
  for (const pos of positions) {
    let start = pos
    while (start > 0 && text[start] !== '{') start--
    let depth = 0, end = start
    for (let i = start; i < text.length && i < start + 250_000; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === start) continue
    try { const obj = JSON.parse(text.slice(start, end)); if (obj.ad_archive_id) found.push(obj) } catch { /* skip */ }
  }
  return found
}

function extractMediaUrls(snap: any): { images: string[]; videos: string[] } {
  const images = new Set<string>(), videos = new Set<string>()
  const img = (...cs: any[]) => { for (const c of cs) if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) { images.add(c); return } }
  const vid = (...cs: any[]) => { for (const c of cs) if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) { videos.add(c); return } }
  for (const i of (snap?.images || [])) img(i?.original_image_url, i?.resized_image_url)
  for (const v of (snap?.videos || [])) vid(v?.video_hd_url, v?.video_sd_url)
  for (const c of (snap?.cards || [])) { img(c?.original_image_url, c?.resized_image_url); vid(c?.video_hd_url, c?.video_sd_url) }
  for (const i of (snap?.extra_images || [])) img(i?.original_image_url, i?.resized_image_url)
  for (const v of (snap?.extra_videos || [])) vid(v?.video_hd_url, v?.video_sd_url)
  return { images: Array.from(images), videos: Array.from(videos) }
}

function normalizeAd(obj: any): LiveAd {
  const snap = obj.snapshot || {}
  const media = extractMediaUrls(snap)
  return {
    adId: String(obj.ad_archive_id),
    pageId: String(obj.page_id || snap.page_id || ''),
    pageName: snap.page_name || obj.page_name || '',
    body: (snap.body?.text || '').slice(0, 400),
    title: (snap.title || snap.link_description || '').slice(0, 200),
    isActive: !!obj.is_active,
    images: media.images,
    videos: media.videos,
    link: snap.link_url || snap.caption || snap.page_profile_uri || '',
  }
}

/** One proxy GET of an Ad Library URL → parsed ad objects. Returns [] when no proxy env or Meta gates us. */
async function fetchLibraryHtml(url: string): Promise<any[]> {
  const dispatcher = buildProxyAgent()
  if (!dispatcher) return []
  try {
    const res = await undiciFetch(url, {
      dispatcher,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1' },
      signal: AbortSignal.timeout(22_000),
    })
    if (!res.ok) return []
    return extractAdsBraceMatched(await res.text())
  } catch { return [] }
}

/** A specific advertiser's active ads. Droplet primary (reliable), proxy fallback. */
export async function fetchLiveAdsByPage(pageId: string, limit = 8): Promise<LiveAd[]> {
  if (!/^\d+$/.test(pageId)) return []
  const dropletUrl = process.env.DROPLET_PREVIEW_URL, dropletSecret = process.env.PREVIEW_SECRET
  if (dropletUrl && dropletSecret) {
    try {
      const u = new URL('/preview', dropletUrl)
      u.searchParams.set('page_id', pageId); u.searchParams.set('limit', String(limit))
      const r = await undiciFetch(u.toString(), { headers: { 'X-Preview-Secret': dropletSecret }, signal: AbortSignal.timeout(40_000) })
      if (r.ok) {
        const data: any = await r.json()
        const ads = Array.isArray(data?.ads) ? data.ads : []
        return ads.slice(0, limit).map((a: any) => ({
          adId: String(a.ad_id), pageId: String(data?.page?.page_id || pageId), pageName: a.page_name || data?.page?.name || '',
          body: (a.body || '').slice(0, 400), title: (a.title || '').slice(0, 200), isActive: a.is_active ?? true,
          images: a.image_urls || [], videos: a.video_urls || [], link: a.snapshot_url || '',
        }))
      }
    } catch { /* fall through to proxy */ }
  }
  const objs = await fetchLibraryHtml(`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`)
  return objs.slice(0, limit).map(normalizeAd)
}

/** Keyword search → advertisers (grouped by page), each with destination domain + sample ads.
 * Droplet /search primary (Playwright + IPRoyal — beats Meta's cloud-IP gating), bare proxy fallback. */
export async function searchAdLibrary(query: string, country = 'ALL', perPageLimit = 4): Promise<Advertiser[]> {
  const dropletUrl = process.env.DROPLET_PREVIEW_URL, dropletSecret = process.env.PREVIEW_SECRET
  if (dropletUrl && dropletSecret) {
    try {
      const u = new URL('/search', dropletUrl)
      u.searchParams.set('q', query); u.searchParams.set('country', country); u.searchParams.set('limit', '60')
      const r = await undiciFetch(u.toString(), { headers: { 'X-Preview-Secret': dropletSecret }, signal: AbortSignal.timeout(70_000) })
      if (r.ok) {
        const data: any = await r.json()
        return (Array.isArray(data?.advertisers) ? data.advertisers : []).map((a: any): Advertiser => ({
          pageId: String(a.page_id), pageName: a.page_name || '', domain: a.domain || null,
          ads: (a.ads || []).slice(0, perPageLimit).map((ad: any): LiveAd => ({
            adId: String(ad.ad_id), pageId: String(a.page_id), pageName: a.page_name || '',
            body: (ad.body || '').slice(0, 400), title: (ad.title || '').slice(0, 200), isActive: ad.is_active ?? true,
            images: ad.image_urls || [], videos: ad.video_urls || [], link: ad.link || '',
          })),
        }))
      }
    } catch { /* fall through to bare proxy */ }
  }
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(query)}&search_type=keyword_unordered&media_type=all`
  const objs = await fetchLibraryHtml(url)
  const byPage = new Map<string, LiveAd[]>()
  for (const o of objs) {
    const ad = normalizeAd(o)
    if (!ad.pageId) continue
    const arr = byPage.get(ad.pageId) || []
    arr.push(ad); byPage.set(ad.pageId, arr)
  }
  const advertisers: Advertiser[] = []
  Array.from(byPage.entries()).forEach(([pageId, ads]) => {
    const domCount = new Map<string, number>()
    for (const a of ads) { const d = rootDomain(a.link); if (d && !d.includes('facebook.com') && !d.includes('fb.com')) domCount.set(d, (domCount.get(d) || 0) + 1) }
    const domain = Array.from(domCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    advertisers.push({ pageId, pageName: ads.find((a: LiveAd) => a.pageName)?.pageName || '', domain, ads: ads.slice(0, perPageLimit) })
  })
  return advertisers
}
