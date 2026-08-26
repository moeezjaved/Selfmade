/**
 * GET /api/admin/ads-audit?page_id=… — the full ads audit for one lead (admin only). If the stored
 * audit is still "building" (the brand's ads weren't crawled yet when they ran it), we RE-RUN it now —
 * by the time the founder looks, the priority crawl has usually finished, so this returns the REAL audit
 * on the REAL crawled ads (and /api/scan/run's own hook updates the lead). We never fabricate a score.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = (request.nextUrl.searchParams.get('page_id') || '').trim()
  if (!pageId) return NextResponse.json({ error: 'Missing page_id' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('ads_audit_scans').select('result, score, brand_name').eq('page_id', pageId).maybeSingle()
  const stored: any = (row as any)?.result || null

  // Real audit already on file → return it.
  if (stored && !stored.building) return NextResponse.json({ result: stored, completed: false })

  // Still building → re-run the SAME public audit (reuses all the resolve/crawl/DNA logic). Its hook
  // upserts the lead with the fresh result, so the admin lead self-heals once the crawl has landed.
  try {
    const r = await fetch(`${request.nextUrl.origin}/api/scan/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId }),
    })
    const fresh = await r.json().catch(() => null)
    return NextResponse.json({ result: fresh || stored, completed: !!(fresh && !fresh.building) })
  } catch {
    return NextResponse.json({ result: stored, completed: false })
  }
}
