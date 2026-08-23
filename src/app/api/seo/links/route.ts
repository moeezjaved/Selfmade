/**
 * POST /api/seo/links → suggest the highest-value internal links the site is missing (free, from the crawl).
 * Brand-scoped, read-only. Metered (crawl + one LLM call).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { suggestInternalLinks } from '@/lib/seo/internal-links'

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
  try { return NextResponse.json(await suggestInternalLinks(admin as any, user.id, brandId), { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_links_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}
