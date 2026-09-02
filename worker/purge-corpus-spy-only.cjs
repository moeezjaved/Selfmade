/**
 * SPY-ONLY corpus prune — STANDALONE (no build needed).
 *
 * Same logic as src/purge-corpus-spy-only.ts, but a self-contained CommonJS file
 * so it can be dropped straight into the running `worker` container (which already
 * has @supabase/supabase-js + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in its env):
 *
 *   cd /root/Selfmade && git pull
 *   docker cp worker/purge-corpus-spy-only.cjs worker:/app/purge-corpus-spy-only.cjs
 *   docker exec worker node /app/purge-corpus-spy-only.cjs             # DRY RUN (counts only)
 *   docker exec worker node /app/purge-corpus-spy-only.cjs --execute   # LIVE delete
 *   docker exec -e RECENT_DAYS=90 worker node /app/purge-corpus-spy-only.cjs   # wider keep window
 *
 * KEEP a row if ANY of: brand SPIED (followed_brands.spied by page_id) · ad SAVED
 * (discovery_saved_ads by ad_id) · RECENT+renderable (has_creative AND last_seen >=
 * now()-RECENT_DAYS). DELETE the rest. ⚠️ IRREVERSIBLE — empties Discover/Trending/
 * SEO/MCP down to the kept set; Brand Spy is unaffected (re-crawls on demand).
 * Pause the crawler first (system_flags.crawl_paused + stop the crawl/classify
 * containers) so nothing re-inserts mid-purge.
 */
const { createClient } = require('@supabase/supabase-js')

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in this container env.')
  process.exit(1)
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } })

const EXECUTE = process.argv.includes('--execute')
const DRY = !EXECUTE
const RECENT_DAYS = Number(process.env.RECENT_DAYS || 30)
const READ_PAGE = Number(process.env.PURGE_READ_PAGE || 5000)
const DEL_CHUNK = Number(process.env.PURGE_DEL_CHUNK || 500)
const THROTTLE_MS = Number(process.env.PURGE_THROTTLE_MS || 60)

async function loadIdSet(table, column, filter) {
  const set = new Set()
  let from = 0
  const PAGE = 1000
  for (;;) {
    let q = supabase.from(table).select(column).range(from, from + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}.${column}: ${error.message}`)
    if (!data || !data.length) break
    for (const r of data) if (r[column] != null) set.add(String(r[column]))
    from += data.length
    if (data.length < PAGE) break
  }
  return set
}

async function main() {
  console.log(`\n🧹 Spy-only corpus prune ${DRY ? '(DRY RUN — nothing will be deleted)' : '(LIVE — --execute)'}`)
  console.log(`   Keep window: renderable ads seen in the last ${RECENT_DAYS} days\n`)

  const keepPages = await loadIdSet('followed_brands', 'page_id', (q) => q.eq('spied', true))
  const keepSaved = await loadIdSet('discovery_saved_ads', 'ad_id')
  console.log(`   Keep: ${keepPages.size} spied brands · ${keepSaved.size} saved ads`)

  if (keepPages.size === 0) {
    console.error('\n❌ ABORT: 0 spied brands loaded — that would delete nearly the whole corpus. Nothing deleted.')
    process.exit(1)
  }

  const cutoffIso = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  let cursor = ''
  let scanned = 0, kept = 0, toDelete = 0, deleted = 0, delFailed = 0
  let delBatch = []
  const sampleDeletes = []

  const flush = async () => {
    if (!delBatch.length) return
    const ids = delBatch
    delBatch = []
    if (DRY) return
    await supabase.from('discovery_creatives').delete().in('ad_id', ids)
    const { error } = await supabase.from('discovery_ads_index').delete().in('ad_id', ids)
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
    let q = supabase
      .from('discovery_ads_index')
      .select('ad_id, page_id, has_creative, last_seen')
      .order('ad_id', { ascending: true })
      .limit(READ_PAGE)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) throw new Error(`scan: ${error.message}`)
    const rows = data || []
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
    if (rows.length < READ_PAGE) break
  }
  await flush()

  console.log(`\n\n📊 Result`)
  console.log(`   Scanned:      ${scanned.toLocaleString()}`)
  console.log(`   Keep:         ${kept.toLocaleString()}`)
  console.log(`   ${DRY ? 'Would delete' : 'Deleted'}: ${(DRY ? toDelete : deleted).toLocaleString()}`)
  if (!DRY && delFailed) console.log(`   Failed:       ${delFailed.toLocaleString()} (re-run to retry)`)
  if (DRY) {
    console.log(`\n   sample to-delete ad_ids: ${sampleDeletes.join(', ')}`)
    console.log(`\n💡 DRY RUN — re-run with --execute to delete.`)
  } else {
    console.log(`\n✅ Prune complete. Freed space is inside the table but NOT back on the disk yet —`)
    console.log(`   run VACUUM FULL discovery_ads_index (or pg_repack) then a Postgres version`)
    console.log(`   upgrade to shrink the disk, then compute Medium→Small.`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💀 Fatal:', err)
  process.exit(1)
})
