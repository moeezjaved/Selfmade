/**
 * Admin — all creatives users generate, with the user's email/name + brand. Admin-gated.
 * GET ?type=&limit= → recent generations across all users.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { getAuthUsers } from '@/lib/admin/users'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const type = request.nextUrl.searchParams.get('type')
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '300'), 500)

  let q = admin.from('creative_generations')
    .select('id, user_id, brand_id, source_ad_id, type, media_type, status, tier, image_url, prompt, created_at, featured_on_landing')
    .order('created_at', { ascending: false }).limit(limit)
  if (type) q = q.eq('type', type)
  const { data: creatives } = await q
  const rows = creatives || []

  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)))
  const brandIds = Array.from(new Set(rows.map((r: any) => r.brand_id).filter(Boolean)))
  const srcIds = Array.from(new Set(rows.map((r: any) => r.source_ad_id).filter(Boolean)))
  const [authUsers, { data: profiles }, { data: brands }, { data: srcCreatives }] = await Promise.all([
    userIds.length ? getAuthUsers(admin) : Promise.resolve(new Map()),
    userIds.length ? admin.from('user_profiles').select('user_id, full_name').in('user_id', userIds) : Promise.resolve({ data: [] } as any),
    brandIds.length ? admin.from('brands').select('id, name').in('id', brandIds) : Promise.resolve({ data: [] } as any),
    // Source ad each clone was made from → its R2 poster/image, so admins can see what it was cloned from.
    srcIds.length ? admin.from('discovery_creatives').select('ad_id, asset_type, r2_url, poster_url, position').in('ad_id', srcIds).order('position', { ascending: true }) : Promise.resolve({ data: [] } as any),
  ])
  const emailMap = Object.fromEntries(Array.from(authUsers.entries()).map(([id, u]: any) => [id, u.email]))
  const nameMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.full_name]))
  const brandMap = Object.fromEntries((brands || []).map((b: any) => [b.id, b.name]))
  const srcThumb = new Map<string, string>()
  for (const c of (srcCreatives || []) as any[]) {
    if (srcThumb.has(c.ad_id)) continue   // first (lowest-position) creative per source ad
    const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
    if (t) srcThumb.set(c.ad_id, t)
  }

  const out = rows.map((r: any) => ({
    id: r.id, image_url: r.image_url, type: r.type, media_type: r.media_type || 'image', status: r.status || 'done',
    tier: r.tier, prompt: r.prompt, created_at: r.created_at,
    email: emailMap[r.user_id] || '', name: nameMap[r.user_id] || '', brand: r.brand_id ? brandMap[r.brand_id] || null : null,
    source_ad_id: r.source_ad_id || null,
    source_thumb: r.source_ad_id ? srcThumb.get(r.source_ad_id) || null : null,
    featured: !!r.featured_on_landing,
  }))
  return NextResponse.json({ creatives: out, total: out.length })
}

/** Toggle whether a creative is featured on the public landing showcase. Admin-gated. */
export async function PATCH(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const featured = !!body.featured
  const admin = createAdminClient()
  // Cap the showcase so the landing can't accidentally balloon — only images/videos that finished.
  if (featured) {
    const { count } = await admin.from('creative_generations').select('id', { count: 'exact', head: true }).eq('featured_on_landing', true)
    if ((count ?? 0) >= 12) return NextResponse.json({ error: 'Showcase is full (max 12). Un-feature one first.' }, { status: 400 })
  }
  const { error } = await admin.from('creative_generations').update({ featured_on_landing: featured }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id, featured })
}
