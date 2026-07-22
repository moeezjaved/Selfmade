/**
 * The standup talks back. POST { question, item? } → Mello answers in-character, grounded by the real
 * agent (so "why a doctor?" can actually cite live ad data). This is what turns the Morning Brief from
 * a document into a conversation: the machine spoke first, and now you can interrupt it in plain words.
 *
 * We reuse the existing Mello agent (runAgentToText) rather than a bare LLM call so replies inherit its
 * tools + grounding — but we wrap the user's words in a standup frame so the answer stays short and
 * first-person ("your marketer"), not an essay.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runAgentToText } from '@/lib/mello/agent'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited', reply: 'One moment — give me a few seconds and ask again.' }, { status: 429 })

  const { question, item } = await req.json().catch(() => ({}))
  const q = String(question || '').trim().slice(0, 800)
  if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 })

  // Frame the reply as a standup exchange: Mello already SAID something this morning, the founder is
  // reacting to it. Keep answers short, specific, first-person, and action-oriented.
  const ctx = item && (item.title || item.body)
    ? `This morning in your standup you told the founder:\n"${String(item.title || '').slice(0, 300)}"${item.body ? `\n${String(item.body).slice(0, 400)}` : ''}\n\n`
    : `You're in your daily standup with the founder.\n\n`
  const prompt = `${ctx}The founder just replied: "${q}"\n\nAnswer as Mello, their AI marketer — first person, 2–4 sentences, specific and grounded (look things up if it helps). If they're redirecting you ("make it warmer", "watch this brand", "kill it"), acknowledge concretely and say exactly what you'll do next. Never verbose, never a lecture. You're a colleague at standup, not a chatbot.`

  try {
    const result = await runAgentToText(user.id, prompt)
    const reply = (result?.text || '').trim() || `Got it — I'm on it.`
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error('[brief/reply]', e?.message)
    return NextResponse.json({ reply: `I hit a snag pulling that together — try me again in a moment.` }, { status: 200 })
  }
}
