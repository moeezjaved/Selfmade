/**
 * spy-classify-worker — auto-classify brands on demand ("spy → DNA in minutes").
 *
 * Polls spy_classify_queue (filled by the web app when a user opens Brand Spy for a brand
 * whose AI-DNA panels are empty) and runs the EXISTING per-copy-signature classifier scoped
 * to that ONE brand via CLASSIFY_PAGE_ID. One brand at a time → it scans only that brand's
 * ads (not a full-table seq scan), so DB load is tiny and it's safe to run alongside live
 * serving — unlike the global classify drain, which is what was slowing search.
 *
 * Run (droplet):
 *   docker run -d --name spy-classify --restart unless-stopped \
 *     --env-file <env> -v /opt/worker/src:/app/src \
 *     selfmade-worker npx tsx src/spy-classify-worker.mjs
 */
import { spawn } from 'node:child_process'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const IDLE_MS = Math.max(5000, parseInt(process.env.SPY_POLL_MS || '15000', 10))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent

if (!U || !K) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

// Grab the oldest pending brand and atomically claim it (PATCH guarded by status=pending, so if a
// second worker ever raced us the claim returns zero rows and we just try the next tick).
async function claimNext() {
  const r = await fetch(`${U}/rest/v1/spy_classify_queue?status=eq.pending&order=requested_at.asc&limit=1&select=page_id`, { headers: H })
  if (!r.ok) { console.warn('poll failed', r.status); return null }
  const rows = await r.json()
  if (!Array.isArray(rows) || !rows.length) return null
  const pid = rows[0].page_id
  const up = await fetch(`${U}/rest/v1/spy_classify_queue?page_id=eq.${enc(pid)}&status=eq.pending`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'processing', started_at: new Date().toISOString() }),
  })
  if (!up.ok) return null
  const claimed = await up.json()
  return Array.isArray(claimed) && claimed.length ? pid : null   // lost the race → retry next tick
}

// Run the existing classifier for ONE brand. classify-batch.ts honors CLASSIFY_PAGE_ID (this brand
// only) + --once (one wave then exit), and exits 0 cleanly even when there's nothing left to do.
// SPY IS PRIORITY: use --sync (real-time parallel completions) so a user who spies a brand gets it
// classified in MINUTES, not a 24h batch. Volume is tiny (one brand's ads), so full-price is trivial.
// (Overridable: set SPY_SYNC=0 to fall back to the cheap batch path.)
function runClassify(pageId) {
  const sync = process.env.SPY_SYNC !== '0'
  const args = ['tsx', 'src/classify-batch.ts', '--once']
  if (sync) args.push('--sync')
  return new Promise((resolve) => {
    const child = spawn('npx', args, {
      cwd: '/app',
      env: { ...process.env, CLASSIFY_PAGE_ID: pageId, CLASSIFY_PROVIDER: process.env.CLASSIFY_PROVIDER || 'openai', CLASSIFY_CONCURRENCY: process.env.CLASSIFY_CONCURRENCY || '40' },
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', (e) => { console.warn('spawn error', e?.message || e); resolve(false) })
  })
}

async function mark(pageId, status, error) {
  const body = { status, finished_at: new Date().toISOString() }
  if (error) body.error = String(error).slice(0, 500)
  await fetch(`${U}/rest/v1/spy_classify_queue?page_id=eq.${enc(pageId)}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(body),
  }).catch(() => {})
}

console.log(`🔎 spy-classify-worker up — polling every ${IDLE_MS}ms`)
for (;;) {
  let pid = null
  try { pid = await claimNext() } catch (e) { console.warn('claim error', e?.message || e) }
  if (!pid) { await sleep(IDLE_MS); continue }
  console.log(`▶ classifying brand ${pid}`)
  const ok = await runClassify(pid)
  await mark(pid, ok ? 'done' : 'error', ok ? null : 'classify-batch exited non-zero')
  console.log(`${ok ? '✅' : '⚠️'} brand ${pid} ${ok ? 'done' : 'errored'}`)
}
