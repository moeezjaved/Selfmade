/**
 * Browserless downloader for raw fbcdn URLs.
 *
 * Used by the worker's fast path: when the indexer has populated
 * raw_image_urls / raw_video_urls on a row, we already know the exact
 * fbcdn URLs and don't need Playwright. We just need to download them
 * through a residential proxy + Facebook referer (Meta's CDN gates
 * unauthenticated bare requests with 1087-byte placeholders).
 *
 * Architecture:
 *   1. Spin up a per-ad proxy-chain sticky session (same residential IP
 *      for all assets of one ad — looks like a normal user fetching the
 *      images of a page they just visited)
 *   2. Use undici's ProxyAgent to route fetch through that localhost URL
 *   3. Add headers Meta expects (referer, user-agent, accept)
 *   4. Reject responses < 2KB as placeholders
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
}

/**
 * Download a list of raw fbcdn URLs (images and/or videos) for a single ad
 * through a per-ad sticky residential session. Returns only assets that
 * came back as non-placeholder content.
 *
 * Caller is responsible for passing only URLs that belong to one logical
 * ad — they all share the proxy session.
 */
export async function downloadAssetsForAd(opts: {
  adId: string
  imageUrls?: string[]
  videoUrls?: string[]
  timeoutMs?: number
}): Promise<{ images: DownloadedAsset[]; videos: DownloadedAsset[] }> {
  const imageUrls = opts.imageUrls || []
  const videoUrls = opts.videoUrls || []
  if (imageUrls.length === 0 && videoUrls.length === 0) {
    return { images: [], videos: [] }
  }

  let proxy: { url: string; close: () => Promise<void> } | null = null
  let dispatcher: ProxyAgent | null = null

  try {
    if (proxyChainEnabled) {
      const sid = sessionIdFor(opts.adId)
      proxy = await startProxyChain({ sessionId: sid, lifetime: '10m', country: 'us' })
      dispatcher = new ProxyAgent(proxy.url)
    }

    async function fetchOne(url: string, contentType: string): Promise<DownloadedAsset | null> {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
        const r = await undiciFetch(url, {
          dispatcher: dispatcher ?? undefined,
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
        return { url, buffer: buf, contentType }
      } catch {
        return null
      }
    }

    const [images, videos] = await Promise.all([
      Promise.all(imageUrls.map((u) => fetchOne(u, 'image/jpeg'))),
      Promise.all(videoUrls.map((u) => fetchOne(u, 'video/mp4'))),
    ])

    return {
      images: images.filter((a): a is DownloadedAsset => a !== null),
      videos: videos.filter((a): a is DownloadedAsset => a !== null),
    }
  } finally {
    if (proxy) await proxy.close().catch(() => {})
  }
}
