/**
 * answerGrounded — the ONE authoritative pre-agent pipeline, shared by every surface (/brief, /mello,
 * Slack, WhatsApp). It classifies intent once, then answers from the SOURCE OF TRUTH for that intent:
 *
 *   product_help   → deterministic in-app instructions (never competitor data)
 *   ads_metric     → the live Meta audit (answerAdsQuestion → auditAccount — the SAME service the brief
 *                    uses), with provenance; never a guessed number
 *   competitor     → the founder's watched brands, answered straight from data
 *   company_memory → TEACH a belief, or the Company Brain answer engine (grounded + cited)
 *
 * Returns { handled:true, reply, intent, sources } when it produced a grounded answer, or
 * { handled:false, intent, brandId, watchLine } to tell the caller to escalate to the agent — with the
 * brand-scoped context the agent should use. This is why /mello and /brief now AGREE: identical routing,
 * identical data services, one place.
 */
import { classifyIntent, productHowTo, type MelloIntent } from '@/lib/mello/intent'

const isBlankName = (b?: string) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }
const TEACH = /^(never|always|from now on|don'?t|do not|only|we (?:never|always|only)|make sure|remember (?:to|that)|keep in mind|by default)\b/i
const SIGNAL = /\b((our|my) (audience|customers?|buyers?|brand|market|product|tone|voice|goal|niche|focus)|we (are|sell|target|focus on|prefer|value|care about))\b/i

export type Grounded =
  | { handled: true; reply: string; intent: MelloIntent; sources: string[] }
  | { handled: false; intent: MelloIntent; brandId: string | null; watchLine: string }

export async function answerGrounded(
  admin: any,
  userId: string,
  message: string,
  opts?: { item?: any; brandId?: string | null },
): Promise<Grounded> {
  const q = String(message || '').trim().slice(0, 800)
  const item = opts?.item
  const intent = classifyIntent(q, { hasItem: !!item })

  // Active brand — so "my competitors" / "my business" scope to the brand the founder is viewing, not
  // all brands mashed together. Explicit (switcher) beats cookie beats null (Slack/WhatsApp = account-wide).
  let brandId: string | null = opts?.brandId || null
  if (!brandId) { try { const { resolveActiveBrandId } = await import('@/lib/brand/active'); brandId = await resolveActiveBrandId(admin, userId).catch(() => null) } catch { /* channel context */ } }

  // 1 · TEACH a belief (company_memory intent, statement form)
  if (!item && intent === 'company_memory' && TEACH.test(q) && !q.includes('?')) {
    try {
      const { teachWithConflictCheck } = await import('@/lib/brain')
      const res = await teachWithConflictCheck(admin, { userId, rule: q, source: 'founder' })
      if (res.conflict) return { handled: true, intent, sources: ['Company Brain'], reply: `Hold on — that clashes with a rule you already set: “${res.existingRule}”. I've flagged it for you. How should I treat the new one — a temporary exception, replace the old rule, or keep the old one? (You can resolve it on the Company Brain → Review tab.)` }
      return { handled: true, intent, sources: ['Company Brain'], reply: `Got it — I've made that a company rule: “${q}”. The whole team follows it from now on. Say “forget that rule” any time to remove it.` }
    } catch { /* fall through */ }
  }

  // 2 · LISTEN — capture a soft signal (best-effort, no LLM, doesn't answer)
  if (!item && !q.includes('?') && SIGNAL.test(q) && q.length <= 200) {
    try { admin.from('mello_memory').insert({ user_id: userId, content: q, category: 'signal', confidence: 40, source: 'inferred' }).then(() => {}, () => {}) } catch { /* ignore */ }
  }

  // Who they watch (scoped to the active brand) — needed for competitor answers AND handed to the agent.
  let watchLine = '', watchCount = 0, names: string[] = []
  try {
    let fq = admin.from('followed_brands').select('brand_name, spied, brand_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    if (brandId) fq = fq.eq('brand_id', brandId)
    const { data: follows } = await fq
    names = (follows || []).map((f: any) => f.brand_name).filter((n: string) => !isBlankName(n))
    watchCount = names.length
    if (names.length) watchLine = `The founder is watching these competitors (their ads are in your crawled library — pull specifics with search_ad_library / get_competitor_ads): ${names.join(', ')}.\n\n`
  } catch { /* ignore */ }

  // 3a · company STAT ("how many competitor ads did we analyze / read overnight?") → the SAME shared
  // count the brief renders, so chat and brief never disagree (Phase 10, data-layer parity).
  const STATS = /\b(how many|number of)\b[^?]*\bads?\b[^?]*\b(analy[sz]|read|scan|crawl|overnight|index)/i
  if (STATS.test(q) || /\bads read overnight\b/i.test(q)) {
    try {
      const { getAdsScanned24h } = await import('@/lib/company/metrics')
      const n = await getAdsScanned24h(admin, userId, brandId)
      return { handled: true, intent: 'competitor', sources: ['Ads read overnight'], reply: n > 0
        ? `I read ${n.toLocaleString()} competitor ad${n === 1 ? '' : 's'} in the last 24 hours${names.length ? ` across the ${names.length} brand${names.length === 1 ? '' : 's'} you watch` : ''} — the same number on your brief.`
        : `No new competitor ads came through in the last 24 hours. The moment one launches, I'll flag it on your brief.` }
    } catch { /* fall through */ }
  }

  // 3 · competitor identity / list — instant, straight from data
  if (intent === 'competitor') {
    const asksList = /\b(name|names|list|who|which|what)\b/i.test(q) && q.length < 90
    if (watchCount === 0 && (/\bwho\b/i.test(q) || asksList)) {
      return { handled: true, intent, sources: ['Watched brands'], reply: `You're not watching any competitors yet — add one from Discovery → Spy a brand, and I'll track every ad they launch and pull the patterns into your brief.` }
    }
    if (watchCount > 0 && asksList) {
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      return { handled: true, intent, sources: ['Watched brands'], reply: names.length === 1
        ? `You're watching ${list} — I read their whole ad archive and flag every new ad they launch. Want me to pull their latest, or add another?`
        : `You're watching ${names.length}: ${list}. I track every ad each one launches and roll the patterns into your brief. Want the latest from any of them?` }
    }
    // A specific-competitor question ("what did NovaMane launch") → let the agent use the library tools,
    // but with competitor context legitimately in scope. Fall through as GENERAL-with-context.
  }

  // 3.5 · product how-to — deterministic in-app steps, BEFORE anything that could pull company data.
  if (!item && intent === 'product_help') { const guide = productHowTo(q); if (guide) return { handled: true, intent, sources: ['Product help'], reply: guide } }

  // 4 · ads / metric question → the grounded audit (the SAME auditAccount the brief uses). Provenance +
  // no-guess handled inside answerAdsQuestion.
  if (intent === 'ads_metric') {
    try {
      const { answerAdsQuestion } = await import('@/lib/meta/answer')
      const ads = await answerAdsQuestion(admin, userId, q)
      if (ads) return { handled: true, intent, sources: ['Meta Ads audit'], reply: ads.reply }
    } catch { /* fall through to agent */ }
  }

  // 4.5 · company-knowledge → the Company Brain answer engine (beliefs + facts + learnings + signals),
  // cites its source. Returns null when there's nothing to ground on → escalate.
  if (!item && (intent === 'company_memory' || intent === 'general')) {
    try {
      const { brainAnswer } = await import('@/lib/brain')
      const ans = await brainAnswer(admin, userId, q, { brandId })
      if (ans?.reply) return { handled: true, intent, sources: ans.sources?.length ? ans.sources : ['Company Brain'], reply: ans.sources?.length ? `${ans.reply}\n\n_Source · ${ans.sources.join(' · ')}_` : ans.reply }
    } catch { /* fall through */ }
  }

  // Not grounded here — escalate to the agent with brand-scoped context.
  return { handled: false, intent, brandId, watchLine }
}
