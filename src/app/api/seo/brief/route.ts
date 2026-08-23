/**
 * POST /api/seo/brief { keyword } → write a content brief an SEO writer can execute for that keyword.
 * GET → the brand's briefs. Draft-first (stored in seo_pages kind 'brief'). Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { generateBrief, listBriefs } from '@/lib/seo/keywords'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const keyword = String(body?.keyword || '').trim()
  if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 })
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  try { return NextResponse.json({ brief: await generateBrief(admin as any, user.id, brandId, keyword) }, { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_brief_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin as any, user.id).catch(() => null)
  try { return NextResponse.json({ briefs: await listBriefs(admin as any, user.id, brandId) }, { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_briefs_load_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}
