#!/usr/bin/env node
/**
 * Search eval harness — measures precision@10 for the discovery search so every
 * ranking/matching change is provable instead of vibes-tuned.
 *
 * It black-boxes the REAL /api/discovery/db-search endpoint (same code users hit),
 * so there's no logic-copy that can silently drift. Auth is bypassed via the
 * env-guarded SEARCH_EVAL_TOKEN header (dead code in prod unless that env is set).
 *
 * Setup (once):
 *   In the target env (local .env.local or Vercel), set a secret:
 *     SEARCH_EVAL_TOKEN=<any-long-random-string>
 *
 * Run:
 *   EVAL_BASE_URL=http://localhost:3000 SEARCH_EVAL_TOKEN=xxx node scripts/search-eval.mjs
 *   # against prod:
 *   EVAL_BASE_URL=https://tryselfmade.ai SEARCH_EVAL_TOKEN=xxx node scripts/search-eval.mjs
 *
 *   --save        write current scores as the baseline (scripts/.search-eval-baseline.json)
 *   --k=10        precision@K (default 10)
 *   --country=ALL country filter passed to the search (default ALL = match anywhere)
 *
 * Output: per-query precision@K + hit, overall mean precision@K + hit-rate, and
 * (if a baseline exists) the per-query DELTA vs baseline so regressions are obvious.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.EVAL_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.SEARCH_EVAL_TOKEN || ''
const argK = process.argv.find(a => a.startsWith('--k='))
const K = argK ? parseInt(argK.split('=')[1], 10) : 10
const argC = process.argv.find(a => a.startsWith('--country='))
const COUNTRY = argC ? argC.split('=')[1] : 'ALL'
const SAVE = process.argv.includes('--save')
const BASELINE_PATH = join(__dir, '.search-eval-baseline.json')

if (!TOKEN) {
  console.error('✗ SEARCH_EVAL_TOKEN env is required (must match the value set in the target server env).')
  process.exit(1)
}

const lc = s => String(s ?? '').toLowerCase()
const anyIncludes = (hay, needles) => needles.some(n => lc(hay).includes(lc(n)))

// A result is relevant if EITHER rule matches: pageName contains an expected brand,
// or the ad's industries/topics intersect an expected concept.
function isRelevant(ad, c) {
  if (c.expectBrands?.length && anyIncludes(ad.pageName, c.expectBrands)) return true
  if (c.expectIndustryAny?.length) {
    const tags = [...(ad.industries || []), ...(ad.themes || []), ...(ad.topics || [])].map(lc)
    if (tags.some(t => c.expectIndustryAny.some(e => t.includes(lc(e)) || lc(e).includes(t)))) return true
  }
  return false
}

async function runCase(c) {
  const params = new URLSearchParams({
    q: c.q, mode: c.mode || 'adcopy', country: COUNTRY, sort: 'recommended', page: '0',
  })
  const url = `${BASE}/api/discovery/db-search?${params}`
  let json
  try {
    const res = await fetch(url, { headers: { 'x-eval-token': TOKEN } })
    json = await res.json()
    if (json.error) return { ...c, error: json.error }
  } catch (e) {
    return { ...c, error: String(e?.message || e) }
  }
  const ads = (json.ads || []).slice(0, K)
  const relevant = ads.filter(a => isRelevant(a, c)).length
  const precision = ads.length ? relevant / ads.length : 0
  const hit = c.expectBrands?.length
    ? ads.some(a => anyIncludes(a.pageName, c.expectBrands))
    : relevant > 0
  return {
    q: c.q, mode: c.mode || 'adcopy', note: c.note || '',
    returned: ads.length, relevant, precision,
    hit, method: json.searchMethod || '?', total: json.total || 0,
    top3: ads.slice(0, 3).map(a => `${a.pageName || '?'}${a.matchReason ? `[${a.matchReason}]` : ''}`),
  }
}

async function main() {
  const raw = JSON.parse(await readFile(join(__dir, 'search-eval-queries.json'), 'utf8'))
  const cases = raw.cases || []
  let baseline = null
  try { baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) } catch { /* none yet */ }
  const baseByQ = {}
  for (const r of baseline?.results || []) baseByQ[`${r.q}|${r.mode}`] = r

  console.log(`\n  Search eval — ${BASE}  (precision@${K}, country=${COUNTRY})\n`)
  const results = []
  for (const c of cases) {
    const r = await runCase(c)
    results.push(r)
    if (r.error) { console.log(`  ✗ ${r.q.padEnd(22)} ERROR: ${r.error}`); continue }
    const base = baseByQ[`${r.q}|${r.mode}`]
    let delta = ''
    if (base) {
      const d = r.precision - base.precision
      delta = d > 0.001 ? `  ▲+${d.toFixed(2)}` : d < -0.001 ? `  ▼${d.toFixed(2)}` : '  ='
    }
    const flag = r.precision >= 0.7 ? '✓' : r.precision >= 0.3 ? '~' : '✗'
    console.log(
      `  ${flag} ${r.q.padEnd(22)} P@${K}=${r.precision.toFixed(2)} ` +
      `hit=${r.hit ? 'Y' : 'n'} ${String(r.relevant + '/' + r.returned).padEnd(6)} ` +
      `${r.method.padEnd(7)} tot=${String(r.total).padEnd(5)}${delta}`
    )
    if (r.top3.length) console.log(`      └ ${r.top3.join('  ·  ')}`)
  }

  const ok = results.filter(r => !r.error)
  const meanP = ok.reduce((s, r) => s + r.precision, 0) / (ok.length || 1)
  const hitRate = ok.filter(r => r.hit).length / (ok.length || 1)
  console.log(`\n  ── Overall (${ok.length} queries) ──`)
  console.log(`  mean precision@${K} : ${meanP.toFixed(3)}`)
  console.log(`  hit-rate@${K}       : ${(hitRate * 100).toFixed(0)}%`)
  if (baseline) {
    const baseMean = (baseline.results || []).reduce((s, r) => s + (r.precision || 0), 0) / ((baseline.results || []).length || 1)
    const d = meanP - baseMean
    console.log(`  vs baseline        : ${d >= 0 ? '▲ +' : '▼ '}${d.toFixed(3)}  (was ${baseMean.toFixed(3)})`)
  }
  if (results.some(r => r.error)) console.log(`  ⚠️  ${results.filter(r => r.error).length} queries errored (server down? token mismatch?)`)

  if (SAVE) {
    await writeFile(BASELINE_PATH, JSON.stringify({ savedAt: new Date().toISOString(), k: K, meanP, hitRate, results }, null, 2))
    console.log(`\n  ✓ baseline saved → scripts/.search-eval-baseline.json`)
  }
  console.log('')
}
main().catch(e => { console.error(e); process.exit(1) })
