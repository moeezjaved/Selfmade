/**
 * GET /api/cron/rollup → nightly discovery rollup (Vercel cron 04:15 + manual).
 *
 * Computes creative_reuse_count, brand_active_ads, performance_score/tier, niche,
 * and niche_counts entirely in Node, writing back via batched upserts. We do NOT
 * use the SQL discovery_rollup() rpc: a full-table multi-UPDATE blows Supabase's
 * 8s REST statement timeout, and batched writes (each <8s) sidestep it cleanly.
 *
 * performance_score is PERCENTILE-CALIBRATED: a raw composite (runtime + creative
 * reuse + brand volume, inactive-penalised) is rank-mapped so the fixed tier
 * thresholds land on a healthy spread (~5-10% winning). The mapping is monotonic
 * in the raw composite, so the "Performance" sort order == the raw heuristic order.
 *
 * Auth mirrors /api/indexer: ?secret=<CRON_SECRET> | Bearer <CRON_SECRET> | any
 * authenticated Supabase user.
 *
 * Scale note: at ~hundreds of thousands of rows this still fits Vercel's 300s, but
 * beyond that move it to the droplet worker (direct PG / no function timeout).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// NOTE: `niche` is owned by the brand-level AI classifier (worker niche-classify,
// 33-niche GetHookd taxonomy) — the rollup no longer derives it from industries and
// must NOT overwrite it. The rollup only READS niche to rebuild niche_counts.

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }
  return false
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const started = Date.now()

  // 1. fetch — KEYSET on ad_id (stable while the crawler inserts concurrently;
  //    offset pagination silently skips rows under concurrent writes).
  type Row = { ad_id: string; page_id: string; image_hash: string | null; video_hash: string | null; is_active: boolean; days_running: number | null; niche: string | null; start_date: string | null }
  const rows: Row[] = []
  let cursor = ''
  for (;;) {
    let q = admin.from('discovery_ads_index')
      .select('ad_id,page_id,image_hash,video_hash,is_active,days_running,niche,start_date')
      .order('ad_id', { ascending: true }).limit(1000)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: false, step: 'fetch', error: error.message }, { status: 500 })
    if (!data || !data.length) break
    rows.push(...(data as Row[]))
    cursor = (data[data.length - 1] as Row).ad_id
    if (data.length < 1000) break
  }

  // 2. aggregates — reuse, brand active volume, and SCALING VELOCITY (Winner Score v2):
  //    how many NEW creatives the brand launched in the last 21 days. A brand actively
  //    ramping a creative = a stronger winner signal than raw size alone.
  const reuse = new Map<string, number>(), brandActive = new Map<string, number>(), brandNew = new Map<string, number>()
  const since = Date.now() - 21 * 86400000
  for (const a of rows) {
    const ck = a.image_hash || a.video_hash
    if (ck) { const k = a.page_id + '|' + ck; reuse.set(k, (reuse.get(k) || 0) + 1) }
    if (a.is_active) brandActive.set(a.page_id, (brandActive.get(a.page_id) || 0) + 1)
    const sd = a.start_date ? Date.parse(a.start_date) : NaN
    if (!Number.isNaN(sd) && sd >= since) brandNew.set(a.page_id, (brandNew.get(a.page_id) || 0) + 1)
  }

  // 3. raw composite — Winner Score v2:
  //    0.35 longevity + 0.25 reuse + 0.20 brand commitment + 0.20 scaling velocity,
  //    × inactive penalty. Caps: 90d / 6 reuses / 30 active / 12 new-in-21d.
  const LN91 = Math.log(91)
  const enriched = rows.map(a => {
    const ck = a.image_hash || a.video_hash
    const rc = ck ? (reuse.get(a.page_id + '|' + ck) || 0) : 0
    const bv = brandActive.get(a.page_id) || 0
    const bn = brandNew.get(a.page_id) || 0
    const rt = Math.min(1, Math.log(1 + Math.max(0, a.days_running || 0)) / LN91)
    let rawv = (0.35 * rt + 0.25 * Math.min(1, rc / 6) + 0.20 * Math.min(1, bv / 30) + 0.20 * Math.min(1, bn / 12)) * (a.is_active ? 1 : 0.6)
    rawv += Math.max(0, a.days_running || 0) * 1e-7
    return { ad_id: a.ad_id, page_id: a.page_id, creative_reuse_count: rc, brand_active_ads: bv, rawv }
  })

  // 4. percentile map → score (breakpoints → ~5% win / 15% opt / 25% grow / 30% scale / 25% test)
  const sorted = enriched.map(e => e.rawv).sort((a, b) => a - b)
  const N = sorted.length || 1
  const pctOf = (v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m } return lo / N }
  const bp: [number, number][] = [[0, 0], [0.25, 0.2], [0.55, 0.4], [0.80, 0.6], [0.95, 0.8], [1.0, 1.0]]
  const mapP = (p: number) => { for (let i = 1; i < bp.length; i++) if (p <= bp[i][0]) { const [p0, s0] = bp[i - 1], [p1, s1] = bp[i]; return s0 + (s1 - s0) * (p - p0) / (p1 - p0 || 1) } return 1 }

  // niche is intentionally NOT written here — it's owned by the AI niche classifier.
  const updates = enriched.map(e => ({
    ad_id: e.ad_id, page_id: e.page_id, creative_reuse_count: e.creative_reuse_count,
    brand_active_ads: e.brand_active_ads,
    performance_score: Math.round(mapP(pctOf(e.rawv)) * 1000) / 1000,
  }))

  // 5. write back — batched upsert (each well under the 8s cap)
  let wrote = 0
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500)
    const { error } = await admin.from('discovery_ads_index').upsert(batch, { onConflict: 'ad_id' })
    if (error) return NextResponse.json({ ok: false, step: 'write', wrote, error: error.message }, { status: 500 })
    wrote += batch.length
  }

  // 6. niche_counts rebuild — from the stored (AI-classified) niche column
  const nc = new Map<string, { active: number; total: number }>()
  for (const a of rows) { const key = a.niche || 'Other'; const cur = nc.get(key) || { active: 0, total: 0 }; cur.total++; if (a.is_active) cur.active++; nc.set(key, cur) }
  const ncRows = Array.from(nc).map(([niche, e]) => ({ niche, active_ads: e.active, total_ads: e.total, updated_at: new Date().toISOString() }))
  if (ncRows.length) await admin.from('niche_counts').upsert(ncRows, { onConflict: 'niche' })

  return NextResponse.json({ ok: true, rows: rows.length, wrote, niches: ncRows.length, duration_ms: Date.now() - started })
}
