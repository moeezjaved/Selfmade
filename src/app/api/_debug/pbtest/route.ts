// TEMP DEBUG — verify the cross-competitor playbook query. DELETE after diagnosis.
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauth' }, { status: 401 })
  const admin = createAdminClient()

  const follows = (await admin.from('followed_brands').select('page_id').eq('user_id', user.id).limit(200)).data || []
  const pageIds = follows.map((f: any) => f.page_id).filter(Boolean).slice(0, 60)

  const t0 = Date.now()
  const res = await admin.from('discovery_ads_index')
    .select('ad_id, page_id, hook_type, format_style, emotion, offer, title, body, caption')
    .in('page_id', pageIds).limit(400)
  const ms = Date.now() - t0

  return NextResponse.json({
    pageIdsCount: pageIds.length,
    samplePageIds: pageIds.slice(0, 5),
    queryMs: ms,
    error: res.error ? { message: res.error.message, code: (res.error as any).code, details: (res.error as any).details } : null,
    rowCount: res.data?.length ?? 0,
    firstRow: res.data?.[0] ? { page_id: res.data[0].page_id, hook_type: res.data[0].hook_type, format_style: res.data[0].format_style } : null,
  })
}
