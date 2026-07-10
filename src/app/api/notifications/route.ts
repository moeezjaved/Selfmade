/**
 * In-app notifications (new-ad alerts on followed brands).
 * GET  /api/notifications              → { notifications: [...], unread }
 * POST /api/notifications { id? , action?:'mark_all_read' }  → mark one / all read
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

export const dynamic = 'force-dynamic'

const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { data } = await admin
    .from('notifications')
    .select('id, type, page_id, brand_name, ad_count, sample_ad_id, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // The alert-worker sometimes stores a page_id (or nothing) as brand_name. Resolve a real name
  // at read time so the bell shows "Country Delight" instead of "1544270769212882". Blank if unknown
  // (the UI falls back to "A brand you follow" rather than showing the raw id).
  const notifs = (data || []) as any[]
  const needIds = notifs.filter((n) => isBlankName(n.brand_name)).map((n) => n.page_id).filter(Boolean)
  if (needIds.length) {
    const names = await resolveBrandNames(admin, needIds)
    for (const n of notifs) {
      if (isBlankName(n.brand_name)) n.brand_name = names.get(String(n.page_id)) || null
    }
  }

  const { count: unread } = await admin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)

  return NextResponse.json({ notifications: notifs, unread: unread ?? 0 })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { id, action } = await req.json().catch(() => ({}))

  let q = admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id)
  if (action === 'mark_all_read') q = q.is('read_at', null)
  else if (id) q = q.eq('id', id)
  else return NextResponse.json({ error: 'id or action required' }, { status: 400 })
  await q
  return NextResponse.json({ ok: true })
}
