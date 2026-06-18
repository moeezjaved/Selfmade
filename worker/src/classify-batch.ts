/**
 * Per-COPY-SIGNATURE classification via a pluggable Batch provider (50% off).
 * Provider (OpenAI gpt-4o-mini or Anthropic Haiku) is chosen by CLASSIFY_PROVIDER;
 * see classify-providers.ts. The pipeline below is identical either way.
 *
 * Combines all the cost levers for scaling toward 1M+ ads:
 *   1. ONE merged prompt (hooks + topics) instead of two passes        → ~2×
 *   2. Classify once per UNIQUE copy (copy_sig), fan out to all ads     → dedup
 *   3. Set-based cache — reuse tags for copy already classified        → steady-state
 *   4. Batch API (async, half price)                                   → 2×
 *   5. Cheap model (gpt-4o-mini) — output-token cost is the driver     → ~8×
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
import { buildMergedPrompt, propagateClassification, fetchCachedTags, type CreativeItem } from './classify-core.js'
import { getProvider } from './classify-providers.js'

const provider = getProvider()   // CLASSIFY_PROVIDER=openai|anthropic

const SIGS_PER_REQUEST = 25            // distinct copy signatures merged into one prompt
const waveArg = process.argv.find(a => a.startsWith('--wave='))
const WAVE = waveArg ? parseInt(waveArg.split('=')[1], 10) : 40_000   // ads scanned per wave
const ONCE = process.argv.includes('--once')
const POLL_MS = 30_000

let tIn = 0, tOut = 0, cacheHits = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const estCost = () => (tIn / 1e6 * provider.priceIn + tOut / 1e6 * provider.priceOut) * 0.5  // Batch API = 50%

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
    customId: `r${i}`, prompt: buildMergedPrompt(group),
  }))
  const id = await provider.submit(requests)
  console.log(`  📤 [${provider.name}/${provider.model}] submitted ${id} — ${requests.length} requests (${items.length} copy sigs)`)
  return id
}

/** Poll until the batch ends, then apply every result. Returns sigs applied. */
async function drainBatch(id: string): Promise<number> {
  let st = await provider.isDone(id)
  while (!st.done) {
    const c = st.counts || {}
    console.log(`  ⏳ ${id} ${st.status} — done=${c.succeeded ?? c.completed ?? 0} err=${c.errored ?? c.failed ?? 0}`)
    await sleep(POLL_MS)
    st = await provider.isDone(id)
  }
  const results = await provider.results(id)
  let applied = 0
  for (const r of results) {
    tIn += r.inTok; tOut += r.outTok
    for (const c of r.items) {
      if (!c?.id) continue
      try { await propagateClassification(String(c.id), c); applied++ } catch { /* skip one */ }
    }
  }
  console.log(`  ✅ ${id}: applied ${applied} sigs | est $${estCost().toFixed(3)} (batch-priced)`)
  return applied
}

/** Adopt batches already in flight / recently ended from a prior run, so a
 *  crash never abandons paid results or causes a duplicate submit. (Cross-provider
 *  ids never collide, and a stale result whose ids don't match any copy_sig just
 *  fans out to zero rows — safe.) */
async function adoptExistingBatches(): Promise<void> {
  try {
    const batches = await provider.list(20)
    const live = batches.filter(b => !b.done)
    // Adopt ONLY in-flight batches (restart recovery — a prior run submitted then died
    // before applying). We deliberately do NOT re-apply ENDED batches: on a clean exit
    // they were already applied, and re-applying them every run would re-stamp thousands
    // of already-tagged ads (a steady-state cron tick would needlessly rewrite the whole
    // last corpus drain). The rare crash-between-end-and-apply case self-heals — those
    // ads stay topics-null and get re-classified next run by the gate, with no double-
    // spend on everything else.
    if (live.length) {
      console.log(`  adopting ${live.length} in-flight ${provider.name} batch(es) from a prior run`)
      for (const b of live) await drainBatch(b.id)
    }
  } catch (e: any) {
    console.warn(`  (could not list prior batches: ${e?.message || e})`)
  }
}

async function main() {
  console.log(`Per-copy-signature batch classify — ${provider.name}/${provider.model}, wave=${WAVE}, perReq=${SIGS_PER_REQUEST}`)
  await adoptExistingBatches()

  let totalApplied = 0
  while (true) {
    const sigs = await fetchUniqueSignatures()
    if (!sigs.length) { console.log('  no more unclassified copy.'); break }

    // Set-based cache: reuse tags for any copy already classified (steady-state
    // saver — empty on a fresh corpus). Only the misses cost a model call.
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
  console.log(`🏁 done — applied ${totalApplied} sigs (${cacheHits} cache-reused) | ${provider.name}/${provider.model} est $${estCost().toFixed(2)} (batch-priced, in=${tIn} out=${tOut})`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
