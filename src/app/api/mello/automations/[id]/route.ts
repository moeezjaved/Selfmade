import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { nextRun } from '@/lib/mello/cron'

export const dynamic = 'force-dynamic'

// PATCH /api/mello/automations/:id  — update name/prompt/schedule/active
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('agent_automations').select('user_id').eq('id', params.id).single()
  if (!existing || existing.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const b = await request.json().catch(() => ({}))
  const update: Record<string, any> = {}
  if (typeof b.name === 'string') update.name = b.name
  if (typeof b.prompt === 'string') update.prompt = b.prompt
  if (typeof b.schedule_label === 'string') update.schedule_label = b.schedule_label
  if (typeof b.delivery_channel === 'string') update.delivery_channel = b.delivery_channel
  if (typeof b.is_active === 'boolean') update.is_active = b.is_active
  if (typeof b.schedule_cron === 'string' && b.schedule_cron.trim()) {
    const next = nextRun(b.schedule_cron)
    if (!next) return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 })
    update.schedule_cron = b.schedule_cron
    update.next_run_at = next.toISOString()
  }

  const { data, error } = await admin
    .from('agent_automations').update(update).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ automation: data })
}

// DELETE /api/mello/automations/:id
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('agent_automations').select('user_id').eq('id', params.id).single()
  if (!existing || existing.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('agent_automations').delete().eq('id', params.id)
  return NextResponse.json({ success: true })
}
