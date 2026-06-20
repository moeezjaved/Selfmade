import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { nextRun } from '@/lib/mello/cron'
import { AUTOMATION_TEMPLATES } from '@/lib/mello/templates'

export const dynamic = 'force-dynamic'

// GET /api/mello/automations
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('agent_automations')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ automations: data || [], templates: AUTOMATION_TEMPLATES })
}

// POST /api/mello/automations  { name, prompt, schedule_cron, schedule_label?, delivery_channel? }
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const name = (b?.name || '').toString().trim()
  const prompt = (b?.prompt || '').toString().trim()
  const schedule_cron = (b?.schedule_cron || '').toString().trim()
  if (!name || !prompt || !schedule_cron) {
    return NextResponse.json({ error: 'name, prompt and schedule_cron are required' }, { status: 400 })
  }
  const next = nextRun(schedule_cron)
  if (!next) return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_automations').insert({
    user_id: user.id,
    name,
    prompt,
    schedule_cron,
    schedule_label: b?.schedule_label || null,
    delivery_channel: b?.delivery_channel || 'in_app',
    is_active: true,
    next_run_at: next.toISOString(),
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ automation: data })
}
