/**
 * One-off backfill: populate industries / themes (from ad text) and platforms
 * (from archived raw payloads) on existing ads, so the Discovery filters work
 * over the whole dataset. No re-crawl / no GB. Run:
 *   npx tsx src/backfill-classify.ts
 */
import { supabase } from './db.js'
import { detectIndustries, detectThemes, normalizePlatforms } from './classify.js'

async function upsertBatch(rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabase as any)
      .from('discovery_ads_index')
      .upsert(rows.slice(i, i + 500), { onConflict: 'ad_id' })
    if (error) console.warn('upsert error:', error.message)
  }
}

// ── Themes: per-ad (a single ad legitimately has its own themes) ──
async function backfillThemes() {
  let off = 0, done = 0
  while (true) {
    // ORDER BY for stable pagination — without it .range() can skip/dupe rows.
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, body, caption')
      .order('ad_id', { ascending: true })
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (rows.length === 0) break
    await upsertBatch(rows.map(a => ({
      ad_id: a.ad_id,
      themes: detectThemes(`${a.body || ''} ${a.caption || ''}`),
    })))
    done += rows.length; off += 1000
    console.log(`  themes: ${done}`)
    if (rows.length < 1000) break
  }
}

// ── Industry: BRAND-level (a brand is one industry; per-ad keyword matching
// is too noisy — different ads pick up incidental words). Compute each page's
// dominant 1-2 industries from a sample of its ads, apply to ALL its ads. ──
async function backfillIndustriesByBrand() {
  // distinct page_ids across the index
  const pageIds = new Set<string>()
  let off = 0
  while (true) {
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('page_id')
      .not('page_id', 'is', null)
      .order('page_id', { ascending: true })
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (rows.length === 0) break
    rows.forEach(r => pageIds.add(r.page_id))
    off += 1000
    if (rows.length < 1000) break
  }
  console.log(`  brands to classify: ${pageIds.size}`)
  let n = 0
  for (const pid of pageIds) {
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('body, caption, page_name')
      .eq('page_id', pid)
      .limit(300)
    const tally: Record<string, number> = {}
    for (const a of (data || []) as any[]) {
      for (const ind of detectIndustries(`${a.body || ''} ${a.caption || ''} ${a.page_name || ''}`)) {
        tally[ind] = (tally[ind] || 0) + 1
      }
    }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name)
    await (supabase as any).from('discovery_ads_index').update({ industries: top }).eq('page_id', pid)
    if (++n % 20 === 0) console.log(`  brands classified: ${n}/${pageIds.size}`)
  }
  console.log(`  brands classified: ${n}`)
}

// ── Platforms from archived raw responses ─────────────────────────
function extractPlatforms(body: string, map: Map<string, string[]>) {
  const key = '"ad_archive_id"'
  let i = 0
  while (true) {
    const p = body.indexOf(key, i)
    if (p < 0) break
    i = p + 1
    let s = p
    while (s > 0 && body[s] !== '{') s--
    let depth = 0, e = s
    for (let j = s; j < Math.min(body.length, s + 200000); j++) {
      const c = body[j]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { e = j + 1; break } }
    }
    let obj: any
    try { obj = JSON.parse(body.slice(s, e)) } catch { continue }
    const aid = obj.ad_archive_id
    const pp = obj.snapshot?.publisher_platform ?? obj.publisher_platform
    if (aid && Array.isArray(pp) && pp.length > 0 && !map.has(aid)) {
      map.set(aid, normalizePlatforms(pp))
    }
  }
}

async function backfillPlatforms() {
  const map = new Map<string, string[]>()
  let off = 0
  while (true) {
    const { data } = await (supabase as any)
      .from('crawler_raw_responses')
      .select('body_text')
      .gt('ad_ids_count', 0)
      .order('captured_at', { ascending: false })
      .range(off, off + 24)
    const rows = (data || []) as any[]
    if (rows.length === 0) break
    for (const r of rows) extractPlatforms(r.body_text, map)
    off += 25
    if (rows.length < 25) break
  }
  const out = Array.from(map.entries()).map(([ad_id, platforms]) => ({ ad_id, platforms }))
  console.log(`  platforms found for ${out.length} ads`)
  await upsertBatch(out)
}

async function main() {
  console.log('Backfilling themes (per-ad)…')
  await backfillThemes()
  console.log('Backfilling industries (brand-level)…')
  await backfillIndustriesByBrand()
  console.log('Backfilling platforms…')
  await backfillPlatforms()
  console.log('✅ done')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
