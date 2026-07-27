/**
 * POST /api/mello/tasks/run  { suggestion } | { id }
 * The one click that makes Mello WORK. Persists the task as 'running', executes the matching engine
 * (RESEARCH → competitor report), marks done/failed with the result, and emails the user when it lands.
 * This is what turns the CEO desk from analytics into decisions-acted-on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { authorCompetitorReport } from '@/lib/mello/tools'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const APP = (process.env.APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

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

  await admin.from('mello_tasks').update({ status: 'running', error: null, updated_at: new Date().toISOString() }).eq('id', task.id)

  // Execute by kind. Phase 1: RESEARCH → the flagship competitor report (reserves + charges credits).
  let result: any = null
  let failed: string | null = null
  try {
    if (task.kind === 'research') {
      const r = await authorCompetitorReport(user.id, task.evidence?.competitor || task.title, undefined)
      if (r?.error) failed = r.error === 'insufficient_credits' ? 'Not enough credits (50) for the report.' : (r.error || 'Report failed')
      else result = { docId: r.document_id, url: r.url, title: r.title, groundedOnAds: r.grounded_on_ads }
    } else {
      failed = `Task kind "${task.kind}" isn't runnable yet.`
    }
  } catch (e: any) { failed = String(e?.message || e).slice(0, 200) }

  if (failed) {
    await admin.from('mello_tasks').update({ status: 'failed', error: failed, updated_at: new Date().toISOString() }).eq('id', task.id)
    return NextResponse.json({ task: { ...task, status: 'failed', error: failed } })
  }

  await admin.from('mello_tasks').update({ status: 'done', result, updated_at: new Date().toISOString() }).eq('id', task.id)

  // Email the founder that Mello finished (proof of labor + a link straight to the work).
  if (user.email && result?.url) {
    const link = `${APP}${result.url}`
    sendEmail(user.email, `Mello finished: ${result.title || task.title}`,
      `<p>Done — I finished the task you kicked off:</p><p style="font-size:16px;font-weight:600">${result.title || task.title}</p>` +
      `<p><a href="${link}" style="background:#17251c;color:#dffe95;padding:11px 20px;border-radius:100px;text-decoration:none;font-weight:700">Open it →</a></p>` +
      `<p style="color:#68756b;font-size:13px">Grounded on ${result.groundedOnAds || 'real'} competitor ads.</p>`
    ).catch(() => {})
  }

  return NextResponse.json({ task: { ...task, status: 'done', result } })
}
