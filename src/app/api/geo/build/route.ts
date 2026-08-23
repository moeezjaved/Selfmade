/**
 * POST /api/geo/build  { kind: 'llms_txt' | 'schema' | 'fact_sheet' } → generate a crawlability/entity
 * asset (Phase C) as a draft in geo_assets. Copy-to-apply now; auto-apply to Shopify later. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { buildCrawlAsset, type CrawlKind } from '@/lib/geo/crawlability'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const KINDS: CrawlKind[] = ['llms_txt', 'schema', 'fact_sheet']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const kind = body?.kind as CrawlKind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  try {
    const asset = await buildCrawlAsset(admin as any, user.id, brandId, kind)
    return NextResponse.json({ asset }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_build_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
