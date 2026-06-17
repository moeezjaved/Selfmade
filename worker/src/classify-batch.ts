/**
 * Per-COPY-SIGNATURE classification via the Anthropic Message Batches API (50% off).
 *
 * Combines all the cost levers for scaling toward 1M+ ads:
 *   1. ONE merged prompt (hooks + topics) instead of two passes        → ~2×
 *   2. Classify once per UNIQUE copy (copy_sig), fan out to all ads     → dedup
 *   3. Set-based cache — reuse tags for copy already classified        → steady-state
 *   4. Batch API (async, half price)                                   → 2×
 *
 * Keyed on copy_sig (Postgres-generated sha256 of normalized page_id+title+body),
 * NOT image_hash: classification derives only from copy, so identical copy ⟹
 * identical tags — provably correct fan-out, unlike image_hash which smears one
 * caption's tags across visual variants. The gate is self-healing (re-picks any ad
 * missing either output), so partial failures never leave permanent holes.
 *
 *   npx tsx src/classify-batch.ts [--wave=40000] [--once]
 *   (requires migration 017 — copy_sig + is_classifiable generated columns)
 *
 * Restart-safe: on start it adopts any batch already in flight (or recently
 * ended) before submitting new work, so a crash never abandons paid-for results
 * or double-submits. Propagation is idempotent.
 */
import { supabase } from './db.js'
import { buildMergedPrompt, parseClassification, propagateClassification, fetchCachedTags, type CreativeItem } from './classify-core.js'

const KEY = process.env.ANTHROPIC_API_KEY!
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const API = 'https://api.anthropic.com/v1/messages/batches'
const HEADERS = { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }

const SIGS_PER_REQUEST = 25            // distinct copy signatures merged into one prompt
const waveArg = process.argv.find(a => a.startsWith('--wave='))
const WAVE = waveArg ? parseInt(waveArg.split('=')[1], 10) : 40_000   // ads scanned per wave
const ONCE = process.argv.includes('--once')
const POLL_MS = 30_000

let tIn = 0, tOut = 0, cacheHits = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Scan up to WAVE work-eligible ads and reduce to UNIQUE COPY SIGNATURES, keeping
 * the representative with the richest body. The gate is self-healing: any ad that
 * is missing EITHER output (not classified, or classified but topics still null)
 * gets re-picked, so a partial failure never leaves permanent holes. `is_classifiable`
 * (Postgres-generated) drops blank/template-only bodies.
 */
async function fetchUniqueSignatures(): Promise<CreativeItem[]> {
  const bySig = new Map<string, CreativeItem & { _len: number }>()
  let scanned = 0
  for (let off = 0; off < WAVE; off += 1000) {
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title, copy_sig')
      .eq('is_classifiable', true)
      .or('ai_classified.is.null,ai_classified.eq.false,topics.is.null')
      .not('copy_sig', 'is', null)
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (!rows.length) break
    scanned += rows.length
    for (const a of rows) {
      const key = a.copy_sig as string
      const len = (a.body || '').length
      const prev = bySig.get(key)
      if (!prev || len > prev._len) {
        bySig.set(key, { key, page_name: a.page_name, title: a.title, body: a.body, _len: len })
      }
    }
    if (rows.length < 1000) break
  }
  const items = Array.from(bySig.values())
  if (items.length) console.log(`  scanned ${scanned} ads → ${items.length} unique copy sigs (${(100 * (1 - items.length / Math.max(1, scanned))).toFixed(0)}% dedup)`)
  return items
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function submitBatch(items: CreativeItem[]): Promise<string> {
  const requests = chunk(items, SIGS_PER_REQUEST).map((group, i) => ({
    custom_id: `r${i}`,
    params: { model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content: buildMergedPrompt(group) }] },
  }))
  const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ requests }) })
  const data = await res.json()
  if (!data.id) throw new Error(`batch submit failed: ${JSON.stringify(data).slice(0, 300)}`)
  console.log(`  📤 submitted batch ${data.id} — ${requests.length} requests (${items.length} copy sigs)`)
  return data.id
}

async function getBatch(id: string): Promise<any> {
  const res = await fetch(`${API}/${id}`, { headers: HEADERS })
  return res.json()
}

/** Poll until the batch ends, then apply every result. Returns creatives applied. */
async function drainBatch(id: string): Promise<number> {
  // Poll to completion.
  let b = await getBatch(id)
  while (b.processing_status && b.processing_status !== 'ended') {
    const c = b.request_counts || {}
    console.log(`  ⏳ ${id} ${b.processing_status} — done=${c.succeeded || 0} err=${c.errored || 0} proc=${c.processing || 0}`)
    await sleep(POLL_MS)
    b = await getBatch(id)
  }
  if (!b.results_url) { console.warn(`  ⚠️ ${id} ended with no results_url`); return 0 }

  const res = await fetch(b.results_url, { headers: HEADERS })
  const jsonl = await res.text()
  let applied = 0, reqErr = 0
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: any
    try { row = JSON.parse(line) } catch { continue }
    const r = row.result
    if (r?.type !== 'succeeded' || !r.message) { reqErr++; continue }
    const usage = r.message.usage || {}
    tIn += usage.input_tokens || 0; tOut += usage.output_tokens || 0
    const arr = parseClassification(r.message.content?.[0]?.text || '')
    for (const c of arr) {
      if (!c?.id) continue
      try { await propagateClassification(String(c.id), c); applied++ } catch { /* skip one */ }
    }
  }
  const cost = (tIn / 1e6 * 1 + tOut / 1e6 * 5) * 0.5  // Batch API = 50% of standard
  console.log(`  ✅ ${id}: applied ${applied} creatives${reqErr ? `, ${reqErr} req errors` : ''} | est $${cost.toFixed(3)} (batch-priced)`)
  return applied
}

/** Adopt batches already in flight / recently ended from a prior run, so a
 *  crash never abandons paid results or causes a duplicate submit. */
async function adoptExistingBatches(): Promise<void> {
  try {
    const res = await fetch(`${API}?limit=20`, { headers: HEADERS })
    const data = await res.json()
    const batches = (data.data || []) as any[]
    const live = batches.filter(b => b.processing_status && b.processing_status !== 'ended')
    const ended = batches.filter(b => b.processing_status === 'ended' && b.results_url)
    if (live.length || ended.length) console.log(`  adopting prior batches: ${live.length} in-flight, ${ended.length} ended`)
    for (const b of ended) await drainBatch(b.id)         // idempotent re-apply
    for (const b of live) await drainBatch(b.id)           // wait + apply
  } catch (e: any) {
    console.warn(`  (could not list prior batches: ${e?.message || e})`)
  }
}

async function main() {
  console.log(`Per-copy-signature batch classify — model=${MODEL}, wave=${WAVE}, perReq=${SIGS_PER_REQUEST}`)
  await adoptExistingBatches()

  let totalApplied = 0
  while (true) {
    const sigs = await fetchUniqueSignatures()
    if (!sigs.length) { console.log('  no more unclassified copy.'); break }

    // Set-based cache: reuse tags for any copy already classified (steady-state
    // saver — empty on a fresh corpus). Only the misses cost a Claude call.
    const cached = await fetchCachedTags(sigs.map(s => s.key))
    const misses: CreativeItem[] = []
    for (const s of sigs) {
      const hit = cached.get(s.key)
      if (hit) { await propagateClassification(s.key, hit); cacheHits++; totalApplied++ }
      else misses.push(s)
    }
    if (cached.size) console.log(`  cache: reused ${cached.size} sigs, ${misses.length} to classify`)

    if (misses.length) {
      const id = await submitBatch(misses)
      totalApplied += await drainBatch(id)
    }
    if (ONCE) break
  }
  const cost = (tIn / 1e6 * 1 + tOut / 1e6 * 5) * 0.5
  console.log(`🏁 done — applied ${totalApplied} sigs (${cacheHits} cache-reused) | est $${cost.toFixed(2)} (batch-priced, in=${tIn} out=${tOut})`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
