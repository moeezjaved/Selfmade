import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// PATCH /api/mello/messages/:id/feedback  { is_helpful: boolean }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { is_helpful } = await request.json().catch(() => ({}))
  const admin = createAdminClient()

  // Verify the message belongs to the user (via its conversation).
  const { data: msg } = await admin
    .from('agent_messages').select('id, conversation_id').eq('id', params.id).single()
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: conv } = await admin
    .from('agent_conversations').select('user_id').eq('id', msg.conversation_id).single()
  if (!conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await admin.from('agent_messages').update({ is_helpful: is_helpful === null ? null : !!is_helpful }).eq('id', params.id)
  return NextResponse.json({ success: true })
}
