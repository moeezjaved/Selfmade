/**
 * askMello — Mello's one conversational brain, callable from anywhere (web brief, Slack, WhatsApp).
 * Give it a founder's message; it returns Mello's reply. Same routing everywhere, so Mello is the same
 * colleague on every surface:
 *   1. TEACH  — "never discount" → a company belief (Brain L2)
 *   2. LISTEN — soft signal ("our audience is parents") → low-confidence memory (Brain L3/L5)
 *   3. competitor list/identity questions → answered from data, instant
 *   4. ads question → the grounded audit router (never the hang-prone loop)
 *   5. reacting to a brief item ("why this?") → fast item-grounded reflect
 *   6. anything else → the Mello agent, hard-capped so it can't hang
 * Extracted from /api/brief/reply so there is ONE brain, not three.
 */
import { runAgentToText } from '@/lib/mello/agent'

const isBlankName = (b?: string) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }
const TEACH = /^(never|always|from now on|don'?t|do not|only|we (?:never|always|only)|make sure|remember (?:to|that)|keep in mind|by default)\b/i
const SIGNAL = /\b((our|my) (audience|customers?|buyers?|brand|market|product|tone|voice|goal|niche|focus)|we (are|sell|target|focus on|prefer|value|care about))\b/i

export async function askMello(admin: any, userId: string, message: string, opts?: { item?: any; email?: string | null }): Promise<{ reply: string }> {
  const q = String(message || '').trim().slice(0, 800)
  const item = opts?.item
  if (!q) return { reply: 'Say that again?' }

  // 1 · TEACH a belief
  if (!item && TEACH.test(q) && !q.includes('?')) {
    try {
      const { teachRule } = await import('@/lib/brain')
      await teachRule(admin, { userId, rule: q, createdBy: 'founder', source: 'chat' })
      return { reply: `Got it — I've made that a company rule: “${q}”. The whole team follows it from now on. Say “forget that rule” any time to remove it.` }
    } catch { /* fall through */ }
  }

  // 2 · LISTEN — capture soft signal (best-effort, no LLM)
  if (!item && !q.includes('?') && SIGNAL.test(q) && q.length <= 200) {
    try { admin.from('mello_memory').insert({ user_id: userId, content: q, category: 'signal', confidence: 40, source: 'inferred' }).then(() => {}, () => {}) } catch { /* ignore */ }
  }

  // Ground in who they watch.
  let watchLine = '', watchCount = 0
  try {
    const { data: follows } = await admin.from('followed_brands').select('brand_name, spied').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    const names = (follows || []).map((f: any) => f.brand_name).filter((n: string) => !isBlankName(n))
    watchCount = names.length
    if (names.length) watchLine = `The founder is watching these competitors (their ads are in your crawled library — pull specifics with search_ad_library / get_competitor_ads): ${names.join(', ')}.\n\n`
  } catch { /* ignore */ }

  const asksCompetitors = /competitor|rival|who\s+(?:am|are)\s+i\s+watch|who\s+do\s+i\s+watch|my\s+brands?\b/i.test(q)

  // 3 · competitor identity/list — instant, from data
  if (watchCount === 0 && asksCompetitors) {
    return { reply: `You're not watching any competitors yet — add one from Discovery → Spy a brand, and I'll track every ad they launch and pull the patterns into your brief.` }
  }
  const isListQuestion = asksCompetitors && /\b(name|names|list|who|which|what)\b/i.test(q) && q.length < 90
  if (watchCount > 0 && isListQuestion) {
    const { data: follows } = await admin.from('followed_brands').select('brand_name').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    const names = (follows || []).map((f: any) => f.brand_name).filter((n: string) => !isBlankName(n))
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return { reply: names.length === 1
      ? `You're watching ${list} — I read their whole ad archive and flag every new ad they launch. Want me to pull their latest, or add another?`
      : `You're watching ${names.length}: ${list}. I track every ad each one launches and roll the patterns into your brief. Want the latest from any of them?` }
  }

  // 4 · ads question → grounded audit router (memory-aware inside answerAdsQuestion)
  try {
    const { answerAdsQuestion } = await import('@/lib/meta/answer')
    const ads = await answerAdsQuestion(admin, userId, q)
    if (ads) return ads
  } catch { /* fall through */ }

  // 5 · reacting to a brief item ("why this?") — fast, no tools
  if (item && (item.title || item.body)) {
    try {
      const { default: OpenAI } = await import('openai')
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const model = process.env.MELLO_MODEL || 'gpt-4o'
      const resp: any = await Promise.race([
        openai.chat.completions.create({
          model, temperature: 0.4, max_tokens: 220,
          messages: [
            { role: 'system', content: `You are Mello, the founder's in-house AI marketer. First person, warm, 2-3 sentences, specific — never a lecture, never a list.` },
            { role: 'user', content: `${watchLine}This morning you told the founder:\n"${String(item.title || '').slice(0, 300)}"${item.body ? `\n${String(item.body).slice(0, 500)}` : ''}\n\nThey asked: "${q}"\n\nAnswer it — explain why it matters and what you'd do next, grounded in what you already said.` },
          ],
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('reflect_timeout')), 12000)),
      ])
      const text = (resp?.choices?.[0]?.message?.content || '').trim()
      if (text) return { reply: text }
    } catch { /* fall through */ }
    return { reply: String(item.body || item.title || `It's on today's brief because it moves your numbers. Want me to go deeper?`) }
  }

  // 6 · general — the Mello agent, hard-capped so it can't hang
  const prompt = `You're Mello, the founder's in-house AI marketer, chatting with them.\n\n${watchLine}The founder said: "${q}"\n\nAnswer as Mello — first person, 2–4 sentences, specific and grounded. Use your ad-library tools (search_ad_library, get_competitor_ads, find_winning_ads, analyze_niche_patterns) to pull real specifics about the brands above or their niche. If they're redirecting you ("make it warmer", "watch this brand", "kill it"), acknowledge concretely and say exactly what you'll do next; if they want a creative made, tell them to hit Create / the studio.\n\nHARD RULES: Selfmade is clone-first — it does NOT require a connected Meta account; everything is in the crawled ad library. NEVER tell the founder to "connect Meta" or that you can't find their competitors — you know who they watch (above) and their ads are in your library. Never verbose, never a lecture. A colleague, not a chatbot.`
  try {
    const result: any = await Promise.race([
      runAgentToText(userId, prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('agent_timeout')), 30000)),
    ])
    return { reply: (result?.text || '').trim() || `Got it — I'm on it.` }
  } catch (e: any) {
    return { reply: e?.message === 'agent_timeout' ? `That one's taking me longer than it should — ask again and I'll be quicker.` : `I hit a snag pulling that together — try me again in a moment.` }
  }
}
