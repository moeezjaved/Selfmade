/**
 * POST /api/admin/seo/snapshot — capture today's Search Console rankings into seo_rank_history.
 * Run daily (cron) so /admin/seo can show rank MOVEMENT over time, not just a single 28-day snapshot.
 * Auth: admin session/token, OR a cron with header `x-cron-secret: $SEO_CRON_SECRET`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { gscQuery, gscProperty } from '@/lib/seo/gsc'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const secret = process.env.SEO_CRON_SECRET
  const cronOk = !!secret && req.headers.get('x-cron-secret') === secret
  if (!cronOk && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!gscProperty()) return NextResponse.json({ error: 'GSC not configured — set GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GSC_PROPERTY.' }, { status: 400 })

  // Rolling 7-day window (default) by query + page. Collapse to the best (most-impressions) page per query
  // so each keyword gets one row for today.
  const rows = await gscQuery({ dimensions: ['query', 'page'], rowLimit: 1000 })
  if (rows === null) return NextResponse.json({ error: 'Search Console query failed' }, { status: 502 })

  const byQuery = new Map<string, { page: string | null; position: number; clicks: number; impressions: number; ctr: number }>()
  for (const r of rows) {
    const q = r.keys?.[0]
    const pg = r.keys?.[1] || null
    if (!q) continue
    const cur = byQuery.get(q)
    if (!cur || (r.impressions || 0) > cur.impressions) {
      byQuery.set(q, { page: pg, position: r.position, clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0 })
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const records = Array.from(byQuery.entries()).map(([keyword, v]) => ({
    captured_on: today,
    keyword,
    page: v.page,
    position: Math.round(v.position * 100) / 100,
    clicks: Math.round(v.clicks),
    impressions: Math.round(v.impressions),
    ctr: Math.round(v.ctr * 10000) / 10000,
  }))

  if (records.length) {
    const admin = createAdminClient()
    const { error } = await admin.from('seo_rank_history').upsert(records, { onConflict: 'captured_on,keyword' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, captured_on: today, keywords: records.length })
}
