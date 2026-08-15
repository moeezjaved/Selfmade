/**
 * POST /api/channels/push  { type: 'report' | 'approval', taskId?, brand? }
 * Push a report (the morning brief) or a specific pending task to the founder's linked channels.
 * The trigger point — call it from the app to test, from the nightly cron to deliver, or from the
 * audit right after it suggests a task.
 *
 * Auth: cookie session (founder pushing to themselves), OR `Authorization: Bearer ${CRON_SECRET}`
 * with a `userId` in the body (server-to-server / cron delivering to any founder).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendApprovalToChannels, sendReportToChannels } from '@/lib/channels/send'
import { assembleBrief } from '@/lib/brief/assemble'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

function cronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const h = req.headers.get('authorization') || ''
  return h === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const admin = createAdminClient()

  // Resolve the target founder: cookie session, or cron + explicit userId.
  let userId: string | null = null
  let email: string | null = null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) { userId = user.id; email = user.email || null }
  else if (cronAuthed(req) && body.userId) {
    userId = String(body.userId)
    const { data } = await admin.auth.admin.getUserById(userId)
    email = data?.user?.email || null
  }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = body.type === 'approval' ? 'approval' : 'report'

  if (type === 'approval') {
    if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    const { data: task } = await admin.from('mello_tasks').select('*').eq('id', String(body.taskId)).eq('user_id', userId).maybeSingle()
    if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 })
    if (task.status !== 'suggested') return NextResponse.json({ error: `task is ${task.status}, not pending` }, { status: 409 })
    const r = await sendApprovalToChannels(admin, userId, task)
    return NextResponse.json({ ...r, delivered: r.sent > 0 })
  }

  // report — a SEPARATE brief per brand (each with its own brand header), matching the nightly cron.
  // Sending one combined message for all brands was the bug; only an explicit ?brand= stays single.
  const meta = { email, full_name: user?.user_metadata?.full_name }
  const explicitBrand = body.brand || null

  if (!explicitBrand) {
    const { data: brands } = await admin.from('brands').select('id, name').eq('user_id', userId).order('created_at', { ascending: true })
    const list = (brands || []) as any[]
    if (list.length > 1) {
      let sent = 0
      const results: any[] = []
      for (const b of list) {
        const brief = await assembleBrief(admin, userId, meta, { brandId: String(b.id) })
        const r = await sendReportToChannels(admin, userId, brief, { brandId: String(b.id), brandLabel: b.name })
        sent += r.sent || 0
        results.push({ brand: b.name, sent: r.sent })
      }
      return NextResponse.json({ sent, delivered: sent > 0, perBrand: results })
    }
  }

  // Single brand (explicit ?brand=) or a one-brand account → one message.
  const brandId = explicitBrand
  let brandLabel: string | undefined
  if (brandId) {
    const { data: b } = await admin.from('brands').select('name').eq('id', String(brandId)).eq('user_id', userId).maybeSingle()
    brandLabel = b?.name || undefined
  }
  const brief = await assembleBrief(admin, userId, meta, { brandId })
  const r = await sendReportToChannels(admin, userId, brief, { brandId, brandLabel })
  return NextResponse.json({ ...r, delivered: r.sent > 0, brandLabel: brandLabel || null })
}
