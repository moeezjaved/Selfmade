import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runAgent, generateTitle, type HistoryMsg } from '@/lib/mello/agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/mello/conversations/:id/messages — send a message, stream the response (SSE)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json().catch(() => ({}))
  const message: string = (body?.message || '').toString().trim()
  if (!message) return new Response('Empty message', { status: 400 })
  const surface: string | undefined = typeof body?.surface === 'string' ? body.surface : undefined
  const context: string | undefined = typeof body?.context === 'string' ? body.context.slice(0, 2000) : undefined

  const admin = createAdminClient()
  const { data: conv } = await admin
    .from('agent_conversations')
    .select('id, title, user_id')
    .eq('id', params.id)
    .single()
  if (!conv || conv.user_id !== user.id) return new Response('Not found', { status: 404 })

  // Prior messages → compact history (text only; tool replay isn't needed turn-to-turn).
  const { data: prior } = await admin
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(40)
  const history: HistoryMsg[] = (prior || [])
    .filter((m: any) => m.content)
    .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

  const isFirst = (history.length === 0)

  // Persist the user message immediately.
  await admin.from('agent_messages').insert({
    conversation_id: params.id, role: 'user', content: message,
  })

  const encoder = new TextEncoder()
  const userId = user.id
  const conversationId = params.id

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)) } catch { /* closed */ }
      }
      try {
        // Auto-title on the first message (fire before answering so the sidebar updates).
        if (isFirst) {
          const title = await generateTitle(message)
          await admin.from('agent_conversations').update({ title }).eq('id', conversationId)
          send({ type: 'title_update', title })
        }

        const result = await runAgent({ userId, history, userMessage: message, send, surface, context })

        const { data: saved } = await admin.from('agent_messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: result.text || '',
          tool_calls: result.toolCalls.length ? result.toolCalls : null,
          thinking_steps: result.thinkingSteps.length ? result.thinkingSteps : null,
          interactive_widget: result.widget || null,
        }).select('id').single()

        await admin.from('agent_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId)

        if (saved?.id) send({ type: 'feedback_prompt', message_id: saved.id })
        send({ type: 'done' })
      } catch (err: any) {
        console.error('[mello] agent error:', err?.message)
        send({ type: 'error', message: err?.message || 'Something went wrong' })
        send({ type: 'done' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
