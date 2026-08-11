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
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { askMello } from '@/lib/mello/ask'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited', reply: 'One moment — give me a few seconds and ask again.' }, { status: 429 })

  const { question, item, brandId } = await req.json().catch(() => ({}))
  const q = String(question || '').trim().slice(0, 800)
  if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 })

  // Mello's one brain (shared with Slack + WhatsApp). brandId comes from the brief's active-project
  // switcher so the answer scopes to the RIGHT brand (the server cookie is unreliable).
  const out = await askMello(createAdminClient(), user.id, q, { item, email: user.email, brandId: brandId ? String(brandId) : null })
  return NextResponse.json(out)
}
