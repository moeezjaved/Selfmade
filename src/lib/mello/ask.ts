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

// Product how-to — real, first-person answers so Mello can actually GUIDE the founder ("how do I connect
// Meta / WhatsApp / add a competitor / upgrade") instead of improvising fluff. Matched before the ads
// router; only fires when the founder is clearly asking HOW to do something in the app.
function productHowTo(q: string): string | null {
  const t = q.toLowerCase()
  const asksHow = /\b(how|where|can i|help me|guide|steps?|set ?up|connect|link|add|enable|turn on|upgrade)\b/.test(t) || t.includes('?')
  if (!asksHow) return null
  if (/\b(meta|facebook)\b/.test(t) && /\b(connect|link|ad account|account|integrat)/.test(t))
    return `Connecting Meta is a Creator (paid) feature — you don't need it to use me, everything already runs off the crawled ad library. To turn it on: open Billing and upgrade to Creator, then on the brief's “Run your ads on Meta” card hit Connect and either partner-share your ad account (60 seconds in Meta Business Settings) or paste a System-User token. After that I audit your account every morning.`
  if (/\bwhatsapp\b/.test(t) && /\b(connect|link|set ?up|brief|qr)/.test(t))
    return `Go to Settings → “Mello on Slack & WhatsApp” → Connect WhatsApp, then scan the QR code with your phone (WhatsApp → Linked Devices, just like WhatsApp Web). Once it's linked I'll send your morning brief there and you can reply YES to approve my work.`
  if (/\bslack\b/.test(t) && /\b(connect|add|set ?up|brief)/.test(t))
    return `Settings → “Add to Slack” — approve me and pick a channel. You'll get the brief with one-tap Approve buttons right in Slack.`
  if (/\b(calendar|google calendar)\b/.test(t) && /\b(connect|link|add|set ?up)/.test(t))
    return `Settings → “Connect your calendar” (Google). Once linked I'll show today's meetings in your Morning Standup — it never touches the customer inbox.`
  if (/\b(competitor|rival|spy|watch)\b/.test(t) && /\b(add|watch|track|spy|how)/.test(t))
    return `On the brief hit “+ Add a competitor” (or “Spy on a competitor”). Search their name, or paste their Meta Ad Library link — I start pulling every ad they run right away. Free tracks 1; upgrade to watch more.`
  if (/\b(upgrade|plan|pricing|subscri|paid|creator)\b/.test(t))
    return `Tap “Go full-time / Hire Mello full-time” on the brief, or open Billing — it's $49/mo and unlocks tracking all your competitors, connecting Meta, and the full daily work.`
  if (/\b(make|create|generate|design)\b/.test(t) && /\b(ad|creative|video|image|ugc)\b/.test(t))
    return `Hit Create (the + on the left rail) or “Make one like this” on the brief. Pick a rival ad to clone, or let me design a fresh one from your product photos — I'll write the script and hooks.`
  return null
}

export async function askMello(admin: any, userId: string, message: string, opts?: { item?: any; email?: string | null }): Promise<{ reply: string }> {
  const q = String(message || '').trim().slice(0, 800)
  const item = opts?.item
  if (!q) return { reply: 'Say that again?' }

  // 1 · TEACH a belief
  if (!item && TEACH.test(q) && !q.includes('?')) {
    try {
      const { teachWithConflictCheck } = await import('@/lib/brain')
      const res = await teachWithConflictCheck(admin, { userId, rule: q, source: 'founder' })
      if (res.conflict) {
        return { reply: `Hold on — that clashes with a rule you already set: “${res.existingRule}”. I've flagged it for you. How should I treat the new one — a temporary exception, replace the old rule, or keep the old one? (You can resolve it on the Company Brain → Review tab.)` }
      }
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

  // 3.5 · product how-to — guide the founder through the app ("how do I connect Meta / WhatsApp / add a
  // competitor / upgrade") with real steps, before the ads router can improvise a vague answer.
  if (!item) { const guide = productHowTo(q); if (guide) return { reply: guide } }

  // 4 · ads question → grounded audit router (memory-aware inside answerAdsQuestion)
  try {
    const { answerAdsQuestion } = await import('@/lib/meta/answer')
    const ads = await answerAdsQuestion(admin, userId, q)
    if (ads) return ads
  } catch { /* fall through */ }

  // 4.5 · "Ask me anything about your company" → the Company Brain answer engine. Grounds the reply in
  // beliefs + facts + learnings + customer signals and cites the source; returns null (falls through) when
  // it isn't a company-knowledge question or there's nothing to ground on.
  if (!item) {
    try {
      const { brainAnswer } = await import('@/lib/brain')
      const ans = await brainAnswer(admin, userId, q)
      if (ans?.reply) return { reply: ans.sources?.length ? `${ans.reply}\n\n_Source · ${ans.sources.join(' · ')}_` : ans.reply }
    } catch { /* fall through */ }
  }

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
  const prompt = `You're Mello, the founder's in-house AI marketer, chatting with them.\n\n${watchLine}The founder said: "${q}"\n\nAnswer as Mello — first person, 2–4 sentences, specific and grounded. Use your ad-library tools (search_ad_library, get_competitor_ads, find_winning_ads, analyze_niche_patterns) to pull real specifics about the brands above or their niche. If they're redirecting you ("make it warmer", "watch this brand", "kill it"), acknowledge concretely and say exactly what you'll do next; if they want a creative made, tell them to hit Create / the studio.\n\nHARD RULES: Selfmade is clone-first — it does NOT require a connected Meta account; everything is in the crawled ad library. NEVER tell the founder to "connect Meta" or that you can't find their competitors — you know who they watch (above) and their ads are in your library. You do NOT have the founder's own ad-account numbers here — NEVER state a specific ROAS, spend, CTR, revenue, or campaign metric for THEIR ads/account/business (you would be guessing and it will be wrong); if they ask how their own ads or business are performing, say you'll pull their live audit instead of inventing figures. Your tools only cover the crawled COMPETITOR ad library. Never verbose, never a lecture. A colleague, not a chatbot.`
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
