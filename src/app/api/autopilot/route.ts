/**
 * Daily Ad Autopilot enrollments (user-facing).
 *   GET    /api/autopilot                → { items: [{ id, brand_id, brand_name, source_ad_id, media_type, active, runs, last_sent_at }] }
 *   POST   /api/autopilot { brandId?, sourceAdId?, mediaType?, settings? }  → enroll (reactivates if exists)
 *   DELETE /api/autopilot?id=<id>        → turn OFF (soft; sets active=false, never hard-deletes)
 *
 * The autopilot-worker (cron) reads active rows and generates+emails one fresh ad per day, charged
 * per generation (same price as a manual clone). Uncapped until the user turns it off.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin
    .from('ad_autopilot')
    .select('id, brand_id, source_ad_id, media_type, active, runs, last_sent_at, brands(name)')
    .eq('user_id', user.id).eq('active', true)
    .order('created_at', { ascending: false })
  const items = (data || []).map((r: any) => ({
    id: r.id, brand_id: r.brand_id, brand_name: r.brands?.name || null,
    source_ad_id: r.source_ad_id, media_type: r.media_type, active: r.active,
    runs: r.runs, last_sent_at: r.last_sent_at,
  }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  // Same server-to-server path as clone-image: the autopilot worker / admin tooling may enroll on a
  // user's behalf with the shared secret. Otherwise the caller's session owns the enrollment.
  const secret = req.headers.get('x-autopilot-secret')
  const isService = !!secret && !!process.env.AUTOPILOT_SECRET && secret === process.env.AUTOPILOT_SECRET
  let userId: string
  if (isService && typeof body.asUserId === 'string' && body.asUserId) {
    userId = body.asUserId
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = user.id
  }

  const mediaType = body.mediaType === 'video' ? 'video' : 'image'
  const brandId = typeof body.brandId === 'string' && body.brandId ? body.brandId : null
  const sourceAdId = typeof body.sourceAdId === 'string' && body.sourceAdId ? body.sourceAdId : null
  if (!brandId) return NextResponse.json({ error: 'brandId required — save a brand to run autopilot' }, { status: 400 })

  const settings = (body.settings && typeof body.settings === 'object') ? body.settings : {}
  const admin = createAdminClient()

  // Upsert on the unique (user, brand, source ad, media) — re-enrolling flips active back on.
  const { data, error } = await admin
    .from('ad_autopilot')
    .upsert({
      user_id: userId, brand_id: brandId, source_ad_id: sourceAdId, media_type: mediaType,
      settings, active: true,
    }, { onConflict: 'user_id,brand_id,source_ad_id,media_type' })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: 'could not turn on autopilot' }, { status: 500 })
  return NextResponse.json({ id: (data as any).id, active: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  // Soft off — keep the row so re-enrolling remembers settings (never hard-delete).
  await admin.from('ad_autopilot').update({ active: false }).eq('id', id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
