/**
 * page_id duplicate cleanup for discovery_crawl_terms.
 *
 * `term` is unique so duplicate NAMES can't exist, but page_id was never unique — the same
 * advertiser could land twice under different name spellings, making the crawler crawl that
 * Facebook page twice. This finds page_ids tracked by >1 ACTIVE row, keeps the single
 * most-progressed row (crawled > uncrawled, then most ads, then oldest), and DEACTIVATES
 * the rest (is_active=false — recoverable, not deleted). The kept row stays active so the
 * page is still crawled exactly once.
 *
 * Gentle: keyset-paginated reads (1000/page, indexed by id) + per-update sleeps. Safe on the
 * small (~44K) crawl_terms table even under the count-push.
 *
 *   DRY=1 → scan + report only (no changes).   omit DRY → also deactivate.
 *   docker run --rm --env-file /opt/worker/.env -e DRY=1 \
 *     -v /opt/worker/src/dupe-cleanup.ts:/app/src/dupe-cleanup.ts selfmade-worker npx tsx src/dupe-cleanup.ts
 */
import { supabase } from './db.js'

const DRY = process.env.DRY === '1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = { id: string; term: string; page_id: string; is_active: boolean; last_crawled_at: string | null; ads_found: number | null; created_at: string }
const DELETE_CORRUPTED = process.env.DELETE_CORRUPTED === '1'

async function main() {
  console.log(`🔎 dupe-cleanup ${DRY ? '(DRY RUN — no changes)' : '(LIVE — will deactivate redundant copies)'}`)

  // Pull all ACTIVE rows that have a page_id, keyset by id (indexed → light).
  const rows: Row[] = []
  let cursor: string | null = null
  for (;;) {
    let q = (supabase as any)
      .from('discovery_crawl_terms')
      .select('id, term, page_id, is_active, last_crawled_at, ads_found, created_at')
      .not('page_id', 'is', null)
      .order('id', { ascending: true })
      .limit(1000)
    if (cursor) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) { console.error('scan failed:', error.message); break }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    cursor = data[data.length - 1].id
    await sleep(150)   // gentle on the DB
  }
  console.log(`scanned ${rows.length} active rows with a page_id`)

  // Split valid (numeric) page_ids from CORRUPTED ones. Real Facebook page_ids are all
  // digits. Non-numeric values ("MD", "LLP", "Inc.", "China", …) are name-suffix fragments
  // that landed in the page_id column from malformed CSV rows (commas inside brand names
  // shifting columns). Those are NOT duplicates — many unrelated brands share each garbage
  // value — so we must NOT dedup on them; we only report them.
  const isNumericPageId = (s: string) => /^\d+$/.test(s)
  const badPageId = rows.filter((r) => !isNumericPageId(r.page_id))
  console.log(`⚠️  rows with a CORRUPTED (non-numeric) page_id: ${badPageId.length} (these are bad CSV imports, NOT dupes — left untouched)`)
  const badSamples = [...new Set(badPageId.map((r) => r.page_id))].slice(0, 8)
  if (badSamples.length) console.log(`    sample bad page_id values: ${badSamples.map((s) => `"${s}"`).join(', ')}`)

  // DELETE-CORRUPTED mode: hard-delete the rows whose page_id is non-numeric. They came
  // from malformed CSV (the comma split also truncated the NAME), so they can't be crawled
  // or salvaged in place — a clean re-import (now that the parser is fixed) is the way to
  // recover those brands. Separate from the dupe pass below.
  if (DELETE_CORRUPTED) {
    console.log(`🗑️  DELETE-CORRUPTED mode: ${badPageId.length} rows with non-numeric page_id`)
    badPageId.slice(0, 15).forEach((r) => console.log(`    DELETE "${r.term}" (page_id="${r.page_id}", ${r.is_active ? 'active' : 'inactive'})`))
    if (badPageId.length > 15) console.log(`    …and ${badPageId.length - 15} more`)
    if (DRY) { console.log('DRY RUN — no deletes.'); return }
    let del = 0
    for (const r of badPageId) {
      const { error } = await (supabase as any).from('discovery_crawl_terms').delete().eq('id', r.id)
      if (!error) del++
      await sleep(60)
    }
    console.log(`🗑️  deleted ${del} corrupted-page_id rows`)
    return
  }

  // Group ONLY the valid numeric page_ids that are still ACTIVE (the dupe pass).
  const byPage = new Map<string, Row[]>()
  for (const r of rows) {
    if (!isNumericPageId(r.page_id) || !r.is_active) continue
    const g = byPage.get(r.page_id) || []
    g.push(r); byPage.set(r.page_id, g)
  }
  const dupes = [...byPage.entries()].filter(([, rs]) => rs.length > 1)
  const redundant = dupes.reduce((s, [, rs]) => s + rs.length - 1, 0)
  console.log(`distinct page_ids: ${byPage.size} | DUPLICATE page_ids: ${dupes.length} | redundant rows to remove: ${redundant}`)

  // Show a sample so the result is auditable.
  dupes.slice(0, 15).forEach(([pid, rs]) => {
    console.log(`  page_id ${pid}: ${rs.map((r) => `"${r.term}"${r.last_crawled_at ? '✓crawled' : ''}`).join('  |  ')}`)
  })
  if (dupes.length > 15) console.log(`  …and ${dupes.length - 15} more duplicate page_ids`)

  if (DRY) { console.log('DRY RUN complete — no changes made.'); return }

  // Keep the most-progressed row per page_id; deactivate the rest.
  let deactivated = 0
  for (const [, rs] of dupes) {
    const ranked = rs.slice().sort((a, b) => {
      const ca = a.last_crawled_at ? 1 : 0, cb = b.last_crawled_at ? 1 : 0
      if (ca !== cb) return cb - ca                              // crawled first
      const fa = a.ads_found || 0, fb = b.ads_found || 0
      if (fa !== fb) return fb - fa                              // more ads first
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()  // oldest first
    })
    for (const drop of ranked.slice(1)) {
      const { error } = await (supabase as any).from('discovery_crawl_terms').update({ is_active: false }).eq('id', drop.id)
      if (!error) deactivated++
      await sleep(80)
    }
  }
  console.log(`✅ deactivated ${deactivated} redundant duplicate rows (kept 1 active per page_id, recoverable via is_active=true)`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('fatal:', e); process.exit(1) })
