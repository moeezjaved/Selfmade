/**
 * POST /api/seo/keywords → discover + cluster the real searches the brand's buyers type (SEO Phase 2).
 * GET → the stored keyword clusters. Brand-scoped. Metered (autocomplete + one LLM cluster call).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runKeywordResearch, loadKeywords } from '@/lib/seo/keywords'

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
  try { return NextResponse.json(await runKeywordResearch(admin as any, user.id, brandId), { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_keywords_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin as any, user.id).catch(() => null)
  try { return NextResponse.json(await loadKeywords(admin as any, user.id, brandId), { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_keywords_load_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}
