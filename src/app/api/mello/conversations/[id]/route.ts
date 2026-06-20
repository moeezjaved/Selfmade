import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/mello/conversations/:id — conversation + its messages
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: conv } = await admin
    .from('agent_conversations')
    .select('id, title, status, channel, created_at, updated_at, user_id')
    .eq('id', params.id)
    .single()

  if (!conv || conv.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: messages } = await admin
    .from('agent_messages')
    .select('id, role, content, tool_calls, thinking_steps, interactive_widget, is_helpful, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ conversation: conv, messages: messages || [] })
}

// DELETE /api/mello/conversations/:id
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: conv } = await admin
    .from('agent_conversations').select('user_id').eq('id', params.id).single()
  if (!conv || conv.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('agent_conversations').delete().eq('id', params.id)
  return NextResponse.json({ success: true })
}
