/**
 * Admin SEO metrics — our own coverage numbers + (if connected) live Google Search Console ranking
 * data. Powers /admin/seo.
 *
 * Our metrics come from the DB. Ranking data (clicks / impressions / avg position / top queries) comes
 * from the Search Console API via a service account — set GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, and
 * GSC_PROPERTY (e.g. "sc-domain:tryselfmade.ai") to enable it; until then that section shows setup steps.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_ADS = parseInt(process.env.SEO_MIN_ADS || '100', 10)

async function gscToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SA_EMAIL
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key) return null
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  try {
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
    })
    if (!r.ok) return null
    return (await r.json()).access_token || null
  } catch { return null }
}

async function fetchGSC() {
  const property = process.env.GSC_PROPERTY
  const token = await gscToken()
  if (!token || !property) return { configured: false as const }
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10)
  const call = (body: any) =>
    fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, ...body }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const [totals, byDate, topQueries, topPages] = await Promise.all([
    call({ dimensions: [] }),
    call({ dimensions: ['date'] }),
    call({ dimensions: ['query'], rowLimit: 25 }),
    call({ dimensions: ['page'], rowLimit: 25 }),
  ])
  return {
    configured: true as const, range: { start, end },
    totals: totals?.rows?.[0] || null,
    byDate: byDate?.rows || [],
    topQueries: topQueries?.rows || [],
    topPages: topPages?.rows || [],
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const cnt = async (min: number, max?: number) => {
    let q = admin.from('discovery_brand_crawl_state').select('*', { count: 'exact', head: true }).gte('ads_indexed', min)
    if (max != null) q = q.lt('ads_indexed', max)
    const { count } = await q
    return count ?? 0
  }
  const [eligible, generated, b100, b500, b1000] = await Promise.all([
    cnt(MIN_ADS),
    admin.from('brand_seo_content').select('*', { count: 'exact', head: true }).then((r: any) => r.count ?? 0).catch(() => 0),
    cnt(100, 500), cnt(500, 1000), cnt(1000),
  ])
  const gsc = await fetchGSC().catch(() => ({ configured: false as const }))

  // Rank movement over time — from the seo_rank_history snapshots (populated by the daily snapshot cron).
  // For each tracked keyword we return its latest position, the delta vs its earliest capture in the
  // window (positive delta = position number went DOWN = ranking improved), and the raw position series
  // for a sparkline. Sorted best-position first, capped at 40.
  let rank_history: any = { tracked: 0, has_data: false, movers: [] as any[] }
  try {
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)
    const { data: hist } = await admin.from('seo_rank_history')
      .select('captured_on, keyword, page, position, clicks, impressions')
      .gte('captured_on', since).order('captured_on', { ascending: true })
    type Pt = { p: number; clicks: number; impr: number }
    type Ser = { page: string | null; pts: Pt[] }
    const series = new Map<string, Ser>()
    for (const h of (hist || []) as any[]) {
      const s: Ser = series.get(h.keyword) || { page: h.page ?? null, pts: [] }
      s.page = h.page || s.page
      s.pts.push({ p: Number(h.position), clicks: h.clicks, impr: h.impressions })
      series.set(h.keyword, s)
    }
    const movers = Array.from(series.entries()).map(([keyword, s]) => {
      const first = s.pts[0], last = s.pts[s.pts.length - 1]
      return {
        keyword, page: s.page, position: last.p,
        delta: first ? Math.round((first.p - last.p) * 100) / 100 : 0,
        clicks: last.clicks, impressions: last.impr,
        points: s.pts.map((p: Pt) => p.p), captures: s.pts.length,
      }
    }).sort((a, b) => a.position - b.position).slice(0, 40)
    rank_history = { tracked: series.size, has_data: (hist || []).length > 0, movers }
  } catch { /* table not migrated yet → empty */ }

  return NextResponse.json({
    min_ads: MIN_ADS,
    coverage: {
      eligible_brands: eligible,
      content_generated: generated,
      content_pct: eligible ? Math.round((generated / eligible) * 1000) / 10 : 0,
      buckets: { '100-499': b100, '500-999': b500, '1000+': b1000 },
    },
    sitemap_url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')}/sitemap.xml`,
    gsc,
    rank_history,
  })
}
