/**
 * GET /api/admin/audit-scan?domain=… — the full stored audit for one domain (admin only). Fetched
 * on-demand when the founder expands an anonymous lead on the funnel page, so the funnel list stays light.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const domain = (request.nextUrl.searchParams.get('domain') || '').trim().toLowerCase()
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })
  const admin = createAdminClient()
  const { data } = await admin.from('audit_scans').select('result').eq('domain', domain).maybeSingle()
  return NextResponse.json({ result: (data as any)?.result || null })
}
