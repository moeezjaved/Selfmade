/**
 * Backfill discovery_creatives.width/height for existing IMAGE creatives.
 *
 * Atria-style no-reflow grid needs pixel dims. New crawls capture them in
 * processAsset; this fills the historical rows. Reads each R2 image header via
 * sharp (only the header, not a full decode), keyset-paginates by id so it's
 * resumable, and updates in small batches. Videos are skipped (client fallback).
 *
 * Run on the droplet:  node src/backfill-dimensions.mjs
 * Safe to stop/restart — `width is null` + id keyset means it never redoes a row.
 * Throttled (CONCURRENCY parallel header reads) so it doesn't saturate R2 or the DB.
 */
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const db = createClient(URL, KEY, { auth: { persistSession: false } })

const BATCH = parseInt(process.env.BF_BATCH || '500')          // rows fetched per page
const CONCURRENCY = parseInt(process.env.BF_CONCURRENCY || '12') // parallel image-header reads
const THROTTLE_MS = parseInt(process.env.BF_THROTTLE_MS || '150')
const FETCH_TIMEOUT = 15_000

async function dimsOf(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const { width, height } = await sharp(buf, { failOn: 'none' }).metadata()
    return (width && height) ? { width, height } : null
  } catch { return null }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

let done = 0, filled = 0, missed = 0
const startedAt = Date.now()

// Outer convergence loop: a pass with transient misses (large image timeouts / R2
// bursts) leaves those rows width=null; a fresh pass re-attempts them. Repeat until
// a full pass fills nothing new — i.e. only genuinely-unfetchable URLs remain.
let pass = 0
while (true) {
  pass++
  let cursor = ''
  let passFilled = 0

while (true) {
  // Clean id-keyset range scan (PK index — always fast). The `width is null` filter
  // has no supporting index → the planner seq-scans+sorts 1.5M rows → 8s timeout. So
  // page by id and skip already-filled rows in JS instead.
  let q = db.from('discovery_creatives')
    .select('id, ad_id, position, asset_type, r2_url, width')
    .eq('asset_type', 'image')
    .order('id', { ascending: true })
    .limit(BATCH)
  if (cursor) q = q.gt('id', cursor)
  const { data: rows, error } = await q
  if (error) { console.error('select failed:', error.message); await new Promise(r => setTimeout(r, 5000)); continue }
  if (!rows || rows.length === 0) break
  cursor = rows[rows.length - 1].id   // advance keyset regardless of fill result

  const todo = rows.filter((r) => r.width == null)   // only fetch dims for un-filled
  const dims = await mapLimit(todo, CONCURRENCY, (r) => dimsOf(r.r2_url))
  const updates = []
  todo.forEach((r, i) => {
    const d = dims[i]
    if (d) updates.push({ id: r.id, ad_id: r.ad_id, position: r.position, asset_type: r.asset_type, r2_url: r.r2_url, width: d.width, height: d.height })
    else missed++
  })

  if (updates.length) {
    const { error: upErr } = await db.from('discovery_creatives').upsert(updates, { onConflict: 'id' })
    if (upErr) { console.error('upsert failed:', upErr.message); await new Promise(r => setTimeout(r, 5000)); continue }
    filled += updates.length
    passFilled += updates.length
  }

  done += rows.length
  const rate = (done / ((Date.now() - startedAt) / 1000)).toFixed(0)
  console.log(`pass=${pass} done=${done} filled=${filled} missed=${missed} | ${rate}/s | cursor=${cursor.slice(0, 8)}`)
  if (THROTTLE_MS) await new Promise(r => setTimeout(r, THROTTLE_MS))   // gentle throttle
}

  console.log(`— pass ${pass} done: filled ${passFilled} this pass —`)
  if (passFilled === 0) break   // converged: only genuinely-unfetchable URLs remain
}

console.log(`\n✅ backfill complete (${pass} passes): filled=${filled} done=${done} in ${((Date.now() - startedAt) / 60000).toFixed(1)}min`)
