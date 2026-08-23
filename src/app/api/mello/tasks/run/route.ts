/**
 * POST /api/mello/tasks/run  { suggestion } | { id }
 * The one click that makes Mello WORK. Persists the task as 'running', executes the matching engine,
 * marks done/failed with the result, and emails the user when it lands. This is what turns the CEO
 * desk from analytics into decisions-acted-on.
 *
 *   research → the flagship competitor report (authorCompetitorReport, charges credits)
 *   creative → clones the competitor's top image ad onto the user's product (clone-image, one image)
 *   video    → analyzes the competitor's top video into an editable STORYBOARD (free); the user
 *              approves the plan (and spends video credits) themselves — Mello never auto-burns them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runTask } from '@/lib/mello/run-task'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const cookie = req.headers.get('cookie') || ''   // forwarded so s2s gen calls run as this user

  const b = await req.json().catch(() => ({}))

  // Resolve to a persisted 'running' task row — from an existing id, or by persisting a suggestion.
  let task: any = null
  if (b?.id) {
    const { data } = await admin.from('mello_tasks').select('*').eq('id', String(b.id)).eq('user_id', user.id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (data.status === 'done') return NextResponse.json({ task: data })   // already done — no double-charge
    task = data
  } else if (b?.suggestion?.kind) {
    const s = b.suggestion
    // Dedupe: if this suggestion was already persisted (unique suggested_key), reuse it.
    if (s.suggested_key) {
      const { data: existing } = await admin.from('mello_tasks').select('*').eq('user_id', user.id).eq('suggested_key', s.suggested_key).maybeSingle()
      if (existing) { if (existing.status === 'done') return NextResponse.json({ task: existing }); task = existing }
    }
    if (!task) {
      const { data: ins, error } = await admin.from('mello_tasks').insert({
        user_id: user.id, brand_id: s.brand_id || null, kind: s.kind, title: s.title, why: s.why || null,
        evidence: s.evidence || {}, credits: s.credits ?? null, suggested_key: s.suggested_key || null, status: 'running',
      }).select('*').maybeSingle()
      if (error || !ins) return NextResponse.json({ error: error?.message || 'could not create task' }, { status: 500 })
      task = ins
    }
  } else {
    return NextResponse.json({ error: 'id or suggestion required' }, { status: 400 })
  }

  // Execute through the shared executor (same path Slack/WhatsApp approvals use — no drift).
  const updated = await runTask(admin, { userId: user.id, email: user.email, cookie, source: 'brief' }, task)
  // Log the approved move to the Wins Ledger (the revenue game's record).
  if ((updated as any)?.status === 'done') {
    try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin, { userId: user.id, brandId: (updated as any).brand_id || null, category: 'ads', title: (updated as any).title || 'Ran a move', detail: 'Approved & run', meta: { task_id: (updated as any).id } }) } catch { /* optional */ }
  }
  return NextResponse.json({ task: updated })
}
