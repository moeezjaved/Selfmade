/**
 * SPY-ONLY corpus prune — permanently shrink discovery_ads_index to just what
 * Brand Spy needs, to cut Supabase disk + compute cost.
 *
 * KEEP a row if ANY of:
 *   • its brand is SPIED        → followed_brands.spied = true   (by page_id), or
 *   • its ad was SAVED          → discovery_saved_ads            (by ad_id), or
 *   • it is RECENT + renderable → has_creative = true AND last_seen >= now()-RECENT_DAYS
 * DELETE everything else (the general Discover corpus). Deletes discovery_creatives
 * first (FK), then discovery_ads_index, in chunks, with throttling.
 *
 * ⚠️  IRREVERSIBLE. This intentionally empties Discover / Trending / the programmatic
 * SEO pages / the MCP "3M ads" API down to the kept set. Brand Spy is unaffected —
 * spying a brand re-crawls it live on demand. Re-building the deleted corpus would
 * cost real proxy money + weeks, so review the DRY RUN counts before executing.
 *
 * Run on the droplet (with the crawler PAUSED — set system_flags.crawl_paused first,
 * and stop the classify/embed/crawl containers so nothing re-inserts mid-purge):
 *   docker exec worker node dist/purge-corpus-spy-only.js               # DRY RUN (default) — counts only, deletes nothing
 *   docker exec worker node dist/purge-corpus-spy-only.js --execute     # LIVE delete
 *   RECENT_DAYS=90 docker exec worker node dist/purge-corpus-spy-only.js # widen the "keep recent" window
 *
 * Safe by design: builds the keep-sets FIRST and ABORTS if the spied-brands query
 * returns nothing (that would mean "delete everything"). Forward keyset scan by
 * ad_id, so deleting rows behind the cursor never disturbs the scan. Idempotent +
 * resumable — re-run anytime.
 */
import { supabase } from './db.js'

const EXECUTE = process.argv.includes('--execute')
const DRY = !EXECUTE
const RECENT_DAYS = Number(process.env.RECENT_DAYS || 30)
const READ_PAGE = Number(process.env.PURGE_READ_PAGE || 1000)   // PostgREST caps responses at 1000
const DEL_CHUNK = Number(process.env.PURGE_DEL_CHUNK || 500)     // ad_ids per delete call
const THROTTLE_MS = Number(process.env.PURGE_THROTTLE_MS || 60)  // pause between delete calls

async function loadIdSet(table: string, column: string, filter?: (q: any) => any): Promise<Set<string>> {
  const set = new Set<string>()
  let from = 0
  const PAGE = 1000
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
  console.log(`\n🧹 Spy-only corpus prune ${DRY ? '(DRY RUN — nothing will be deleted)' : '(LIVE — --execute)'}`)
  console.log(`   Keep window: renderable ads seen in the last ${RECENT_DAYS} days\n`)

  // 1) Keep-sets (small: 58 spied brands + user-saved ads). Build FIRST.
  const keepPages = await loadIdSet('followed_brands', 'page_id', (q) => q.eq('spied', true))
  const keepSaved = await loadIdSet('discovery_saved_ads', 'ad_id')
  console.log(`   Keep: ${keepPages.size} spied brands · ${keepSaved.size} saved ads`)

  // HARD SAFETY: if we somehow got zero spied brands, abort — otherwise we'd delete the world.
  if (keepPages.size === 0) {
    console.error('\n❌ ABORT: 0 spied brands loaded. That would delete nearly the whole corpus.')
    console.error('   Check the followed_brands query / connection and re-run. Nothing was deleted.')
    process.exit(1)
  }

  const cutoffIso = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()

  // 2) Forward keyset scan of the whole table by ad_id. Decide keep/delete per row.
  let cursor = ''
  let scanned = 0, kept = 0, toDelete = 0, deleted = 0, delFailed = 0
  let delBatch: string[] = []
  const sampleDeletes: string[] = []

  const flush = async () => {
    if (!delBatch.length) return
    const ids = delBatch
    delBatch = []
    if (DRY) return
    // FK: delete children (discovery_creatives) first, then the index row.
    await (supabase as any).from('discovery_creatives').delete().in('ad_id', ids)
    const { error } = await (supabase as any).from('discovery_ads_index').delete().in('ad_id', ids)
    if (error) {
      delFailed += ids.length
      console.error(`\n  ⚠️  delete chunk failed (${ids.length}): ${error.message}`)
      await new Promise((r) => setTimeout(r, 1000))
      return
    }
    deleted += ids.length
    await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }

  for (;;) {
    // ad_id is the PK (text) → stable keyset order. Only forward (> cursor), so
    // rows we already deleted (behind cursor) never reappear.
    let q = (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_id, has_creative, last_seen')
      .order('ad_id', { ascending: true })
      .limit(READ_PAGE)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) throw new Error(`scan: ${error.message}`)
    const rows = (data as any[]) || []
    if (!rows.length) break

    for (const r of rows) {
      scanned++
      const adId = String(r.ad_id)
      const isSpied = r.page_id != null && keepPages.has(String(r.page_id))
      const isSaved = keepSaved.has(adId)
      const isRecent = r.has_creative === true && r.last_seen != null && r.last_seen >= cutoffIso
      if (isSpied || isSaved || isRecent) {
        kept++
      } else {
        toDelete++
        if (sampleDeletes.length < 10) sampleDeletes.push(adId)
        delBatch.push(adId)
        if (delBatch.length >= DEL_CHUNK) await flush()
      }
    }

    cursor = String(rows[rows.length - 1].ad_id)
    if (scanned % 100000 < READ_PAGE) {
      process.stdout.write(`\r   scanned ${scanned.toLocaleString()} · keep ${kept.toLocaleString()} · delete ${(DRY ? toDelete : deleted).toLocaleString()}   `)
    }
    // Do NOT break on rows.length < READ_PAGE — PostgREST caps pages below READ_PAGE.
    // The empty-fetch check at the top of the loop is the real terminator (keyset by ad_id).
  }
  await flush()

  console.log(`\n\n📊 Result`)
  console.log(`   Scanned:  ${scanned.toLocaleString()}`)
  console.log(`   Keep:     ${kept.toLocaleString()}`)
  console.log(`   ${DRY ? 'Would delete' : 'Deleted'}:  ${(DRY ? toDelete : deleted).toLocaleString()}`)
  if (!DRY && delFailed) console.log(`   Failed:   ${delFailed.toLocaleString()} (re-run to retry)`)
  if (DRY) {
    console.log(`\n   sample to-delete ad_ids: ${sampleDeletes.join(', ')}`)
    console.log(`\n💡 DRY RUN — re-run with --execute to delete. After deleting, reclaim disk with`)
    console.log(`   pg_repack / VACUUM FULL, then a Postgres version upgrade to shrink the disk.`)
  } else {
    console.log(`\n✅ Prune complete. Space is freed inside the table but NOT returned to the disk`)
    console.log(`   yet — run pg_repack (online) or VACUUM FULL discovery_ads_index in a window,`)
    console.log(`   then a Postgres version upgrade to reprovision a smaller disk, then Medium→Small.`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💀 Fatal:', err)
  process.exit(1)
})
