/**
 * Per-creative classification via the Anthropic Message Batches API (50% off).
 *
 * Combines all three cost levers for scaling toward 1M+ ads:
 *   1. ONE merged prompt (hooks + topics) instead of two passes  → ~2×
 *   2. Classify once per UNIQUE creative, fan out to all ads      → ~3-5×
 *   3. Batch API (async, half price)                             → 2×
 *   (+ ingest-only: we only ever touch ads with topics IS NULL — never re-sweep.)
 *
 *   npx tsx src/classify-batch.ts [--wave=40000] [--once]
 *
 * Restart-safe: on start it adopts any batch already in flight (or recently
 * ended) before submitting new work, so a crash never abandons paid-for results
 * or double-submits. Propagation is idempotent.
 */
import { supabase } from './db.js'
import { buildMergedPrompt, parseClassification, propagateClassification, type CreativeItem } from './classify-core.js'

const KEY = process.env.ANTHROPIC_API_KEY!
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const API = 'https://api.anthropic.com/v1/messages/batches'
const HEADERS = { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }

const CREATIVES_PER_REQUEST = 25      // creatives merged into one prompt
const waveArg = process.argv.find(a => a.startsWith('--wave='))
const WAVE = waveArg ? parseInt(waveArg.split('=')[1], 10) : 40_000   // ads scanned per wave
const ONCE = process.argv.includes('--once')
const POLL_MS = 30_000

let tIn = 0, tOut = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const creativeKey = (a: any): string =>
  a.image_hash ? `i:${a.image_hash}` : a.video_hash ? `v:${a.video_hash}` : `a:${a.ad_id}`

/** Scan up to WAVE unclassified ads (topics IS NULL) and reduce to UNIQUE
 *  creatives, keeping the representative with the richest body. */
async function fetchUniqueCreatives(): Promise<CreativeItem[]> {
  const byKey = new Map<string, CreativeItem & { _len: number }>()
  let scanned = 0
  for (let off = 0; off < WAVE; off += 1000) {
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title, image_hash, video_hash')
      .is('topics', null)
      .not('body', 'is', null)
      .neq('body', '')
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (!rows.length) break
    scanned += rows.length
    for (const a of rows) {
      const key = creativeKey(a)
      const len = (a.body || '').length
      const prev = byKey.get(key)
      if (!prev || len > prev._len) {
        byKey.set(key, { key, page_name: a.page_name, title: a.title, body: a.body, _len: len })
      }
    }
    if (rows.length < 1000) break
  }
  const items = Array.from(byKey.values())
  if (items.length) console.log(`  scanned ${scanned} ads → ${items.length} unique creatives (${(100 * (1 - items.length / Math.max(1, scanned))).toFixed(0)}% dedup)`)
  return items
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function submitBatch(items: CreativeItem[]): Promise<string> {
  const requests = chunk(items, CREATIVES_PER_REQUEST).map((group, i) => ({
    custom_id: `r${i}`,
    params: { model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content: buildMergedPrompt(group) }] },
  }))
  const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ requests }) })
  const data = await res.json()
  if (!data.id) throw new Error(`batch submit failed: ${JSON.stringify(data).slice(0, 300)}`)
  console.log(`  📤 submitted batch ${data.id} — ${requests.length} requests (${items.length} creatives)`)
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
  console.log(`Per-creative batch classify — model=${MODEL}, wave=${WAVE}, perReq=${CREATIVES_PER_REQUEST}`)
  await adoptExistingBatches()

  let totalApplied = 0
  while (true) {
    const creatives = await fetchUniqueCreatives()
    if (!creatives.length) { console.log('  no more unclassified creatives.'); break }
    const id = await submitBatch(creatives)
    totalApplied += await drainBatch(id)
    if (ONCE) break
  }
  const cost = (tIn / 1e6 * 1 + tOut / 1e6 * 5) * 0.5
  console.log(`🏁 done — applied ${totalApplied} creatives | est $${cost.toFixed(2)} (batch-priced, in=${tIn} out=${tOut})`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
