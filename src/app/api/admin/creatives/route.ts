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
    .select('id, user_id, brand_id, source_ad_id, type, media_type, status, tier, image_url, prompt, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (type) q = q.eq('type', type)
  const { data: creatives } = await q
  const rows = creatives || []

  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)))
  const brandIds = Array.from(new Set(rows.map((r: any) => r.brand_id).filter(Boolean)))
  const [authUsers, { data: profiles }, { data: brands }] = await Promise.all([
    userIds.length ? getAuthUsers(admin) : Promise.resolve(new Map()),
    userIds.length ? admin.from('user_profiles').select('user_id, full_name').in('user_id', userIds) : Promise.resolve({ data: [] } as any),
    brandIds.length ? admin.from('brands').select('id, name').in('id', brandIds) : Promise.resolve({ data: [] } as any),
  ])
  const emailMap = Object.fromEntries(Array.from(authUsers.entries()).map(([id, u]: any) => [id, u.email]))
  const nameMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.full_name]))
  const brandMap = Object.fromEntries((brands || []).map((b: any) => [b.id, b.name]))

  const out = rows.map((r: any) => ({
    id: r.id, image_url: r.image_url, type: r.type, media_type: r.media_type || 'image', status: r.status || 'done',
    tier: r.tier, prompt: r.prompt, created_at: r.created_at,
    email: emailMap[r.user_id] || '', name: nameMap[r.user_id] || '', brand: r.brand_id ? brandMap[r.brand_id] || null : null,
  }))
  return NextResponse.json({ creatives: out, total: out.length })
}
