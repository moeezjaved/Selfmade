import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/mello/conversations — list this user's conversations
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50', 10), 100)
  const admin = createAdminClient()
  const { data } = await admin
    .from('agent_conversations')
    .select('id, title, status, channel, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit)

  // Hide empty draft conversations — a row is created eagerly (POST below) before the
  // first message is sent, so an interrupted/aborted send leaves a "New conversation" that
  // opens blank. Only surface conversations that actually have at least one message.
  const rows = (data || []) as Array<{ id: string }>
  const ids = rows.map((c) => c.id)
  const { data: msgRows } = ids.length
    ? await admin.from('agent_messages').select('conversation_id').in('conversation_id', ids)
    : { data: [] as { conversation_id: string }[] }
  const withMessages = new Set(((msgRows || []) as Array<{ conversation_id: string }>).map((m) => m.conversation_id))
  const conversations = rows.filter((c) => withMessages.has(c.id))

  return NextResponse.json({ conversations })
}

// POST /api/mello/conversations — create a new (empty) conversation
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('agent_conversations')
    .insert({ user_id: user.id, title: null, channel: 'web', status: 'active' })
    .select('id, title, status, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ conversation: data })
}
