/**
 * Deep GraphQL payload analyzer.
 *
 * Pulls the most recent crawler_raw_responses rows from Supabase, walks
 * every JSON node, and reports:
 *   1. Where in the tree ad_archive_id sits (siblings tell us schema)
 *   2. Every leaf string that looks like a media URL (fbcdn / video / image)
 *   3. The full URL pattern breakdown — placeholder sizes vs real sizes
 *   4. Sample ads: count how many have at least one non-placeholder URL
 *
 * Usage:
 *   npx tsx src/analyze-payload.ts                    # latest 5 responses, all brands
 *   npx tsx src/analyze-payload.ts <brand_page_id>    # filter by brand
 *   npx tsx src/analyze-payload.ts --hours=2          # only responses in last N hours
 *
 * Goal: answer the strategic question — "are creative URLs already in the
 * GraphQL payload, structured, no DOM extraction needed?"
 */
import { supabase } from './db.js'

interface RawResponseRow {
  id: string
  brand_page_id: string | null
  url: string | null
  response_type: string | null
  bytes: number | null
  body_text: string
  ad_ids_count: number | null
  captured_at: string
}

const args = process.argv.slice(2)
const brandFilter = args.find(a => /^\d+$/.test(a))
const hoursArg = args.find(a => a.startsWith('--hours='))
const hours = hoursArg ? parseInt(hoursArg.split('=')[1], 10) : 24
const limit = args.find(a => a.startsWith('--limit=')) ? parseInt(args.find(a => a.startsWith('--limit='))!.split('=')[1], 10) : 5
const dumpFirst = args.includes('--dump-first')           // prints full JSON of the first ad with REAL media
const dumpAll = args.includes('--dump-all-paths')         // prints media-URL paths for EVERY ad, not just first

async function main() {
  console.log(`\n🔬 GraphQL Payload Analyzer`)
  console.log(`   Looking at responses from last ${hours}h${brandFilter ? `, brand=${brandFilter}` : ''}, max ${limit} rows\n`)

  let q: any = supabase
    .from('crawler_raw_responses')
    .select('id, brand_page_id, url, response_type, bytes, body_text, ad_ids_count, captured_at')
    .gte('captured_at', new Date(Date.now() - hours * 3600 * 1000).toISOString())
    .order('captured_at', { ascending: false })
    .limit(limit)
  if (brandFilter) q = q.eq('brand_page_id', brandFilter)

  const { data, error } = await q
  if (error) { console.error('❌ Query error:', error.message); process.exit(1) }
  const rows = (data || []) as RawResponseRow[]

  if (rows.length === 0) {
    console.log('No responses found. Run the indexer first:')
    console.log('  npx tsx src/playwright-indexer.ts <page_id>')
    process.exit(0)
  }

  console.log(`Found ${rows.length} responses. Analyzing...\n`)

  // Aggregate stats across all rows
  const stats = {
    totalAds: 0,
    adsWithMedia: 0,
    adsWithRealMedia: 0,    // at least one non-placeholder URL
    adsImageOnly: 0,
    adsVideoOnly: 0,
    adsImageAndVideo: 0,
    adsNoMedia: 0,
    urlSizeHistogram: new Map<string, number>(),  // size pattern (e.g. "s60x60") → count
    urlPathHistogram: new Map<string, number>(),  // path pattern (e.g. "t39.35426-6") → count
    sampleAdSchema: null as any,                  // first ad object — lets us see all keys
    sampleAdMediaPaths: [] as string[],           // JSON paths to media within first ad
    samplesByBrand: new Map<string, { ads: number; withMedia: number }>(),
  }

  for (const row of rows) {
    console.log(`──────────────────────────────────────────`)
    console.log(`📦 Response ${row.id.slice(0, 8)} | ${row.bytes} bytes | ${row.ad_ids_count ?? '?'} ads | brand=${row.brand_page_id ?? '?'}`)
    console.log(`   ${row.url?.slice(0, 100) ?? '(no url)'}`)
    console.log(`   captured: ${row.captured_at}`)

    // Meta embeds ad JSON inside HTML <script> tags; extract each ad object
    // via brace-matching (matches the indexer's proven extractAdsFromText).
    const adObjects = extractAdsBraceMatched(row.body_text)
    console.log(`   📦 brace-matched ${adObjects.length} ad objects`)

    if (adObjects.length === 0) {
      // Fallback: try whole-body JSON parse for non-HTML payloads
      try {
        const parsed = JSON.parse(row.body_text.replace(/^for\s*\(;;\);/, '').trim())
        analyzeTree(parsed, stats, row.brand_page_id)
      } catch {
        analyzeAsText(row.body_text, stats, row.brand_page_id)
      }
      continue
    }

    for (const ad of adObjects) {
      analyzeAd(ad, stats, row.brand_page_id)
    }
  }

  // ───────────────── REPORT ─────────────────
  console.log(`\n\n══════════════════════════════════════════`)
  console.log(`📊 AGGREGATE REPORT`)
  console.log(`══════════════════════════════════════════\n`)
  console.log(`Total ads found across ${rows.length} responses: ${stats.totalAds}`)
  console.log(`  with ANY media URL:          ${stats.adsWithMedia}`)
  console.log(`  with REAL (non-placeholder): ${stats.adsWithRealMedia}`)
  console.log(`  image-only:                  ${stats.adsImageOnly}`)
  console.log(`  video-only:                  ${stats.adsVideoOnly}`)
  console.log(`  both image+video:            ${stats.adsImageAndVideo}`)
  console.log(`  NO media at all:             ${stats.adsNoMedia}`)

  console.log(`\n🔍 URL size pattern histogram (top 15) — placeholders are tiny (s60x60, s148x148):`)
  const sizes = Array.from(stats.urlSizeHistogram.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [s, c] of sizes) console.log(`   ${s.padEnd(20)} ${c}`)

  console.log(`\n🔍 URL path pattern histogram (top 10) — t39.*-6 = creative, t39.*-1 = profile:`)
  const paths = Array.from(stats.urlPathHistogram.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
  for (const [p, c] of paths) console.log(`   ${p.padEnd(30)} ${c}`)

  if (stats.sampleAdMediaPaths.length > 0) {
    console.log(`\n🗺️  Sample ad ${stats.sampleAdId ?? ''} (${stats.sampleHasReal ? 'has REAL creative' : 'placeholder/profile only'}) — JSON paths where media URLs live (first 25):`)
    stats.sampleAdMediaPaths.slice(0, 25).forEach((p: string) => console.log(`   ${p}`))
  }

  if (stats.sampleAdSchema) {
    console.log(`\n📋 Sample ad — top-level keys on the ad/snapshot object:`)
    const keys = Object.keys(stats.sampleAdSchema)
    console.log(`   ${keys.join(', ')}`)
    if (stats.sampleAdSchema.snapshot) {
      console.log(`\n📋 Sample ad — keys INSIDE snapshot:`)
      console.log(`   ${Object.keys(stats.sampleAdSchema.snapshot).join(', ')}`)
    }
  }

  if (dumpFirst && stats.sampleAdSchema) {
    console.log(`\n📜 FULL JSON of sample ad ${stats.sampleAdId} (truncated to 5000 chars):`)
    const json = JSON.stringify(stats.sampleAdSchema, null, 2)
    console.log(json.length > 5000 ? json.slice(0, 5000) + '\n...[truncated]' : json)
  }

  console.log(`\n══════════════════════════════════════════`)
  console.log(`💡 VERDICT`)
  console.log(`══════════════════════════════════════════`)
  if (stats.totalAds === 0) {
    console.log(`   ❌ No ads found in payloads. Check response_type filter.`)
  } else {
    const realPct = ((stats.adsWithRealMedia / stats.totalAds) * 100).toFixed(1)
    const anyPct = ((stats.adsWithMedia / stats.totalAds) * 100).toFixed(1)
    console.log(`   ${anyPct}% of ads have at least ONE media URL in GraphQL`)
    console.log(`   ${realPct}% of ads have REAL (non-placeholder) media URLs`)
    if (parseFloat(realPct) >= 60) {
      console.log(`\n   ✅ GraphQL extraction is VIABLE.`)
      console.log(`      Worker can extract from GraphQL payloads, skip per-ad page loads entirely.`)
    } else if (parseFloat(realPct) >= 20) {
      console.log(`\n   ⚠️  GraphQL extraction is PARTIAL.`)
      console.log(`      Use it for the ${realPct}% that have URLs, fall back to DOM for the rest.`)
    } else {
      console.log(`\n   ❌ GraphQL payloads do NOT contain enough creative URLs.`)
      console.log(`      Per-ad page loads remain necessary. Pursue Option B (carousel interaction).`)
    }
  }

  process.exit(0)
}

function isPlaceholder(url: string): boolean {
  // Placeholders: small thumbnails Meta serves to non-logged-in users
  const sm = url.match(/_s(\d+)x(\d+)/)
  if (sm) {
    const w = parseInt(sm[1], 10)
    if (w < 200) return true
  }
  // Profile/page picture paths
  if (url.match(/\/v\/t39\.\d+-1\//)) return true
  if (url.match(/profile_pic|cover_photo/i)) return true
  if (url.includes('static.xx.fbcdn')) return true
  return false
}

function isMediaUrl(s: string): boolean {
  if (typeof s !== 'string' || s.length < 30) return false
  if (!s.startsWith('http')) return false
  if (!(s.includes('fbcdn.net') || s.includes('scontent') || s.includes('video.xx'))) return false
  return /\.(mp4|webm|jpg|jpeg|png|webp)/i.test(s) || s.includes('/v/t')
}

function urlPathPattern(url: string): string {
  const m = url.match(/\/v\/(t\d+\.\d+-\d+)\//)
  return m ? m[1] : 'other'
}

function urlSizePattern(url: string): string {
  const m = url.match(/_s(\d+x\d+)/)
  return m ? `s${m[1]}` : 'no-size-tag'
}

/**
 * Brace-match every ad_archive_id occurrence to its enclosing JSON object.
 * Mirrors playwright-indexer.ts extractAdsFromText.
 */
function extractAdsBraceMatched(text: string): any[] {
  const found: any[] = []
  const adIdRegex = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = adIdRegex.exec(text)) !== null) {
    positions.push(m.index)
  }
  for (const pos of positions) {
    let start = pos
    while (start > 0 && text[start] !== '{') start--
    let depth = 0, end = start
    for (let i = start; i < text.length && i < start + 250_000; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === start) continue
    try {
      const obj = JSON.parse(text.slice(start, end))
      if (obj.ad_archive_id) found.push(obj)
    } catch { /* malformed slice — skip */ }
  }
  return found
}

function analyzeTree(root: any, stats: any, brandId: string | null) {
  const ads: any[] = []
  function findAds(node: any) {
    if (!node) return
    if (Array.isArray(node)) { node.forEach(findAds); return }
    if (typeof node === 'object') {
      if ('ad_archive_id' in node) ads.push(node)
      Object.values(node).forEach(findAds)
    }
  }
  findAds(root)
  for (const ad of ads) analyzeAd(ad, stats, brandId)
}

function analyzeAd(ad: any, stats: any, brandId: string | null) {
  stats.totalAds += 1
  const brandKey = brandId || 'unknown'
  const cur = stats.samplesByBrand.get(brandKey) || { ads: 0, withMedia: 0 }
  cur.ads += 1

  const mediaUrls: string[] = []
  const mediaPaths: string[] = []

  function walk(node: any, path: string) {
    if (typeof node === 'string') {
      if (isMediaUrl(node)) {
        mediaUrls.push(node)
        mediaPaths.push(`${path}  →  ${node.slice(0, 80)}`)
      }
      return
    }
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return }
    if (typeof node === 'object' && node) Object.entries(node).forEach(([k, v]) => walk(v, `${path}.${k}`))
  }
  walk(ad, '$')

  let hasImage = false, hasVideo = false, hasReal = false
  for (const u of mediaUrls) {
    if (/\.(mp4|webm)/i.test(u)) hasVideo = true
    else if (/\.(jpg|jpeg|png|webp)/i.test(u) || u.includes('/v/t')) hasImage = true
    if (!isPlaceholder(u)) hasReal = true
    stats.urlSizeHistogram.set(urlSizePattern(u), (stats.urlSizeHistogram.get(urlSizePattern(u)) || 0) + 1)
    stats.urlPathHistogram.set(urlPathPattern(u), (stats.urlPathHistogram.get(urlPathPattern(u)) || 0) + 1)
  }

  if (mediaUrls.length > 0) { stats.adsWithMedia += 1; cur.withMedia += 1 }
  else stats.adsNoMedia += 1
  if (hasReal) stats.adsWithRealMedia += 1
  if (hasImage && hasVideo) stats.adsImageAndVideo += 1
  else if (hasImage) stats.adsImageOnly += 1
  else if (hasVideo) stats.adsVideoOnly += 1

  stats.samplesByBrand.set(brandKey, cur)

  // Capture sample ad: prefer one with REAL non-placeholder URLs over a profile-pic-only ad
  if ((!stats.sampleAdSchema || (!stats.sampleHasReal && hasReal)) && mediaUrls.length > 0) {
    stats.sampleAdSchema = ad
    stats.sampleAdMediaPaths = mediaPaths
    stats.sampleHasReal = hasReal
    stats.sampleAdId = ad.ad_archive_id
  }

  // --dump-all-paths: print every ad's media paths
  if (dumpAll) {
    const realCount = mediaUrls.filter(u => !isPlaceholder(u)).length
    console.log(`\n   📍 Ad ${ad.ad_archive_id} — ${mediaUrls.length} URLs (${realCount} real):`)
    mediaPaths.slice(0, 6).forEach(p => console.log(`      ${p}`))
  }
}

function analyzeAsText(text: string, stats: any, _brandId: string | null) {
  // Fallback: regex over raw text
  const adIds = text.match(/"ad_archive_id"\s*:\s*"?(\d+)"?/g) || []
  const fbcdnUrls = text.match(/https?:\/\/[^"\s]*fbcdn\.net[^"\s]*\.(?:jpg|jpeg|png|webp|mp4|webm)/gi) || []
  console.log(`   📌 Regex fallback: found ${adIds.length} ad_archive_id refs, ${fbcdnUrls.length} fbcdn URLs`)
  stats.totalAds += adIds.length
  for (const u of fbcdnUrls) {
    stats.urlSizeHistogram.set(urlSizePattern(u), (stats.urlSizeHistogram.get(urlSizePattern(u)) || 0) + 1)
    stats.urlPathHistogram.set(urlPathPattern(u), (stats.urlPathHistogram.get(urlPathPattern(u)) || 0) + 1)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
