/**
 * Video poster backfill — re-host FB's preview frames → R2, set
 * discovery_creatives.poster_url so the grid shows the real first frame.
 *
 * The crawler already stores FB's `video_preview_image_url` in
 * discovery_ads_index.raw_video_preview_urls (zero IPRoyal). This re-hosts that frame
 * to R2 (direct-first download, proxy fallback — same path as image creatives) and
 * attaches it to the VIDEO creative. Standalone: does NOT touch the running drain.
 *
 * Run (gentle — keep CONCURRENCY low while the crawl box is busy):
 *   docker run --rm --env-file /opt/worker/.env selfmade-worker \
 *     npx tsx src/poster-backfill.ts
 *   # tunables: POSTER_CONCURRENCY (default 2), POSTER_BATCH (default 150)
 *
 * Keysets by indexed_at DESC (newest first) so fresh ads get their poster before FB's
 * signed preview URL expires. processAd is a no-op for ads already postered, so it
 * converges. Re-run anytime to catch newly-crawled ads. For old ads whose preview URL
 * has expired, the poster can instead be extracted from the stored mp4 later (no loss).
 */
import { supabase } from './db.js'
import { downloadAssetsForAd } from './proxied-fetch.js'
import { uploadBufferToR2 } from './r2.js'
import { imageHash } from './hash.js'

const CONCURRENCY = Math.max(1, parseInt(process.env.POSTER_CONCURRENCY ?? '2', 10))
const BATCH = Math.max(20, parseInt(process.env.POSTER_BATCH ?? '150', 10))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let postered = 0
let scanned = 0

async function processAd(adId: string, previews: string[]): Promise<void> {
  if (!previews?.length) return
  // Only video creatives that still lack a poster.
  const { data: vids } = await (supabase as any)
    .from('discovery_creatives')
    .select('id, position')
    .eq('ad_id', adId)
    .eq('asset_type', 'video')
    .is('poster_url', null)
  if (!vids?.length) return

  // Download the preview frame(s) — direct from the droplet IP where possible (signed
  // fbcdn URL), proxy only as fallback. Returns the raw buffers.
  let res
  try {
    res = await downloadAssetsForAd({ adId, imageUrls: previews.slice(0, 6), timeoutMs: 20_000 })
  } catch { return }
  if (!res.images.length) return

  // Hash + upload each frame to R2 → public poster URL.
  const posters: (string | null)[] = []
  for (const img of res.images) {
    const h = await imageHash(img.buffer).catch(() => null)
    const key = `posters/${h || `${adId}_${posters.length}`}.jpg`
    posters.push(await uploadBufferToR2(img.buffer, key, img.contentType || 'image/jpeg'))
  }
  const firstPoster = posters.find(Boolean) || null
  if (!firstPoster) return

  // video creative at position i → poster i (fall back to the first available).
  for (const v of vids as Array<{ id: string; position: number }>) {
    const url = posters[v.position] || firstPoster
    if (url) await (supabase as any).from('discovery_creatives').update({ poster_url: url }).eq('id', v.id)
  }
  postered++
}

async function main() {
  console.log(`🖼️  poster-backfill started (concurrency=${CONCURRENCY}, batch=${BATCH})`)
  let cursor: string | null = null   // indexed_at keyset, newest first
  for (;;) {
    let q = (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, indexed_at, raw_video_preview_urls')
      .not('raw_video_preview_urls', 'is', null)
      .order('indexed_at', { ascending: false })
      .limit(BATCH)
    if (cursor) q = q.lt('indexed_at', cursor)
    const { data: ads, error } = await q
    if (error) { console.error('query failed:', error.message); break }
    if (!ads?.length) break

    for (let i = 0; i < ads.length; i += CONCURRENCY) {
      const chunk = ads.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map((a: any) => processAd(a.ad_id, a.raw_video_preview_urls)))
      scanned += chunk.length
      await sleep(150)   // gentle on the box + R2
    }
    cursor = ads[ads.length - 1].indexed_at
    console.log(`  scanned ${scanned} · postered ${postered}`)
  }
  console.log(`✅ poster-backfill done — scanned ${scanned}, postered ${postered}`)
  process.exit(0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
