/**
 * Hybrid downloader for raw fbcdn URLs.
 *
 * IMAGES — go through IPRoyal residential proxy.
 *   Meta's image CDN (scontent-*.xx.fbcdn.net) gates unauthenticated
 *   cloud-IP fetches with a 1087-byte placeholder. Verified empirically.
 *   So we route image downloads through a per-ad sticky residential session.
 *
 * VIDEOS — go DIRECTLY from the droplet (no proxy).
 *   Meta's video CDN (video-*.xx.fbcdn.net) accepts bare cloud-IP fetches
 *   and returns full content. Verified 2026-05-15: a 1.4 MB HD video
 *   downloaded in 0.4s direct from droplet, no proxy needed.
 *
 *   Why this matters: videos are 5-15 MB each. Routing them through IPRoyal
 *   was eating ~60% of all proxy bandwidth. Sending video bytes through the
 *   droplet's DigitalOcean bandwidth (5 TB/mo included) makes them effectively
 *   free in IPRoyal accounting.
 *
 * Both paths add Facebook referer + browser-like headers so Meta's CDN
 * serves real bytes instead of gating.
 */
import { ProxyAgent } from 'undici'
import { fetch as undiciFetch } from 'undici'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { pickProxy, openProxyChain, recordEvent, proxyPoolEnabled } from './proxy-pool.js'

const PLACEHOLDER_BYTES = 2_000   // anything smaller is the gated 1087-byte placeholder

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function sessionIdFor(adId: string): string {
  const clean = adId.replace(/\D/g, '')
  return clean.length >= 8 ? clean.slice(-8) : clean.padStart(8, '0')
}

export interface DownloadedAsset {
  url: string
  buffer: Buffer
  contentType: string
  bytes_proxy: number       // bytes that went through IPRoyal proxy (0 for videos)
  bytes_droplet: number     // bytes that went direct from droplet (0 for images)
}

/**
 * Download a list of raw fbcdn URLs (images and/or videos) for a single ad.
 *
 * - Images: direct from droplet (fbcdn serves signed image URLs to any IP);
 *   falls back to a pool proxy only if a direct fetch fails (rare).
 * - Videos: direct from droplet, no proxy (Meta video CDN doesn't gate cloud IPs)
 *
 * Returns only assets that came back as non-placeholder content, plus a
 * bandwidth breakdown so the caller can track IPRoyal vs droplet cost.
 */
export async function downloadAssetsForAd(opts: {
  adId: string
  imageUrls?: string[]
  videoUrls?: string[]
  timeoutMs?: number
}): Promise<{
  images: DownloadedAsset[]
  videos: DownloadedAsset[]
  bytes_proxy_total: number
  bytes_droplet_total: number
}> {
  const imageUrls = opts.imageUrls || []
  const videoUrls = opts.videoUrls || []
  if (imageUrls.length === 0 && videoUrls.length === 0) {
    return { images: [], videos: [], bytes_proxy_total: 0, bytes_droplet_total: 0 }
  }

  // Held in an object so TS keeps the union type across the nested ensureProxy
  // closure (a bare `let` reassigned only inside a closure narrows to `never`).
  const st: {
    proxy: { url: string; close: () => Promise<void> } | null
    dispatcher: ProxyAgent | null
    poolId: string | null
  } = { proxy: null, dispatcher: null, poolId: null }

  try {
    // Lazily acquire a proxy ONLY if a direct image fetch fails. fbcdn serves
    // signed image URLs to the droplet IP directly (verified 2026-06-16: 200 OK,
    // 0.4-0.7s), so images normally cost ZERO pool budget — freeing the 4 crawl
    // IPs for actual crawling. The proxy stays as a safety net for the rare URL
    // that 403s direct.
    let proxyTried = false
    async function ensureProxy(): Promise<boolean> {
      if (proxyTried) return !!st.dispatcher
      proxyTried = true
      if (proxyPoolEnabled) {
        const p = await pickProxy()
        if (p) { st.proxy = await openProxyChain(p); st.dispatcher = new ProxyAgent(st.proxy.url); st.poolId = p.id }
      }
      if (!st.proxy && proxyChainEnabled) {
        const sid = sessionIdFor(opts.adId)
        st.proxy = await startProxyChain({ sessionId: sid, lifetime: '10m', country: 'us' })
        st.dispatcher = new ProxyAgent(st.proxy.url)
      }
      return !!st.dispatcher
    }

    async function fetchOne(url: string, contentType: string, useProxy: boolean): Promise<DownloadedAsset | null> {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000)
        const r = await undiciFetch(url, {
          dispatcher: useProxy ? (st.dispatcher ?? undefined) : undefined,
          signal: ctrl.signal,
          headers: {
            'User-Agent': UA,
            'Referer': 'https://www.facebook.com/',
            'Accept': contentType.startsWith('video') ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': contentType.startsWith('video') ? 'video' : 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
          },
        })
        clearTimeout(timer)
        if (!r.ok) return null
        const ab = await r.arrayBuffer()
        const buf = Buffer.from(ab)
        if (buf.byteLength < PLACEHOLDER_BYTES) return null
        return {
          url,
          buffer: buf,
          contentType,
          bytes_proxy: useProxy ? buf.byteLength : 0,
          bytes_droplet: useProxy ? 0 : buf.byteLength,
        }
      } catch {
        return null
      }
    }

    // Images: direct from droplet first; only fall back to a pool proxy if the
    // direct fetch fails (rare). Videos: always direct.
    async function fetchImage(url: string): Promise<DownloadedAsset | null> {
      // DIRECT-ONLY — never use the metered IPRoyal proxy for images (protects
      // credits). fbcdn serves them to the droplet directly; on a transient miss
      // retry once direct, else skip (re-tried on the next crawl).
      const direct = await fetchOne(url, 'image/jpeg', false)
      if (direct) return direct
      void ensureProxy  // (kept for videos/edge cases; images never proxy)
      return await fetchOne(url, 'image/jpeg', false)
    }

    const [images, videos] = await Promise.all([
      Promise.all(imageUrls.map(fetchImage)),                                 // direct, proxy fallback
      Promise.all(videoUrls.map((u) => fetchOne(u, 'video/mp4', false))),    // droplet direct
    ])

    const successfulImages = images.filter((a): a is DownloadedAsset => a !== null)
    const successfulVideos = videos.filter((a): a is DownloadedAsset => a !== null)
    const bytesProxyTotal = successfulImages.reduce((s, a) => s + a.bytes_proxy, 0)

    // Log per-ad asset event to the pool if we used a pool proxy
    if (st.poolId) {
      recordEvent({
        proxyId: st.poolId,
        kind: 'asset',
        bytes: bytesProxyTotal,
        brandPageId: opts.adId,
      })
    }

    return {
      images: successfulImages,
      videos: successfulVideos,
      bytes_proxy_total: bytesProxyTotal,
      bytes_droplet_total:
        successfulVideos.reduce((s, a) => s + a.bytes_droplet, 0) +
        successfulImages.reduce((s, a) => s + a.bytes_droplet, 0),  // direct image bytes
    }
  } finally {
    if (st.proxy) await st.proxy.close().catch(() => {})
  }
}
