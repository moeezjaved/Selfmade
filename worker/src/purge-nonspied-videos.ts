/**
 * Purge discovery VIDEO creatives that no user cares about — to cut R2 storage cost.
 *
 * KEEP a video if EITHER:
 *   • its brand is SPIED   → followed_brands.spied = true   (by page_id), or
 *   • its ad was SAVED     → discovery_saved_ads            (by ad_id).
 * Everything else: delete the .mp4 from R2 (bucket `selfmade-ads`, keys `videos/…`).
 *   • A VIDEO-ONLY ad (no real image creative) is removed entirely — the index row is deleted, which
 *     cascades its discovery_creatives rows; its poster (`posters/…`) is deleted too.
 *   • An ad that ALSO has a real image keeps the image: we only drop the video creative + null its
 *     video_url. The image, its thumb, and the ad stay.
 * Images (`thumbnails/…`, `thumbs/…`) and every KEPT ad's media are never touched. User-GENERATED
 * videos live in a DIFFERENT bucket and are not in scope here.
 *
 * Run on the droplet:
 *   docker exec worker node dist/purge-nonspied-videos.js --dry-run   # review counts + GB, deletes nothing
 *   docker exec worker node dist/purge-nonspied-videos.js             # execute
 *
 * Safe by design: scans fully BEFORE deleting; only ever deletes keys under videos/ or posters/;
 * idempotent + resumable (re-run anytime). Spied brands re-crawl and non-spied brands are not
 * re-crawled, so purged videos do not come back.
 */
import { supabase } from './db.js'
import { r2UrlToKey, listSizesByPrefix, deleteManyFromR2 } from './r2.js'

const DRY = process.argv.includes('--dry-run')
const PAGE = 500
// Cloudflare R2 standard storage: $0.015 per GB-month (egress is free). Dashboard is authoritative;
// this is just to turn "GB reclaimed" into an at-a-glance $/month so you don't have to do the math.
const R2_USD_PER_GB_MONTH = 0.015

async function loadIdSet(table: string, column: string, filter?: (q: any) => any): Promise<Set<string>> {
  const set = new Set<string>()
  let from = 0
  for (;;) {
    let q = (supabase as any).from(table).select(column).range(from, from + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}.${column}: ${error.message}`)
    if (!data?.length) break
    for (const r of data as any[]) if (r[column] != null) set.add(String(r[column]))
    from += data.length
    if (data.length < PAGE) break
  }
  return set
}

async function main() {
  console.log(`\n🎬 Purge non-spied discovery videos ${DRY ? '(DRY RUN — nothing will be deleted)' : '(LIVE)'}\n`)

  // 1) Keep-sets
  const keepPages = await loadIdSet('followed_brands', 'page_id', (q) => q.eq('spied', true))
  const keepAds = await loadIdSet('discovery_saved_ads', 'ad_id')
  console.log(`   Keep: ${keepPages.size} spied brands · ${keepAds.size} saved ads\n`)

  // 2) R2 sizes — one full-bucket listing so we can show current TOTAL, what's freed, and the new
  //    total. Cheap (Class B list ops), no HEAD-per-object.
  console.log('📦 Listing the whole bucket to measure sizes…')
  const allSizes = await listSizesByPrefix('')
  const videoSizes = new Map<string, number>()
  const posterSizes = new Map<string, number>()
  let totalBytes = 0, videoBytesAll = 0, imageBytesAll = 0, posterBytesAll = 0, otherBytes = 0
  let videoCount = 0, imageCount = 0, posterCount = 0
  for (const [k, sz] of allSizes) {
    totalBytes += sz
    if (k.startsWith('videos/')) { videoSizes.set(k, sz); videoBytesAll += sz; videoCount++ }
    else if (k.startsWith('posters/')) { posterSizes.set(k, sz); posterBytesAll += sz; posterCount++ }
    else if (k.startsWith('thumbnails/') || k.startsWith('thumbs/')) { imageBytesAll += sz; imageCount++ }
    else otherBytes += sz
  }
  const gbAll = (n: number) => (n / 1073741824).toFixed(2)
  console.log(`\n📁 Bucket breakdown (${allSizes.size} objects · ${gbAll(totalBytes)} GB total)`)
  console.log(`   Videos:   ${videoCount.toLocaleString()} objects · ${gbAll(videoBytesAll)} GB`)
  console.log(`   Images:   ${imageCount.toLocaleString()} objects · ${gbAll(imageBytesAll)} GB  (thumbnails/ + thumbs/ — never deleted)`)
  console.log(`   Posters:  ${posterCount.toLocaleString()} objects · ${gbAll(posterBytesAll)} GB`)
  if (otherBytes > 0) console.log(`   Other:    ${gbAll(otherBytes)} GB`)
  console.log('')

  // 3) Scan every ad that has an R2 video, decide keep/strip/delete
  let scanned = 0, keptSpied = 0, keptSaved = 0, delEntire = 0, stripped = 0
  const videoKeys = new Set<string>()
  const posterKeys = new Set<string>()
  const adsToDelete: string[] = []
  const adsToStrip: string[] = []

  let from = 0
  for (;;) {
    const { data, error } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_id, video_url, thumbnail_url')
      .ilike('video_url', '%r2%')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`scan: ${error.message}`)
    const rows = (data as any[]) || []
    if (!rows.length) break

    // Batch-load this page's creatives so we know image-vs-video per ad in one query.
    const adIds = rows.map((a) => a.ad_id)
    const { data: cre } = await (supabase as any)
      .from('discovery_creatives').select('ad_id, asset_type, r2_url, poster_url').in('ad_id', adIds)
    const byAd = new Map<string, { images: number; vids: { r2: string | null; poster: string | null }[] }>()
    for (const c of (cre as any[]) || []) {
      const e = byAd.get(c.ad_id) || { images: 0, vids: [] }
      if (c.asset_type === 'image') e.images++
      else if (c.asset_type === 'video') e.vids.push({ r2: c.r2_url, poster: c.poster_url })
      byAd.set(c.ad_id, e)
    }

    for (const a of rows) {
      scanned++
      if (keepPages.has(String(a.page_id))) { keptSpied++; continue }
      if (keepAds.has(String(a.ad_id))) { keptSaved++; continue }

      const info = byAd.get(a.ad_id)
      const thumbIsImage = typeof a.thumbnail_url === 'string' && /\/(thumbnails|thumbs)\//.test(a.thumbnail_url)
      const hasImage = (info?.images || 0) > 0 || thumbIsImage

      // Every R2 video for this ad (index.video_url + any discovery_creatives video rows).
      const k0 = r2UrlToKey(a.video_url); if (k0) videoKeys.add(k0)
      for (const v of info?.vids || []) { const k = r2UrlToKey(v.r2); if (k) videoKeys.add(k) }
      // The video's own poster is always safe to drop.
      for (const v of info?.vids || []) { const k = r2UrlToKey(v.poster); if (k) posterKeys.add(k) }

      if (hasImage) {
        stripped++; adsToStrip.push(a.ad_id)
      } else {
        delEntire++; adsToDelete.push(a.ad_id)
        const tk = r2UrlToKey(a.thumbnail_url); if (tk) posterKeys.add(tk)   // the ad's poster thumbnail
      }
    }

    from += rows.length
    if (scanned % 10000 < PAGE) console.log(`   …scanned ${scanned}`)
    if (rows.length < PAGE) break
  }

  // Safety: only ever touch videos/ and posters/ keys.
  const safeVideo = [...videoKeys].filter((k) => k.startsWith('videos/'))
  const safePoster = [...posterKeys].filter((k) => k.startsWith('posters/'))
  const skipped = (videoKeys.size - safeVideo.length) + (posterKeys.size - safePoster.length)

  const vBytes = safeVideo.reduce((s, k) => s + (videoSizes.get(k) ?? 0), 0)
  const pBytes = safePoster.reduce((s, k) => s + (posterSizes.get(k) ?? 0), 0)
  const freedBytes = vBytes + pBytes
  const gb = (n: number) => (n / 1073741824).toFixed(2)
  const freedGB = freedBytes / 1073741824
  const totalGB = totalBytes / 1073741824
  const afterGB = Math.max(0, totalGB - freedGB)
  const pct = totalGB > 0 ? (freedGB / totalGB) * 100 : 0
  const usdNow = totalGB * R2_USD_PER_GB_MONTH
  const usdAfter = afterGB * R2_USD_PER_GB_MONTH
  const usdSaved = freedGB * R2_USD_PER_GB_MONTH

  console.log(`\n📊 Result`)
  console.log(`   Scanned ads with an R2 video:     ${scanned}`)
  console.log(`   Kept — spied brand:               ${keptSpied}`)
  console.log(`   Kept — saved by a user:           ${keptSaved}`)
  console.log(`   Remove entirely (video-only ad):  ${delEntire}`)
  console.log(`   Strip video, keep the image:      ${stripped}`)
  console.log(`   Video objects to delete:          ${safeVideo.length}  (${gb(vBytes)} GB)`)
  console.log(`   Poster objects to delete:         ${safePoster.length}  (${gb(pBytes)} GB)`)
  if (skipped) console.log(`   ⚠️  Skipped ${skipped} keys outside videos/ or posters/ (safety guard)`)

  console.log(`\n💾 Storage`)
  console.log(`   Bucket now:        ${totalGB.toFixed(2)} GB`)
  console.log(`   Freed by purge:   -${freedGB.toFixed(2)} GB  (${pct.toFixed(0)}% of the bucket)`)
  console.log(`   Bucket after:      ${afterGB.toFixed(2)} GB`)
  console.log(`\n💰 Cost (R2 storage @ $${R2_USD_PER_GB_MONTH}/GB-month; egress is free)`)
  console.log(`   Storage now:       ~$${usdNow.toFixed(2)}/month`)
  console.log(`   Storage after:     ~$${usdAfter.toFixed(2)}/month`)
  console.log(`   You save:          ~$${usdSaved.toFixed(2)}/month\n`)

  if (DRY) { console.log('✅ Dry run complete — nothing deleted. Re-run without --dry-run to execute.\n'); return }

  console.log('🗑  Deleting R2 objects…')
  const del = await deleteManyFromR2([...safeVideo, ...safePoster])
  console.log(`   deleted ${del} R2 objects`)

  console.log('🗑  Removing video-only ad rows (cascades to creatives)…')
  for (let i = 0; i < adsToDelete.length; i += 500) {
    const b = adsToDelete.slice(i, i + 500)
    const { error } = await (supabase as any).from('discovery_ads_index').delete().in('ad_id', b)
    if (error) console.warn(`   ⚠️  row delete error: ${error.message}`)
  }
  console.log(`   removed ${adsToDelete.length} video-only ads`)

  console.log('🧹 Stripping video from mixed ads (keeping the image)…')
  for (let i = 0; i < adsToStrip.length; i += 500) {
    const b = adsToStrip.slice(i, i + 500)
    await (supabase as any).from('discovery_creatives').delete().in('ad_id', b).eq('asset_type', 'video')
    await (supabase as any).from('discovery_ads_index')
      .update({ video_url: null, raw_video_urls: null, raw_video_preview_urls: null }).in('ad_id', b)
  }
  console.log(`   stripped ${adsToStrip.length} mixed ads`)

  console.log('\n✅ Done. R2 storage will drop within a day or two as billing re-measures.\n')
}

main().catch((e) => { console.error('❌', e instanceof Error ? e.message : e); process.exit(1) })
