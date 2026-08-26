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
const WITH_IMAGES = process.argv.includes('--with-images')
// Orphan sweep: most of the bucket's video files have NO surviving ad row (old crawls, prior purges), so
// the ad-driven scan can't see them. This mode deletes by KEY instead — every videos/{adId}_*.mp4 whose
// adId isn't in the keep set (spied brands' current ads + saved ads). Reclaims the orphaned TBs.
const ORPHANS = process.argv.includes('--orphans')
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

  // ── ORPHAN SWEEP ── delete by R2 key, not by DB ad. Most video files have no surviving ad row.
  if (ORPHANS) {
    console.log(`🧹 Orphan sweep ${DRY ? '(DRY RUN)' : '(LIVE)'} — deleting videos/{adId}.mp4 not owned by a spied/saved ad.\n`)
    // Build keepAdIds = saved ad_ids ∪ every current ad_id under a spied page.
    const keepAdIds = new Set<string>(keepAds)
    if (keepPages.size) {
      const pages = [...keepPages]
      for (let i = 0; i < pages.length; i += 50) {
        const chunk = pages.slice(i, i + 50)
        let from = 0
        for (;;) {
          const { data, error } = await (supabase as any).from('discovery_ads_index').select('ad_id').in('page_id', chunk).range(from, from + 1000 - 1)
          if (error) throw new Error(`spied ad_ids: ${error.message}`)
          const rows = (data as any[]) || []
          for (const r of rows) if (r.ad_id) keepAdIds.add(String(r.ad_id))
          from += rows.length
          if (rows.length < 1000) break
        }
      }
    }
    console.log(`   Keep set: ${keepAdIds.size.toLocaleString()} ad_ids (spied + saved)\n`)

    console.log('📦 Listing videos/ …')
    const gbAll = (n: number) => (n / 1073741824).toFixed(2)
    const videoSizes = await listSizesByPrefix('videos/', (c, b) => process.stdout.write(`\r   …videos: ${c.toLocaleString()} objects (${gbAll(b)} GB)   `))
    console.log('')

    // A video key is videos/{adId}_{position}.mp4 — extract adId and keep only spied/saved.
    const toDelete: string[] = []
    let keptBytes = 0, delBytes = 0, unparsed = 0
    for (const [key, size] of videoSizes) {
      const m = key.match(/^videos\/(.+)_\d+\.mp4$/i)
      if (!m) { unparsed++; continue }         // unexpected key shape → never touch it
      const adId = m[1]
      if (keepAdIds.has(adId)) { keptBytes += size; continue }
      toDelete.push(key); delBytes += size
    }
    console.log(`\n📊 Orphan sweep result`)
    console.log(`   Video objects total:   ${videoSizes.size.toLocaleString()}  (${gbAll(keptBytes + delBytes)} GB)`)
    console.log(`   Kept (spied/saved):    ${(videoSizes.size - toDelete.length - unparsed).toLocaleString()}  (${gbAll(keptBytes)} GB)`)
    console.log(`   To DELETE:             ${toDelete.length.toLocaleString()}  (${gbAll(delBytes)} GB)`)
    if (unparsed) console.log(`   ⚠️  Skipped ${unparsed} keys with an unexpected shape (never deleted)`)
    console.log(`   ≈ Save: $${((delBytes / 1073741824) * R2_USD_PER_GB_MONTH).toFixed(2)}/month\n`)

    if (DRY) { console.log('✅ Dry run — nothing deleted. Re-run with --orphans (no --dry-run) to execute.\n'); return }
    console.log('🗑  Deleting orphaned + non-spied video objects…')
    const del = await deleteManyFromR2(toDelete)
    console.log(`   deleted ${del.toLocaleString()} objects (${gbAll(delBytes)} GB)\n✅ Done.\n`)
    return
  }

  // 2) R2 sizes. By DEFAULT we list only the prefixes we may delete (videos/ + posters/) — that's all
  //    that's needed to price the reclaim, and it's fast. Pass --with-images to ALSO measure the image
  //    prefixes (thumbnails/ + thumbs/) for a full bucket breakdown — slower (millions of small objects).
  const gbAll = (n: number) => (n / 1073741824).toFixed(2)
  const prog = (label: string) => (count: number, bytes: number) => process.stdout.write(`\r   …${label}: ${count.toLocaleString()} objects (${gbAll(bytes)} GB)   `)

  console.log('📦 Listing videos/ …')
  const videoSizes = await listSizesByPrefix('videos/', prog('videos'))
  console.log('\n📦 Listing posters/ …')
  const posterSizes = await listSizesByPrefix('posters/', prog('posters'))
  const videoBytesAll = [...videoSizes.values()].reduce((s, n) => s + n, 0)
  const posterBytesAll = [...posterSizes.values()].reduce((s, n) => s + n, 0)

  let imageBytesAll = 0, imageCount = 0, imagesMeasured = false
  if (WITH_IMAGES) {
    console.log('\n📦 Listing thumbnails/ …'); const t1 = await listSizesByPrefix('thumbnails/', prog('thumbnails'))
    console.log('\n📦 Listing thumbs/ …'); const t2 = await listSizesByPrefix('thumbs/', prog('thumbs'))
    imageCount = t1.size + t2.size
    imageBytesAll = [...t1.values()].reduce((s, n) => s + n, 0) + [...t2.values()].reduce((s, n) => s + n, 0)
    imagesMeasured = true
  }

  console.log(`\n\n📁 Bucket breakdown`)
  console.log(`   Videos:   ${videoSizes.size.toLocaleString()} objects · ${gbAll(videoBytesAll)} GB`)
  console.log(`   Posters:  ${posterSizes.size.toLocaleString()} objects · ${gbAll(posterBytesAll)} GB`)
  if (imagesMeasured) console.log(`   Images:   ${imageCount.toLocaleString()} objects · ${gbAll(imageBytesAll)} GB  (thumbnails/ + thumbs/ — never deleted)`)
  else console.log(`   Images:   not measured (pass --with-images to include them)`)
  console.log('')

  // 3) Scan every ad that has an R2 video, decide keep/strip/delete
  let scanned = 0, keptSpied = 0, keptSaved = 0, delEntire = 0, stripped = 0
  const videoKeys = new Set<string>()
  const posterKeys = new Set<string>()
  const adsToDelete: string[] = []
  const adsToStrip: string[] = []

  // KEYSET pagination by the PK (ad_id) — NOT range/offset. Offset pagination re-scans + skips a growing
  // prefix each page (with the leading-wildcard video_url filter), which times out past ~50k. Keyset stays
  // an index-ordered fetch at any depth. We sweep ALL ads by ad_id and filter to R2 videos in JS, so every
  // query is a plain `ad_id > last ORDER BY ad_id LIMIT n` that can't time out.
  const SWEEP = 1000
  let lastId = ''
  let sweptRows = 0
  for (;;) {
    const { data, error } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_id, video_url, thumbnail_url')
      .gt('ad_id', lastId)
      .order('ad_id', { ascending: true })
      .limit(SWEEP)
    if (error) throw new Error(`scan: ${error.message}`)
    const rows = (data as any[]) || []
    if (!rows.length) break
    lastId = rows[rows.length - 1].ad_id
    sweptRows += rows.length

    // Only the ads that actually carry an R2 video are in scope.
    const vidRows = rows.filter((a) => typeof a.video_url === 'string' && /r2/i.test(a.video_url))

    // Batch-load creatives for just those ads (chunked so the .in() querystring stays small).
    const byAd = new Map<string, { images: number; vids: { r2: string | null; poster: string | null }[] }>()
    for (let i = 0; i < vidRows.length; i += 300) {
      const ids = vidRows.slice(i, i + 300).map((a) => a.ad_id)
      const { data: cre } = await (supabase as any)
        .from('discovery_creatives').select('ad_id, asset_type, r2_url, poster_url').in('ad_id', ids)
      for (const c of (cre as any[]) || []) {
        const e = byAd.get(c.ad_id) || { images: 0, vids: [] }
        if (c.asset_type === 'image') e.images++
        else if (c.asset_type === 'video') e.vids.push({ r2: c.r2_url, poster: c.poster_url })
        byAd.set(c.ad_id, e)
      }
    }

    for (const a of vidRows) {
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

    if (sweptRows % 50000 < SWEEP) console.log(`   …swept ${sweptRows.toLocaleString()} ads · ${scanned.toLocaleString()} with an R2 video`)
    if (rows.length < SWEEP) break
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
  // "Known" bucket size from the prefixes we measured. If images weren't measured we still report the
  // reclaim + $ saved exactly; the % / after-total only show when --with-images gave us the full bucket.
  const measuredBytes = videoBytesAll + posterBytesAll + imageBytesAll
  const measuredGB = measuredBytes / 1073741824
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
  console.log(`   Video storage now:  ${gbAll(videoBytesAll)} GB  (${videoSizes.size.toLocaleString()} objects)`)
  console.log(`   Freed by purge:    -${freedGB.toFixed(2)} GB`)
  console.log(`   Video storage after: ${(videoBytesAll / 1073741824 - freedGB).toFixed(2)} GB`)
  if (imagesMeasured) {
    const afterGB = Math.max(0, measuredGB - freedGB)
    console.log(`   Whole bucket now:   ${measuredGB.toFixed(2)} GB  →  after: ${afterGB.toFixed(2)} GB  (freeing ${measuredGB > 0 ? ((freedGB / measuredGB) * 100).toFixed(0) : '0'}%)`)
  }
  console.log(`\n💰 Cost (R2 storage @ $${R2_USD_PER_GB_MONTH}/GB-month; egress is free)`)
  console.log(`   You save:          ~$${usdSaved.toFixed(2)}/month`)
  if (imagesMeasured) console.log(`   Bucket after:      ~$${(measuredGB - freedGB) > 0 ? ((measuredGB - freedGB) * R2_USD_PER_GB_MONTH).toFixed(2) : '0.00'}/month`)
  console.log('')

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
