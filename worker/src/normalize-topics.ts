/**
 * One-off (and re-runnable) topic canonicalizer — applies CANONICAL_TOPICS to the
 * already-classified rows WITHOUT calling any model ($0). Run after adding new
 * variant pairs to the map, or after a classify run, to collapse fragmentation.
 *
 *   npx tsx src/normalize-topics.ts
 */
import { supabase } from './db.js'
import { CANONICAL_TOPICS, canonTopic } from './classify-core.js'

async function main() {
  const variants = Object.keys(CANONICAL_TOPICS)
  if (!variants.length) { console.log('no variants to normalize.'); process.exit(0) }
  console.log(`normalizing ${variants.length} variant tags…`)

  let changed = 0, scanned = 0
  // Only rows that actually contain a variant tag need touching (overlaps any variant).
  for (let off = 0; ; off += 1000) {
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, topics')
      .overlaps('topics', variants)
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (!rows.length) break
    scanned += rows.length
    for (const r of rows) {
      const canon = Array.from(new Set((r.topics || []).map((t: string) => canonTopic(t))))
      // write back only if the canonical set differs
      if (JSON.stringify(canon) !== JSON.stringify(r.topics)) {
        await (supabase as any).from('discovery_ads_index').update({ topics: canon }).eq('ad_id', r.ad_id)
        changed++
      }
    }
    if (rows.length < 1000) break
  }
  console.log(`✅ scanned ${scanned} rows containing a variant, updated ${changed}.`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
