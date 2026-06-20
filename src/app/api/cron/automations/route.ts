/**
 * GET /api/cron/automations → run all due Mello automations.
 *
 * Wire this to a scheduler (Vercel cron every ~15 min, or the droplet). For each
 * automation where next_run_at <= now and is_active, it runs the agent
 * non-streaming, saves the result as a conversation (channel='automation'), records
 * an automation_run, and advances next_run_at. delivery_channel is 'in_app' for now
 * (the result lives in the user's Mello history); Slack/email delivery is deferred.
 *
 * Auth mirrors /api/cron/rollup: ?secret=<CRON_SECRET> | Bearer <CRON_SECRET> | any
 * authenticated user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runAgentToText } from '@/lib/mello/agent'
import { nextRun } from '@/lib/mello/cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }
  return false
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data: due } = await admin
    .from('agent_automations')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(25)

  const results: any[] = []

  for (const auto of (due || [])) {
    const startedAt = new Date().toISOString()
    // Advance the schedule first so a slow/failing run can't double-fire.
    const next = nextRun(auto.schedule_cron, new Date())
    await admin.from('agent_automations').update({
      last_run_at: startedAt,
      next_run_at: next ? next.toISOString() : null,
      is_active: next ? auto.is_active : false,
    }).eq('id', auto.id)

    // Create a conversation to hold the output.
    const { data: conv } = await admin.from('agent_conversations').insert({
      user_id: auto.user_id,
      title: auto.name,
      channel: 'automation',
      status: 'active',
      automation_id: auto.id,
    }).select('id').single()

    let status = 'success'
    let errorMessage: string | null = null
    try {
      await admin.from('agent_messages').insert({
        conversation_id: conv!.id, role: 'user', content: auto.prompt,
      })
      const result = await runAgentToText(auto.user_id, auto.prompt)
      await admin.from('agent_messages').insert({
        conversation_id: conv!.id,
        role: 'assistant',
        content: result.text || '',
        tool_calls: result.toolCalls.length ? result.toolCalls : null,
      })
    } catch (err: any) {
      status = 'error'
      errorMessage = err?.message || 'run failed'
    }

    await admin.from('automation_runs').insert({
      automation_id: auto.id,
      conversation_id: conv?.id || null,
      status,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })

    results.push({ automation_id: auto.id, name: auto.name, status, conversation_id: conv?.id })
  }

  return NextResponse.json({ ran: results.length, results })
}
