/**
 * Followed brands.
 * GET  /api/follows               → { pageIds: [...], brands: [{page_id, brand_name}] }
 * POST /api/follows { pageId, brandName?, action?:'toggle'|'follow'|'unfollow' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('followed_brands').select('page_id, brand_name, email_alerts, spied, brand_id').eq('user_id', user.id)
  const brands = (data || []) as any[]
  return NextResponse.json({ pageIds: brands.map(b => b.page_id), brands })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { pageId, brandName, action = 'toggle', email_alerts, brandId } = await req.json()
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // brand_id (migration 117) attaches a competitor to ONE of the user's brands. Nullable — omit it
  // and the follow stays account-level, exactly as before.
  const brand_id = brandId ? String(brandId) : null

  const { data: existing } = await admin
    .from('followed_brands').select('id, brand_id').eq('user_id', user.id).eq('page_id', String(pageId)).maybeSingle()
  const isFollowing = !!existing

  // Set per-brand email alerts (opt-in, 2 credits per email). Follows the brand if not already, so the
  // toggle can be flipped straight from the Brand Spy view.
  if (action === 'set_email') {
    // Enabling alerts from the Brand Spy view implies a spy (spied=true), per the "turning them on auto-spies too" rule.
    if (!isFollowing) await admin.from('followed_brands').insert({ user_id: user.id, page_id: String(pageId), brand_name: brandName || null, email_alerts: !!email_alerts, spied: true, brand_id })
    else await admin.from('followed_brands').update({ email_alerts: !!email_alerts }).eq('user_id', user.id).eq('page_id', String(pageId))
    return NextResponse.json({ following: true, email_alerts: !!email_alerts })
  }

  let following: boolean
  if (action === 'follow' || (action === 'toggle' && !isFollowing)) {
    if (!isFollowing) {
      await admin.from('followed_brands').insert({ user_id: user.id, page_id: String(pageId), brand_name: brandName || null, email_alerts: !!email_alerts, brand_id })
    } else if (brand_id && !(existing as any).brand_id) {
      // Already following (e.g. added account-level in onboarding), and now assigned to a brand via
      // "Watch competitors". Attach it. Only when currently unassigned — first-assignment wins, so we
      // never silently move a rival off a brand it's already tied to (the single-row limit; migration
      // 117 header). This is the common path: every legacy follow starts NULL.
      await admin.from('followed_brands').update({ brand_id }).eq('user_id', user.id).eq('page_id', String(pageId))
    }
    following = true
  } else {
    if (isFollowing) await admin.from('followed_brands').delete().eq('user_id', user.id).eq('page_id', String(pageId))
    following = false
  }
  return NextResponse.json({ following })
}
