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
 * - Images: through IPRoyal residential proxy (one shared sticky session per ad)
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

  let proxy: { url: string; close: () => Promise<void> } | null = null
  let proxyDispatcher: ProxyAgent | null = null

  try {
    // Only set up proxy if we have images to fetch (videos go direct)
    if (imageUrls.length > 0 && proxyChainEnabled) {
      const sid = sessionIdFor(opts.adId)
      proxy = await startProxyChain({ sessionId: sid, lifetime: '10m', country: 'us' })
      proxyDispatcher = new ProxyAgent(proxy.url)
    }

    async function fetchOne(url: string, contentType: string, useProxy: boolean): Promise<DownloadedAsset | null> {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000)
        const r = await undiciFetch(url, {
          dispatcher: useProxy ? (proxyDispatcher ?? undefined) : undefined,
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

    const [images, videos] = await Promise.all([
      Promise.all(imageUrls.map((u) => fetchOne(u, 'image/jpeg', true))),    // IPRoyal proxy
      Promise.all(videoUrls.map((u) => fetchOne(u, 'video/mp4', false))),    // droplet direct
    ])

    const successfulImages = images.filter((a): a is DownloadedAsset => a !== null)
    const successfulVideos = videos.filter((a): a is DownloadedAsset => a !== null)

    return {
      images: successfulImages,
      videos: successfulVideos,
      bytes_proxy_total: successfulImages.reduce((s, a) => s + a.bytes_proxy, 0),
      bytes_droplet_total: successfulVideos.reduce((s, a) => s + a.bytes_droplet, 0),
    }
  } finally {
    if (proxy) await proxy.close().catch(() => {})
  }
}
