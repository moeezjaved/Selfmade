/**
 * POST /api/geo/answer  { prompt, rivals? } → the Content agent writes a GEO answer page for one buyer
 * question the brand is missing, and stores it as a DRAFT (geo_assets). Review/edit before publishing;
 * publishing to the Shopify blog is a later step (needs OAuth). Metered (one LLM write). Brand-scoped.
 *
 * GET /api/geo/answer → list the brand's answer-page drafts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { writeAnswerPage, listAnswerPages } from '@/lib/geo/content'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const prompt = String(body?.prompt || '').trim()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  try {
    const asset = await writeAnswerPage(admin as any, user.id, brandId, { prompt, rivals: Array.isArray(body?.rivals) ? body.rivals : undefined })
    return NextResponse.json({ asset }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_answer_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin as any, user.id).catch(() => null)
  try {
    const assets = await listAnswerPages(admin as any, user.id, brandId)
    return NextResponse.json({ assets }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_assets_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
