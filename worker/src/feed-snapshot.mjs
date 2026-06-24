/**
 * Feed snapshot refresher — keeps Discovery's default feed instant.
 *
 * Calls db-search with `fresh=1` (which bypasses the snapshot READ → forces a live recompute) using
 * the eval token, then upserts the exact response into discovery_feed_cache. Serving then reads that
 * row instead of the contended live query, so the default feed paints instantly even while the
 * rollup/drain write discovery_ads_index. Reusing db-search (vs reimplementing its transform) means
 * the snapshot can never drift from what a live query would return.
 *
 * Env: APP_URL, SEARCH_EVAL_TOKEN (must ALSO be set in Vercel so db-search trusts it),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Run (loops every 3 min):
 *   docker run -d --name feed-snapshot --env-file /opt/worker/.env \
 *     -v /root/Selfmade/worker/src:/app/src selfmade-worker node src/feed-snapshot.mjs
 * One-shot (e.g. from crontab): SNAPSHOT_LOOP=0 node src/feed-snapshot.mjs
 */
const APP = process.env.APP_URL || 'https://tryselfmade.ai'
const EVAL = process.env.SEARCH_EVAL_TOKEN
const REST = (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1/'
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SRK, Authorization: `Bearer ${SRK}` }

// Pre-warm the sorts the UI defaults to. Add more here if you want other bare-feed sorts instant.
const SORTS = ['recommended', 'performance']

async function refreshOne(sort) {
  const r = await fetch(`${APP}/api/discovery/db-search?sort=${sort}&fresh=1`, {
    headers: EVAL ? { 'x-eval-token': EVAL } : {},
  })
  if (!r.ok) { console.error(`  ✗ db-search ${sort} → ${r.status}`); return }
  const payload = await r.json()
  if (!Array.isArray(payload.ads) || payload.ads.length === 0) { console.warn(`  · ${sort}: empty payload, skip`); return }
  const up = await fetch(REST + 'discovery_feed_cache?on_conflict=key', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: `feed:default:${sort}`, payload, updated_at: new Date().toISOString() }),
  })
  console.log(`  ✓ ${sort}: ${payload.ads.length} ads → cache ${up.ok ? 'OK' : 'FAILED ' + up.status}`)
}

async function tick() {
  console.log(`[feed-snapshot] refreshing @ ${new Date().toISOString()}`)
  for (const s of SORTS) { try { await refreshOne(s) } catch (e) { console.error(`  ✗ ${s}:`, e?.message ?? e) } }
}

if (!SRK || !process.env.SUPABASE_URL) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
if (!EVAL) console.warn('⚠️  SEARCH_EVAL_TOKEN not set — db-search will 401 unless it is set here AND in Vercel')

await tick()
const LOOP = process.env.SNAPSHOT_LOOP !== '0'
const EVERY = Math.max(60_000, parseInt(process.env.SNAPSHOT_EVERY_MS || '180000', 10))
if (LOOP) setInterval(tick, EVERY)
else process.exit(0)
