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
import { runAgentToText } from '@/lib/mello/agent'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const isBlankName = (b?: string) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited', reply: 'One moment — give me a few seconds and ask again.' }, { status: 429 })

  const { question, item } = await req.json().catch(() => ({}))
  const q = String(question || '').trim().slice(0, 800)
  if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 })

  // Ground the answer in WHO the founder actually watches (spied/followed brands) so "which competitor
  // am I watching / what did they launch" is answered from real data — not deflected to "connect Meta".
  let watchLine = ''
  let watchCount = 0
  try {
    const admin = createAdminClient()
    const { data: follows } = await admin.from('followed_brands')
      .select('brand_name, spied').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
    const names = (follows || []).map((f: any) => f.brand_name).filter((n: string) => !isBlankName(n))
    watchCount = names.length
    if (names.length) watchLine = `The founder is watching these competitors (their ads are in your crawled library — pull specifics with search_ad_library / get_competitor_ads): ${names.join(', ')}.\n\n`
  } catch { /* best-effort */ }

  // No competitors yet + they're asking ABOUT competitors → answer directly, DON'T run the agent
  // (its prompt forbids saying "I can't find them", so with zero watched it spins/hangs/hallucinates).
  if (watchCount === 0 && /competitor|rival|who\s+(?:am|are)\s+i\s+watch|my\s+brands?\b/i.test(q)) {
    return NextResponse.json({ reply: `You're not watching any competitors yet — add one from Discovery → Spy a brand, and I'll track every ad they launch and pull the patterns into your brief.` })
  }

  // Frame the reply as a standup exchange: Mello already SAID something this morning, the founder is
  // reacting to it. Keep answers short, specific, first-person, and action-oriented.
  const ctx = item && (item.title || item.body)
    ? `This morning in your standup you told the founder:\n"${String(item.title || '').slice(0, 300)}"${item.body ? `\n${String(item.body).slice(0, 400)}` : ''}\n\n`
    : `You're in your daily standup with the founder.\n\n`
  const prompt = `${ctx}${watchLine}The founder just replied: "${q}"\n\nAnswer as Mello, their AI marketer — first person, 2–4 sentences, specific and grounded. Use your ad-library tools (search_ad_library, get_competitor_ads, find_winning_ads, analyze_niche_patterns) to pull real specifics about the brands above or their niche. If they're redirecting you ("make it warmer", "watch this brand", "kill it"), acknowledge concretely and say exactly what you'll do next; if they want a creative made, tell them to hit Create / the studio.\n\nHARD RULES: This is Selfmade's clone-first product — it does NOT require a connected Meta ad account, and everything you need is in the crawled ad library. NEVER tell the founder to "connect Meta" or that you can't find their competitors — you already know who they watch (listed above) and their ads are in your library. Never say you couldn't retrieve data without first trying your library tools. Never verbose, never a lecture. You're a colleague at standup, not a chatbot.`

  try {
    // Hard server-side cap — the agent loops over tools + the LLM and can occasionally stall. Race it
    // so we ALWAYS return a reply fast (never leave the client on "Mello is thinking…").
    const result: any = await Promise.race([
      runAgentToText(user.id, prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('agent_timeout')), 45000)),
    ])
    const reply = (result?.text || '').trim() || `Got it — I'm on it.`
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error('[brief/reply]', e?.message)
    const msg = e?.message === 'agent_timeout'
      ? `That one's taking me longer than it should — ask again and I'll be quicker.`
      : `I hit a snag pulling that together — try me again in a moment.`
    return NextResponse.json({ reply: msg }, { status: 200 })
  }
}
