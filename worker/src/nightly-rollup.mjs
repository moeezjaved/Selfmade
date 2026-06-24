/**
 * Discovery rollup — INCREMENTAL nightly, FULL weekly. Runs ON THE DROPLET.
 *
 * WHY: the old version re-scored the WHOLE corpus every night — at ~700K ads that's
 * a multi-hour full-table fetch+write that spikes Supabase CPU >80% and holds the
 * crawl-pause for hours. The score's only cross-corpus dependency is the percentile
 * calibration (score = mapP(pctOf(rawv))); everything else is BRAND-LOCAL.
 *
 * DESIGN:
 *  • FULL (weekly / first run / --full): fetch all, recompute everything, calibrate
 *    percentiles, write all, and CACHE the quantile cutpoints (migration 032).
 *  • INCREMENTAL (nightly): re-score only TOUCHED ads using the cached cutpoints —
 *      - new ads (indexed_at > last run)               → their brands
 *      - tier-threshold crossers (realDays crossed 7/14 since last score)
 *      - changed brands (the above) re-aggregated from THEIR OWN ads (brand-local)
 *    No full-table sort, tiny write set, near-zero crawl-pause. Tiers stay anchored to
 *    the last weekly calibration; the weekly full pass re-anchors (and ages out the
 *    brand-velocity window) so "Winning" can't drift.
 *
 * Run: docker exec worker node /app/src/nightly-rollup.mjs [--full]   (via rollup-cron.sh)
 */
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, Authorization: 'Bearer ' + K };
const ALERT = process.env.ALERT_WEBHOOK_URL || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const ARG_FULL = process.argv.includes('--full');
const ARG_INCR = process.argv.includes('--incremental');   // force incremental (overrides Sunday=full), for manual/test runs
const REST = U + '/rest/v1/';

// ── scoring math (unchanged — keep IDENTICAL to preserve scores) ──────────────
const LN91 = Math.log(91);
const realDays = a => { const end = a.stop_date ? Date.parse(a.stop_date) : (a.last_seen ? Date.parse(a.last_seen) : Date.now()); const start = a.start_date ? Date.parse(a.start_date) : end; let d = Math.floor((end - start) / 864e5); if (!Number.isFinite(d) || d < 0) d = 0; if (d > 3650) d = 3650; return d; };
const bp = [[0, 0], [.25, .2], [.55, .4], [.8, .6], [.95, .8], [1, 1]];
const mapP = p => { for (let i = 1; i < bp.length; i++) if (p <= bp[i][0]) { const [p0, s0] = bp[i - 1], [p1, s1] = bp[i]; return s0 + (s1 - s0) * (p - p0) / (p1 - p0 || 1); } return 1; };

// per-brand aggregates over a set of rows (brand-local → exact for any complete brand)
function aggregate(rows) {
  const reuse = new Map(), brandActive = new Map(), brandNew = new Map(), since = Date.now() - 21 * 864e5;
  for (const a of rows) {
    const ck = a.image_hash || a.video_hash;
    if (ck) { const k = a.page_id + '|' + ck; reuse.set(k, (reuse.get(k) || 0) + 1); }
    if (a.is_active) brandActive.set(a.page_id, (brandActive.get(a.page_id) || 0) + 1);
    const sd = a.start_date ? Date.parse(a.start_date) : NaN;
    if (!Number.isNaN(sd) && sd >= since) brandNew.set(a.page_id, (brandNew.get(a.page_id) || 0) + 1);
  }
  return { reuse, brandActive, brandNew };
}
function enrich(rows, agg) {
  return rows.map(a => {
    const ck = a.image_hash || a.video_hash;
    const rc = ck ? (agg.reuse.get(a.page_id + '|' + ck) || 0) : 0;
    const bv = agg.brandActive.get(a.page_id) || 0;
    const bn = agg.brandNew.get(a.page_id) || 0;
    const days = realDays(a);
    const rt = Math.min(1, Math.log(1 + days) / LN91);
    const af = Math.min(1, days / 21);
    let rawv = (0.40 * rt + 0.25 * Math.min(1, rc / 6) + 0.20 * Math.min(1, bv / 30) + 0.15 * Math.min(1, bn / 12)) * af * (a.is_active ? 1 : 0.6);
    rawv += days * 1e-7;
    return { ad_id: a.ad_id, page_id: a.page_id, rc, bv, days, rawv };
  });
}
// score one enriched ad given a pctOf(rawv)→[0,1] function (+ hard longevity gate).
// SENTINEL FLOOR 0.001: a scored ad NEVER lands exactly 0, so it always leaves the
// `score=0` set (an un-scoreable ad can't loop forever) AND `score=0` becomes a clean
// "never scored" signal for the self-heal below. 0.001 is still 'testing' tier.
const scoreOf = (e, pctOf) => { let s = mapP(pctOf(e.rawv)); if (e.days < 7) s = Math.min(s, .599); else if (e.days < 14) s = Math.min(s, .799); s = Math.max(0.001, s); return { aid: e.ad_id, ps: Math.round(s * 1000) / 1000, dr: e.days, rc: e.rc, bv: e.bv }; };

// ── REST helpers ──────────────────────────────────────────────────────────────
const SEL = 'ad_id,page_id,image_hash,video_hash,is_active,start_date,stop_date,last_seen,niche';
// Retry on non-200 (503/timeout under DB load), then THROW — never silently return
// []. The rollup runs alongside live crawl+drain, so transient errors are expected;
// but a swallowed error returning "0 rows" is the DANGEROUS pattern: a truncated MAIN
// fetch would compute the percentile cutpoints on a fraction of the corpus → skewed
// tiers for everyone (NOT self-healed). So fetch failures are LOUD everywhere — a
// persistent failure aborts the whole run (cron logs exit≠0, retries next night; no
// partial/wrong write, the corpus keeps its previous correct scores). A 200 with an
// empty array is real end-of-data and returns immediately (only errors retry).
async function getJSON(qs, retries = 5) {
  let lastErr = '';
  for (let t = 0; t <= retries; t++) {
    try { const r = await fetch(REST + qs, { headers: H }); if (r.ok) return await r.json(); lastErr = r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160); }
    catch (e) { lastErr = String((e && e.message) || e); }
    if (t < retries) await sleep(1500 * (t + 1));
  }
  throw new Error(`getJSON FAILED after ${retries + 1} tries: ${qs.split('?')[0]} — ${lastErr}`);
}
async function keyset(baseQs, label) {     // keyset-paginate by ad_id (stable under concurrent inserts)
  const out = []; let cursor = '', nextHb = 100000;
  for (;;) {
    let q = baseQs + '&order=ad_id.asc&limit=1000' + (cursor ? '&ad_id=gt.' + encodeURIComponent(cursor) : '');
    const d = await getJSON(q);
    if (!Array.isArray(d) || !d.length) break;
    out.push(...d); cursor = d[d.length - 1].ad_id;
    if (label && out.length >= nextHb) { console.log(`[rollup] ${label}: fetched ${out.length} @ +${((Date.now() - t0) / 1000) | 0}s`); nextHb += 100000; }
    if (d.length < 1000) break;
  }
  return out;
}
const count = async qs => { const r = await fetch(REST + qs, { headers: { ...H, Range: '0-0', Prefer: 'count=exact' } }); return +((r.headers.get('content-range') || '').split('/')[1] || 0); };
const countPlanned = async qs => { const r = await fetch(REST + qs, { headers: { ...H, Range: '0-0', Prefer: 'count=planned' } }); return +((r.headers.get('content-range') || '').split('/')[1] || 0); };
async function setFlag(mins = 5) { await fetch(REST + 'system_flags?on_conflict=key', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key: 'crawl_paused', until: new Date(Date.now() + mins * 60_000).toISOString(), updated_at: new Date().toISOString() }) }); }
async function clearFlag() { await fetch(REST + 'system_flags?key=eq.crawl_paused', { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } }).catch(() => {}); }
async function alert(msg) { console.error(msg); if (ALERT) await fetch(ALERT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) }).catch(() => {}); }

// write score chunks via apply_perf under a cooperative crawl-pause + heartbeat.
async function writeUpdates(updates, manageFlag = true) {
  if (!updates.length) return { wrote: 0, fail: 0 };
  console.log(`[rollup] writing ${updates.length} scores @ +${((Date.now() - t0) / 1000) | 0}s`);
  let hb = null;
  if (manageFlag) { await setFlag(); hb = setInterval(() => setFlag().catch(() => {}), 60_000); await sleep(8000); }   // let writers notice the pause
  // CHUNK=800: at ~700K rows a 2000-row apply_perf UPDATE (heap + 4-5 indexes) now
  // exceeds Supabase's 8s REST statement timeout → times out + retries (~20s/chunk,
  // hours for a full write). 800 lands in ~3s with margin. (At multi-M scale this
  // needs a direct-PG path; the REST 8s cap is the ceiling.)
  const CHUNK = 800;
  // THROTTLE: sleep between write chunks so a FULL recalibration (2.3M rows) doesn't pin the DB.
  // This is the fix for the 3.7h CPU spike — it paces apply_perf so reads (the live feed + the
  // running backfills) keep their I/O. Set ROLLUP_THROTTLE_MS=300-600 when running the heavy
  // backfill alongside other load; 0 (default) preserves the original full-speed nightly behavior.
  // Default-on for FULL runs (300ms) so the AUTOMATIC weekly Sunday recalibration is throttled
  // too — not just manual runs. Incremental nightly stays 0 (it's tiny). Explicit env always wins
  // (set ROLLUP_THROTTLE_MS=0 to force full speed, or higher to go gentler).
  const THROTTLE_MS = Math.max(0, parseInt(process.env.ROLLUP_THROTTLE_MS ?? (FULL ? '300' : '0'), 10));
  let wrote = 0, fail = 0;
  try {
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK); let ok = false;
      for (let t = 0; t < 8 && !ok; t++) {
        const r = await fetch(REST + 'rpc/apply_perf', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: chunk }) });
        if (r.ok) { ok = true; wrote += chunk.length; } else { await r.text().catch(() => {}); if (t < 7) await sleep(1500 * (t + 1)); }
      }
      if (!ok) fail++;
      if (THROTTLE_MS) await sleep(THROTTLE_MS);   // pace the writes → no CPU spike
      if ((i / CHUNK) % 60 === 59) console.log(`[rollup] wrote ${wrote}/${updates.length} (fail ${fail}) @ +${((Date.now() - t0) / 1000) | 0}s`);   // heartbeat every ~48K
    }
  } finally { if (hb) { clearInterval(hb); await clearFlag(); } }
  return { wrote, fail };
}

// ── mode selection ─────────────────────────────────────────────────────────────
const cal = (await getJSON('discovery_rollup_calibration?id=eq.1&select=cutpoints,n,ran_at&limit=1'))[0] || null;
const status = (await getJSON('discovery_rollup_status?id=eq.1&select=ran_at&limit=1'))[0] || null;
const lastRan = status?.ran_at || '1970-01-01T00:00:00Z';
const calStale = !cal || !Array.isArray(cal.cutpoints) || !cal.cutpoints.length || (Date.now() - Date.parse(cal.ran_at) > 8 * 864e5);
// FULL when: forced, no/stale calibration, or it's Sunday (weekly recalibration) — unless --incremental forces incremental.
const FULL = ARG_FULL || calStale || (new Date().getUTCDay() === 0 && !ARG_INCR);

let rows, updates, mode, touchedBrands = 0, incrHb = null;

if (FULL) {
  // ── FULL weekly: recompute everything, calibrate, cache cutpoints ──
  mode = 'full';
  rows = await keyset('discovery_ads_index?select=' + SEL, 'full-fetch');
  const enriched = enrich(rows, aggregate(rows));
  const sorted = enriched.map(e => e.rawv).sort((a, b) => a - b), N = sorted.length || 1;
  const pctOf = v => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo / N; };
  updates = enriched.map(e => scoreOf(e, pctOf));
  // cache a compact quantile array (Q+1 points) so nightly can approximate pctOf
  const Q = 2048, cutpoints = [], last = Math.max(0, sorted.length - 1);
  for (let i = 0; i <= Q; i++) { const idx = Math.min(last, Math.round((i / Q) * last)); cutpoints.push(sorted[idx] ?? 0); }
  await fetch(REST + 'discovery_rollup_calibration?on_conflict=id', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, cutpoints, n: N, bp, ran_at: new Date().toISOString() }) }).catch(() => {});
} else {
  // ── INCREMENTAL nightly: re-score only touched brands using cached cutpoints ──
  mode = 'incremental';
  // Pause crawl+drain for the WHOLE incremental (it's short). Its small fetches are
  // unreliable under live DB load (503 → retry storms); a brief clean window makes
  // them fast + 503-free. 10-min TTL covers the run; if the process dies the flag
  // self-expires. The FULL run can't do this (its fetch is ~40min) so it only pauses
  // during the write and fetches-with-retry.
  await setFlag(5);
  incrHb = setInterval(() => setFlag(5).catch(() => {}), 60_000);   // heartbeat: keep the pause alive through a slow fetch (degraded DB); flag self-expires in 5min if this process dies
  await sleep(8000);   // let crawl+drain notice and back off before we fetch
  const cp = cal.cutpoints, Q = cp.length - 1;
  const pctOf = v => { let lo = 0, hi = cp.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cp[m] <= v) lo = m + 1; else hi = m; } return Math.min(1, lo / Q); };

  // (a) brands with NEW ads since last run (indexed_at is insert-only → clean watermark)
  const newAds = await keyset('discovery_ads_index?select=ad_id,page_id&indexed_at=gt.' + encodeURIComponent(lastRan), 'new-ads');
  const touched = new Set(newAds.map(r => r.page_id));
  // (b) tier-threshold crossers: an active ad crosses the 7/14d gate when realDays
  //     (≈ now − start_date) hits 7 or 14, i.e. it STARTED ~7 or ~14 days ago. So we
  //     only need active ads whose start_date is in the [now−16d, now−6d] window
  //     (covers both gates + margin) — a tiny, indexed slice, not all recent actives.
  const d6 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const d16 = new Date(Date.now() - 16 * 864e5).toISOString().slice(0, 10);
  const nearGate = await keyset(`discovery_ads_index?select=ad_id,page_id,start_date,stop_date,last_seen,days_running&is_active=is.true&start_date=gte.${d16}&start_date=lte.${d6}`, 'near-gate');
  const newAdBrands = touched.size;
  for (const a of nearGate) { const rd = realDays(a); const sd = a.days_running ?? 0; if ((rd >= 7 && sd < 7) || (rd >= 14 && sd < 14)) touched.add(a.page_id); }
  const crosserBrands = touched.size - newAdBrands;
  // (c) SELF-HEAL (bounded): re-score up to MAX_HEAL brands that still have score=0
  //     (= never-scored) ads. Drains a partial-fetch backlog gradually over nights
  //     instead of one big spike; the sentinel floor guarantees re-scored ads leave
  //     the set, so it converges to 0 and then costs nothing. Capped so the 04:15
  //     cron never balloons. Bounded single query (limit 3000), not a full scan.
  const MAX_HEAL = Number(process.env.ROLLUP_MAX_HEAL || 100);
  const zeroRows = await getJSON('discovery_ads_index?select=page_id&performance_score=eq.0&limit=3000');
  let healAdded = 0;
  for (const z of (Array.isArray(zeroRows) ? zeroRows : [])) { if (healAdded >= MAX_HEAL) break; if (z.page_id && !touched.has(z.page_id)) { touched.add(z.page_id); healAdded++; } }
  touchedBrands = touched.size;
  console.log(`[rollup] incremental: ${newAds.length} new / ${newAdBrands} brands + ${crosserBrands} crosser + ${healAdded} self-heal = ${touched.size} touched @ +${((Date.now() - t0) / 1000) | 0}s`);

  // fetch ALL ads of touched brands (chunk the page_id IN-list), re-aggregate per brand
  rows = [];
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 100) {
    const inList = ids.slice(i, i + 100).map(x => encodeURIComponent(x)).join(',');
    rows.push(...await keyset('discovery_ads_index?select=' + SEL + '&page_id=in.(' + inList + ')', 'brand-ads'));
  }
  updates = enrich(rows, aggregate(rows)).map(e => scoreOf(e, pctOf));
}

const tCompute = Date.now();
// FULL manages its own write-pause; INCREMENTAL already holds the pause (set above).
const { wrote, fail } = await writeUpdates(updates, FULL);
const tWrite = Date.now();

// niche_counts rebuild — FULL only (small drift between weekly runs is fine for filter chips)
if (mode === 'full') {
  const nc = new Map();
  for (const a of rows) { const key = a.niche || 'Other'; const e = nc.get(key) || { active: 0, total: 0 }; e.total++; if (a.is_active) e.active++; nc.set(key, e); }
  await fetch(REST + 'niche_counts?on_conflict=niche', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Array.from(nc).map(([niche, e]) => ({ niche, active_ads: e.active, total_ads: e.total, updated_at: new Date().toISOString() }))) }).catch(() => {});
}

// regression guard + status row (winners-under-14d is a corpus-wide invariant either mode)
const bad = await count('discovery_ads_index?select=ad_id&performance_tier=eq.winning&days_running=lt.14');
const winners = await count('discovery_ads_index?select=ad_id&performance_tier=eq.winning');
const scoreZero = await countPlanned('discovery_ads_index?select=ad_id&performance_score=eq.0');   // self-heal convergence gauge
const fetchS = +((tCompute - t0) / 1000).toFixed(1), writeS = +((tWrite - tCompute) / 1000).toFixed(1), totalS = +((Date.now() - t0) / 1000).toFixed(1);
console.log(`ROLLUP[${mode}] rows=${rows.length} touchedBrands=${touchedBrands} fetch+compute=${fetchS}s write=${writeS}s total=${totalS}s wrote=${wrote} failChunks=${fail} winners=${winners} winnersUnder14d=${bad} scoreZero=${scoreZero}`);

await fetch(REST + 'discovery_rollup_status?on_conflict=id', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, ran_at: new Date().toISOString(), total_rows: rows.length, winners, bad_winners: bad, fail_chunks: fail, wrote, fetch_s: fetchS, write_s: writeS, total_s: totalS }) }).catch(() => {});
// score_zero gauge — separate PATCH so it writes once migration 033 adds the column,
// without breaking the core status row before then (unknown-column 400 is swallowed).
await fetch(REST + 'discovery_rollup_status?id=eq.1', { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ score_zero: scoreZero }) }).catch(() => {});

if (fail > 0 || bad > 0) await alert(`🔴 Selfmade rollup[${mode}] REGRESSION: ${bad} winners under 14d, ${fail} failed chunks (wrote ${wrote}/${updates.length}).`);
if (!FULL) { if (incrHb) clearInterval(incrHb); await clearFlag(); }   // release the incremental's clean-window pause
process.exit(0);
