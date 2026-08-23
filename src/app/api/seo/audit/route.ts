/**
 * POST /api/seo/audit → crawl the brand's site + report technical SEO issues (SEO Phase 1). Metered (a few
 * page fetches). GET → the latest audit snapshot (cheap). Brand-scoped, read-only beyond storing the audit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runSeoAudit, loadSeoAudit } from '@/lib/seo/crawl-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  try {
    const audit = await runSeoAudit(admin as any, user.id, brandId)
    return NextResponse.json(audit, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'seo_audit_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin as any, user.id).catch(() => null)
  try {
    const audit = await loadSeoAudit(admin as any, user.id, brandId)
    return NextResponse.json(audit, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'seo_audit_load_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
