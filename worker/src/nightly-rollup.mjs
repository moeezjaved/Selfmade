/**
 * Nightly rollup — runs ON THE DROPLET (no Vercel 300s limit; the fetch alone is
 * ~160s at 120K rows and grows). Recomputes days_running + Winner Score, writes via
 * set-based apply_perf, under a cooperative crawl-pause with a HEARTBEAT (re-leases
 * the flag every 60s so it survives a multi-minute write but still auto-expires in
 * 5min if this process dies). Regression guard PUSHES to ALERT_WEBHOOK_URL on failure.
 *
 * Run: docker exec worker node /app/scripts/nightly-rollup.mjs   (via rollup-cron.sh)
 */
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, Authorization: 'Bearer ' + K };
const ALERT = process.env.ALERT_WEBHOOK_URL || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();

async function setFlag() {
  await fetch(U + '/rest/v1/system_flags?on_conflict=key', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key: 'crawl_paused', until: new Date(Date.now() + 5 * 60_000).toISOString(), updated_at: new Date().toISOString() }) });
}
async function clearFlag() { await fetch(U + '/rest/v1/system_flags?key=eq.crawl_paused', { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } }).catch(() => {}); }
async function alert(msg) { console.error(msg); if (ALERT) await fetch(ALERT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) }).catch(() => {}); }

// 1. fetch
const rows = []; let cursor = '';
while (true) { let q = U + '/rest/v1/discovery_ads_index?select=ad_id,page_id,image_hash,video_hash,is_active,start_date,stop_date,last_seen,niche&order=ad_id.asc&limit=1000'; if (cursor) q += '&ad_id=gt.' + encodeURIComponent(cursor); const d = await (await fetch(q, { headers: H })).json(); if (!Array.isArray(d) || !d.length) break; rows.push(...d); cursor = d[d.length - 1].ad_id; if (d.length < 1000) break; }

// 2-4. aggregates + score (Winner Score v3: longevity + reuse + brand vol + velocity, ageFactor, hard gate)
const reuse = new Map(), brandActive = new Map(), brandNew = new Map(), since = Date.now() - 21 * 864e5;
const realDays = a => { const end = a.stop_date ? Date.parse(a.stop_date) : (a.last_seen ? Date.parse(a.last_seen) : Date.now()); const start = a.start_date ? Date.parse(a.start_date) : end; let d = Math.floor((end - start) / 864e5); if (!Number.isFinite(d) || d < 0) d = 0; if (d > 3650) d = 3650; return d; };
for (const a of rows) { const ck = a.image_hash || a.video_hash; if (ck) { const k = a.page_id + '|' + ck; reuse.set(k, (reuse.get(k) || 0) + 1); } if (a.is_active) brandActive.set(a.page_id, (brandActive.get(a.page_id) || 0) + 1); const sd = a.start_date ? Date.parse(a.start_date) : NaN; if (!Number.isNaN(sd) && sd >= since) brandNew.set(a.page_id, (brandNew.get(a.page_id) || 0) + 1); }
const LN91 = Math.log(91);
const enriched = rows.map(a => { const ck = a.image_hash || a.video_hash; const rc = ck ? (reuse.get(a.page_id + '|' + ck) || 0) : 0; const bv = brandActive.get(a.page_id) || 0; const bn = brandNew.get(a.page_id) || 0; const days = realDays(a); const rt = Math.min(1, Math.log(1 + days) / LN91); const af = Math.min(1, days / 21); let rawv = (0.40 * rt + 0.25 * Math.min(1, rc / 6) + 0.20 * Math.min(1, bv / 30) + 0.15 * Math.min(1, bn / 12)) * af * (a.is_active ? 1 : 0.6); rawv += days * 1e-7; return { ad_id: a.ad_id, rc, bv, days, rawv }; });
const sorted = enriched.map(e => e.rawv).sort((a, b) => a - b), N = sorted.length || 1;
const pctOf = v => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo / N; };
const bp = [[0, 0], [.25, .2], [.55, .4], [.8, .6], [.95, .8], [1, 1]];
const mapP = p => { for (let i = 1; i < bp.length; i++) if (p <= bp[i][0]) { const [p0, s0] = bp[i - 1], [p1, s1] = bp[i]; return s0 + (s1 - s0) * (p - p0) / (p1 - p0 || 1); } return 1; };
const updates = enriched.map(e => { let s = mapP(pctOf(e.rawv)); if (e.days < 7) s = Math.min(s, .599); else if (e.days < 14) s = Math.min(s, .799); return { aid: e.ad_id, ps: Math.round(s * 1000) / 1000, dr: e.days, rc: e.rc, bv: e.bv }; });
const tCompute = Date.now();

// 5. write under cooperative pause + HEARTBEAT
await setFlag();
const hb = setInterval(setFlag, 60_000);   // re-lease every 60s so the flag survives a multi-minute write
await sleep(8000);                          // let writers notice + pause
let wrote = 0, fail = 0;
try {
  for (let i = 0; i < updates.length; i += 2000) {
    const chunk = updates.slice(i, i + 2000); let ok = false;
    for (let t = 0; t < 8 && !ok; t++) { const r = await fetch(U + '/rest/v1/rpc/apply_perf', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: chunk }) }); if (r.ok) { ok = true; wrote += chunk.length; } else { await r.text().catch(() => {}); if (t < 7) await sleep(1500 * (t + 1)); } }
    if (!ok) fail++;
  }
} finally { clearInterval(hb); await clearFlag(); }
const tWrite = Date.now();

// 6. niche_counts
const nc = new Map(); for (const a of rows) { const key = a.niche || 'Other'; const e = nc.get(key) || { active: 0, total: 0 }; e.total++; if (a.is_active) e.active++; nc.set(key, e); }
await fetch(U + '/rest/v1/niche_counts?on_conflict=niche', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Array.from(nc).map(([niche, e]) => ({ niche, active_ads: e.active, total_ads: e.total, updated_at: new Date().toISOString() }))) }).catch(() => {});

// 7. regression guard → PUSH alert + PULL status row (rendered on /admin/health)
const count = async qs => { const r = await fetch(U + '/rest/v1/discovery_ads_index?' + qs, { headers: { ...H, Range: '0-0', Prefer: 'count=exact' } }); return +((r.headers.get('content-range') || '').split('/')[1] || 0); };
const bad = await count('select=ad_id&performance_tier=eq.winning&days_running=lt.14');
const winners = await count('select=ad_id&performance_tier=eq.winning');
const fetchS = +((tCompute - t0) / 1000).toFixed(1), writeS = +((tWrite - tCompute) / 1000).toFixed(1), totalS = +((Date.now() - t0) / 1000).toFixed(1);
console.log(`ROLLUP rows=${rows.length} fetch+compute=${fetchS}s write=${writeS}s total=${totalS}s wrote=${wrote} failChunks=${fail} winners=${winners} winnersUnder14d=${bad}`);

// PULL: persist a single status row so the admin panel can show "ran, and was it clean?"
await fetch(U + '/rest/v1/discovery_rollup_status?on_conflict=id', {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ id: 1, ran_at: new Date().toISOString(), total_rows: rows.length, winners, bad_winners: bad, fail_chunks: fail, wrote, fetch_s: fetchS, write_s: writeS, total_s: totalS }),
}).catch(() => {});

// PUSH (optional): only fires if ALERT_WEBHOOK_URL is set
if (fail > 0 || bad > 0) await alert(`🔴 Selfmade nightly rollup REGRESSION: ${bad} winners under 14 days, ${fail} failed chunks (wrote ${wrote}/${updates.length}). days_running may be stale.`);
process.exit(0);
