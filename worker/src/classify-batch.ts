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
 *   npx tsx src/classify-batch.ts [--wave=40000] [--once] [--sync]
 *   --sync (or CLASSIFY_SYNC=1, CLASSIFY_CONCURRENCY=N): real-time parallel completions instead of
 *   the 24h Batch API — a wave finishes in minutes (full price, self-throttles on 429). Use to drain
 *   a backlog fast; drop --sync for cheap steady-state cron ticks.
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
// 12k ads/wave ≈ ~7k unique sigs ≈ ~1.1M input tokens — safely under OpenAI's 2M enqueued-token
// Batch limit (40k waves were ~3.6M → every batch failed with token_limit_exceeded). Raise via
// --wave=N if your org's batch limit is higher.
const WAVE = waveArg ? parseInt(waveArg.split('=')[1], 10) : 12_000   // ads scanned per wave
const ONCE = process.argv.includes('--once')
const PAGE_ID = (process.env.CLASSIFY_PAGE_ID || '').trim()   // set → classify ONLY this brand (deep spy)
const POLL_MS = 30_000

// ── SYNC mode ────────────────────────────────────────────────────────────────
// --sync (or CLASSIFY_SYNC=1): skip the 24h Batch API and fire real-time /chat/completions calls
// through a concurrency pool. A wave finishes in MINUTES instead of up to a day — the right mode for
// draining a backlog. Trade-off: no 50% Batch discount (full price), and it consumes your RPM/TPM
// limits, so it self-throttles on 429 (fetchRetry). Bigger --wave here just means fewer DB round-trips;
// it's NOT bound by the 2M enqueued-token Batch limit (that only applies to the async path).
const SYNC = process.argv.includes('--sync') || process.env.CLASSIFY_SYNC === '1'
const CONCURRENCY = Math.max(1, parseInt(process.env.CLASSIFY_CONCURRENCY || '40', 10))

// ── BATCH concurrency (cheap + fast) ─────────────────────────────────────────
// Batches finish in ~10–40 min (not 24h), so we keep several in flight at once. This multiplies
// throughput at the SAME 50%-off batch price — concurrency is free wall-clock, not extra spend (total
// cost is fixed by unique-copy count). Each sub-batch stays ≤ SIGS_PER_BATCH (~1.1M enqueued tokens,
// under OpenAI's 2M per-batch cap); N in flight ⇒ ~N× enqueued tokens, so the real ceiling is your
// org's enqueued-token tier. A submit that trips the limit is skipped + retried next super-wave (never
// charged). Set CLASSIFY_BATCH_CONCURRENCY=5 for ~16h on a ~2M-ad backlog.
const BATCH_CONCURRENCY = Math.max(1, parseInt(process.env.CLASSIFY_BATCH_CONCURRENCY || '1', 10))
const SIGS_PER_BATCH = 7_000   // ~1.1M input tokens/batch — safely under the 2M per-batch enqueued cap

let tIn = 0, tOut = 0, cacheHits = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// Batch API = 50% off; sync = full price.
const estCost = () => (tIn / 1e6 * provider.priceIn + tOut / 1e6 * provider.priceOut) * (SYNC ? 1 : 0.5)

/** Run `fn` over `items` with at most `n` in flight at once. */
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/**
 * Scan up to WAVE work-eligible ads and reduce to UNIQUE COPY SIGNATURES, keeping
 * the representative with the richest body. The gate is self-healing: any ad that
 * is missing EITHER output (not classified, or classified but topics still null)
 * gets re-picked, so a partial failure never leaves permanent holes. `is_classifiable`
 * (Postgres-generated) drops blank/template-only bodies.
 */
async function fetchUniqueSignatures(scanCap = WAVE): Promise<CreativeItem[]> {
  const bySig = new Map<string, CreativeItem & { _len: number }>()
  let scanned = 0
  for (let off = 0; off < scanCap; off += 1000) {
    let q = (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title, copy_sig, on_screen_text')
      .eq('is_classifiable', true)
      .or('ai_classified.is.null,ai_classified.eq.false,topics.is.null')
      .not('copy_sig', 'is', null)
    if (PAGE_ID) q = q.eq('page_id', PAGE_ID)   // deep spy: this brand only
    const { data } = await q.range(off, off + 999)
    const rows = (data || []) as any[]
    if (!rows.length) break
    scanned += rows.length
    for (const a of rows) {
      const key = a.copy_sig as string
      const len = (a.body || '').length
      const prev = bySig.get(key)
      // Pick the representative with the richest body; carry on_screen_text (vision-extracted) so the
      // model sees what the viewer actually reads on the creative — the real hook for video ads.
      if (!prev || len > prev._len) {
        bySig.set(key, { key, page_name: a.page_name, title: a.title, body: a.body, on_screen_text: a.on_screen_text, _len: len })
      } else if (!prev.on_screen_text && a.on_screen_text) {
        prev.on_screen_text = a.on_screen_text   // keep any on-screen text even if a shorter-body row has it
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

/** submitBatch that never throws — a token-limit / rate rejection returns null so that sub-batch's ads
 *  just stay in the gate and get retried on the next super-wave (never double-charged). */
async function submitBatchSafe(items: CreativeItem[]): Promise<string | null> {
  try { return await submitBatch(items) }
  catch (e: any) { console.warn(`  ⚠️ batch submit skipped (${e?.message || e}) — ${items.length} sigs retry next wave`); return null }
}

/** SYNC path: fire all requests through a concurrency pool of real-time completions, applying each
 *  result as it returns. No 24h batch wait. Returns sigs applied. */
async function classifySync(items: CreativeItem[]): Promise<number> {
  const requests = chunk(items, SIGS_PER_REQUEST).map((group, i) => ({ customId: `r${i}`, prompt: buildMergedPrompt(group) }))
  console.log(`  ⚡ [sync ${provider.name}/${provider.model}] ${requests.length} requests @ concurrency ${CONCURRENCY} (${items.length} copy sigs)`)
  let applied = 0, done = 0
  await pool(requests, CONCURRENCY, async (req) => {
    let r
    try { r = await provider.complete(req) }
    catch (e: any) { console.warn(`  ⚠️ request failed (skipped): ${e?.message || e}`); return }
    tIn += r.inTok; tOut += r.outTok
    for (const c of r.items) {
      if (!c?.id) continue
      try { await propagateClassification(String(c.id), c); applied++ } catch { /* skip one */ }
    }
    if (++done % 25 === 0) console.log(`  … ${done}/${requests.length} reqs | applied ${applied} | est $${estCost().toFixed(2)}`)
  })
  console.log(`  ✅ sync wave: applied ${applied} sigs | est $${estCost().toFixed(3)} (full-price)`)
  return applied
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
  console.log(`Per-copy-signature classify — ${provider.name}/${provider.model}, wave=${WAVE}, perReq=${SIGS_PER_REQUEST}, mode=${SYNC ? `SYNC×${CONCURRENCY}` : 'batch(24h)'}`)
  // Batch adoption only matters for the async path (in-flight batches to resume). Sync has none.
  if (!SYNC) await adoptExistingBatches()

  let totalApplied = 0
  while (true) {
    // In concurrent batch mode scan a bigger SUPER-WAVE from ONE fetch so all BATCH_CONCURRENCY
    // sub-batches partition cleanly. (Concurrent fetches would each return the SAME unclassified
    // rows — the gate only advances after a drain applies results — causing duplicate submits/charges.)
    const scanCap = (!SYNC && BATCH_CONCURRENCY > 1) ? WAVE * BATCH_CONCURRENCY : WAVE
    const sigs = await fetchUniqueSignatures(scanCap)
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
      if (SYNC) {
        totalApplied += await classifySync(misses)
      } else {
        // CHEAP + PARALLEL: split the super-wave's misses into sub-batches (each ≤ SIGS_PER_BATCH),
        // keep BATCH_CONCURRENCY of them in flight (submit→drain as a unit). Same 50% batch price;
        // BATCH_CONCURRENCY=1 reproduces the original one-at-a-time behaviour.
        const groups = chunk(misses, SIGS_PER_BATCH)
        console.log(`  🚚 ${groups.length} sub-batch(es), ${BATCH_CONCURRENCY} in flight (batch-priced)`)
        const counts = await pool(groups, BATCH_CONCURRENCY, async (g) => {
          const id = await submitBatchSafe(g)
          return id ? await drainBatch(id) : 0
        })
        totalApplied += counts.reduce((a, b) => a + b, 0)
      }
    }
    if (ONCE) break
  }
  console.log(`🏁 done — applied ${totalApplied} sigs (${cacheHits} cache-reused) | ${provider.name}/${provider.model} est $${estCost().toFixed(2)} (${SYNC ? 'sync/full-price' : 'batch-priced'}, in=${tIn} out=${tOut})`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
