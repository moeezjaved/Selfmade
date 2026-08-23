/**
 * GET /api/mello/tasks/board  → the "standup" board: the founder's real tasks bucketed by status.
 *
 * To-do lives on the desk (the live Strategist plan), so this returns only the persisted lifecycle
 * buckets — running / done / failed — read straight from mello_tasks (the same rows the run spine writes).
 * Scoped to the active brand (strict, per the brand-isolation rule). READ-ONLY.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Row = { id: string; title: string; why: string | null; kind: string; status: string; url: string | null; error: string | null; at: string }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)

  const pull = async (status: string): Promise<Row[]> => {
    let q = admin.from('mello_tasks')
      .select('id, title, why, kind, status, result, error, created_at')
      .eq('user_id', user.id).eq('status', status)
      .order('created_at', { ascending: false }).limit(20)
    if (brandId) q = q.eq('brand_id', brandId)   // strict active-brand scope
    const { data } = await q
    return ((data || []) as any[]).map((t) => ({
      id: String(t.id), title: t.title, why: t.why || null, kind: t.kind, status: t.status,
      url: t?.result?.url || null, error: t.error || null, at: t.created_at,
    }))
  }

  try {
    const [running, done, failed] = await Promise.all([pull('running'), pull('done'), pull('failed')])
    return NextResponse.json({ running, done, failed })
  } catch (e) {
    return NextResponse.json({ error: 'board_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
