/**
 * askMello — Mello's one conversational brain, callable from anywhere (web brief, Slack, WhatsApp).
 * Give it a founder's message; it returns Mello's reply. It runs the SHARED grounded pipeline first
 * (answerGrounded — intent router + source-of-truth answers, identical to what /mello uses), and only
 * escalates to the capped agent when nothing authoritative applies. One brain, one router, everywhere.
 *
 * Order inside answerGrounded: TEACH belief · competitor list/identity · product how-to · ads audit ·
 * Company Brain. Here we add: react to a brief item ("why this?"), then the general agent (hard-capped).
 */
import { runAgentToText } from '@/lib/mello/agent'
import { answerGrounded } from '@/lib/mello/grounded'
import { logMelloAnswer } from '@/lib/mello/observe'
import { productHowTo } from '@/lib/mello/intent'
import { loadMelloContext, toStateLite, type MelloContext } from '@/lib/mello/context'

// Back-compat: productHowTo now lives in the intent router (the product-help knowledge layer).
export { productHowTo } from '@/lib/mello/intent'

export async function askMello(admin: any, userId: string, message: string, opts?: { item?: any; email?: string | null; brandId?: string | null; surface?: string }): Promise<{ reply: string }> {
  const q = String(message || '').trim().slice(0, 800)
  const item = opts?.item
  const surface = opts?.surface || (item ? 'brief' : 'chat')
  if (!q) return { reply: 'Say that again?' }
  const t0 = Date.now()

  // Phase 2.2 — load the authoritative account-state snapshot ONCE (plan, integrations, brand,
  // competitors) and thread it through so every deterministic answer reads state, never guesses it.
  let ctx: MelloContext | null = null
  try { ctx = await loadMelloContext(admin, userId, opts?.brandId ?? null) } catch { /* fail-soft */ }

  // 0 · PRODUCT HOW-TO wins first — "how do I add a competitor / cancel / download / connect Meta" gets
  // the real in-app steps even when the /brief widget attaches a stale focus item. Now STATE-AWARE, so a
  // Creator never hears "Connecting Meta is a paid feature" and a plan question gets the real plan.
  const guide = productHowTo(q, toStateLite(ctx))
  if (guide) { logMelloAnswer(admin, { userId, brandId: opts?.brandId, surface, question: q, intent: 'product_help', path: 'product_help', ms: Date.now() - t0 }); return { reply: guide } }

  // 1-4.5 · the shared grounded pipeline (source of truth per intent) — reuse the snapshot we just built.
  const g = await answerGrounded(admin, userId, q, { item, brandId: opts?.brandId, ctx })
  if (g.handled) {
    logMelloAnswer(admin, { userId, brandId: opts?.brandId, surface, question: q, intent: g.intent, path: `grounded:${g.intent}`, sources: g.sources, memoryIds: g.memoryIds, ms: Date.now() - t0 })
    return { reply: g.reply }
  }

  const { intent, brandId, watchLine } = g

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
      if (text) { logMelloAnswer(admin, { userId, brandId, surface, question: q, intent, path: 'item_reflect', ms: Date.now() - t0 }); return { reply: text } }
    } catch { /* fall through */ }
    return { reply: String(item.body || item.title || `It's on today's brief because it moves your numbers. Want me to go deeper?`) }
  }

  // 6 · general — the Mello agent, hard-capped so it can't hang. Intent + brand are threaded through so
  // the system prompt only injects competitor context when the intent warrants it (and scoped to brand).
  const prompt = `You're Mello, the founder's in-house AI marketer, chatting with them.\n\n${watchLine}The founder said: "${q}"\n\nAnswer as Mello — first person, 2–4 sentences, specific and grounded. Use your ad-library tools (search_ad_library, get_competitor_ads, find_winning_ads, analyze_niche_patterns) to pull real specifics about the brands above or their niche. If they're redirecting you ("make it warmer", "watch this brand", "kill it"), acknowledge concretely and say exactly what you'll do next; if they want a creative made, tell them to hit Create / the studio.\n\nHARD RULES: Selfmade is clone-first — it does NOT require a connected Meta account; everything is in the crawled ad library. NEVER tell the founder to "connect Meta" or that you can't find their competitors — you know who they watch (above) and their ads are in your library. You do NOT have the founder's own ad-account numbers here — NEVER state a specific ROAS, spend, CTR, revenue, or campaign metric for THEIR ads/account/business (you would be guessing and it will be wrong); if they ask how their own ads or business are performing, say you'll pull their live audit instead of inventing figures. Your tools only cover the crawled COMPETITOR ad library. Never verbose, never a lecture. A colleague, not a chatbot.`
  try {
    const result: any = await Promise.race([
      runAgentToText(userId, prompt, { intent, brandId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('agent_timeout')), 30000)),
    ])
    logMelloAnswer(admin, { userId, brandId, surface, question: q, intent, path: 'agent', ms: Date.now() - t0 })
    return { reply: (result?.text || '').trim() || `Got it — I'm on it.` }
  } catch (e: any) {
    return { reply: e?.message === 'agent_timeout' ? `That one's taking me longer than it should — ask again and I'll be quicker.` : `I hit a snag pulling that together — try me again in a moment.` }
  }
}
