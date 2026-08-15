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
import { toStateLite, type MelloContext } from '@/lib/mello/context'

const isBlankName = (b?: string) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }
const TEACH = /^(never|always|from now on|don'?t|do not|only|we (?:never|always|only)|make sure|remember (?:to|that)|keep in mind|by default)\b/i
const SIGNAL = /\b((our|my) (audience|customers?|buyers?|brand|market|product|tone|voice|goal|niche|focus)|we (are|sell|target|focus on|prefer|value|care about))\b/i

export type Grounded =
  | { handled: true; reply: string; intent: MelloIntent; sources: string[]; memoryIds?: string[] }
  | { handled: false; intent: MelloIntent; brandId: string | null; watchLine: string }

export async function answerGrounded(
  admin: any,
  userId: string,
  message: string,
  opts?: { item?: any; brandId?: string | null; ctx?: MelloContext | null },
): Promise<Grounded> {
  const q = String(message || '').trim().slice(0, 800)
  const item = opts?.item
  const intent = classifyIntent(q, { hasItem: !!item })

  // Active brand — so "my competitors" / "my business" scope to the brand the founder is viewing, not
  // all brands mashed together. Explicit (switcher) beats cookie beats null (Slack/WhatsApp = account-wide).
  let brandId: string | null = opts?.brandId || null
  if (!brandId) { try { const { resolveActiveBrandId } = await import('@/lib/brand/active'); brandId = await resolveActiveBrandId(admin, userId).catch(() => null) } catch { /* channel context */ } }

  // Phase 2.2 — load the authoritative account-state snapshot once (plan, integrations, brand,
  // competitors). Every deterministic answer below reads from THIS, never the LLM. Reuse a snapshot the
  // caller already built (askMello) so we don't double-load.
  let ctx: MelloContext | null = opts?.ctx || null
  if (!ctx) { try { const { loadMelloContext } = await import('@/lib/mello/context'); ctx = await loadMelloContext(admin, userId, brandId) } catch { /* fail-soft: state-blind fallbacks below */ } }

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

  // 3b · CAMPAIGN STATUS — deterministic active-campaign truth from the Meta audit (active-only buckets),
  // never the LLM. Excludes metric words so "which campaign has best ROAS" stays a metric question.
  const CAMPAIGN_STATUS_Q = /\bcampaigns?\b/i.test(q)
    && /\b(how many|which|any|are|is|running|active|live|paused|pause|status|on right now|turned? o[nf]f?)\b/i.test(q)
    && !/\b(roas|cpa|cpc|cpm|ctr|spend|spent|revenue|budget|best|worst|top|worse|performing|performance|scal)\b/i.test(q)
  if (ctx && !item && CAMPAIGN_STATUS_Q) {
    if (!ctx.integrations.meta.connected) {
      return { handled: true, intent: 'ads_metric', sources: ['Integrations'], reply: `You don't have a Meta ad account connected yet, so I can't see live campaigns. Connect one in Settings → Connect Meta and I'll track every campaign's status for you.` }
    }
    try {
      const { auditAccount } = await import('@/lib/meta/audit')
      const audit: any = await auditAccount(admin, userId, ctx.integrations.meta.accountId || undefined, 'last_30d')
      if (audit) {
        const n = (a: any) => Array.isArray(a) ? a.length : (typeof a === 'number' ? a : 0)
        const scale = n(audit.scale) || n(audit.counts?.scale)
        const watch = n(audit.watch) || n(audit.counts?.watch)
        const pause = n(audit.pause) || n(audit.counts?.pause)
        const active = scale + watch + pause
        const acct = ctx.integrations.meta.accountName ? ` on ${ctx.integrations.meta.accountName}` : ''
        const scope = ctx.brandName ? ` for ${ctx.brandName}` : ''
        const reply = active > 0
          ? `You've got ${active} active campaign${active === 1 ? '' : 's'}${acct}${scope} — ${scale} scaling well, ${watch} to keep an eye on, ${pause} I'd look at pausing. Want the detail on any of those?`
          : `No active campaigns with delivery${acct}${scope} in the last 30 days. Want me to look at what to launch?`
        return { handled: true, intent: 'ads_metric', sources: ['Meta Ads audit'], reply }
      }
    } catch { /* fall through to agent */ }
  }

  // 3c · CUSTOMER / INBOX — deterministic counts + themes from the inbox, never the LLM.
  const CUSTOMER_THEME_Q = /\b(what are|what're|what do)\b[^?]*\bcustomers?\b/i.test(q) || /\bcustomers?\b[^?]*\b(ask|asking|saying|want|complain|confused|question)/i.test(q) || /\b(common|top)\b[^?]*\b(question|complaint|theme|ask)/i.test(q)
  const CUSTOMER_COUNT_Q = /\b(open|unread|new)\b[^?]*\b(conversation|convo|thread|message|inbox|dm|reply|replies)s?\b/i.test(q) || /\b(how many|number of|any)\b[^?]*\b(conversation|convo|thread|message|dm|customer|reply|replies)s?\b/i.test(q)
  if (ctx && !item && (CUSTOMER_THEME_Q || CUSTOMER_COUNT_Q)) {
    if (CUSTOMER_THEME_Q) {
      try {
        const { generateCustomerInsights } = await import('@/lib/customer/insights')
        const ins: any = await generateCustomerInsights(admin, userId, { days: 14 })
        if (ins && (ins.totalMessages || 0) > 0) {
          const themes = (ins.themes || []).map((t: any) => typeof t === 'string' ? t : (t.theme || t.label || t.name)).filter(Boolean).slice(0, 4)
          const intents = (ins.intents || []).map((t: any) => `${t.intent || t.label}${t.count ? ` (${t.count})` : ''}`).filter(Boolean).slice(0, 4)
          const body = ins.summary || (themes.length ? `Top themes: ${themes.join(', ')}.` : '') || (intents.length ? `Most common: ${intents.join(', ')}.` : 'a mix of questions.')
          return { handled: true, intent: 'company_memory', sources: ['Customer inbox'], reply: `Across ${ins.totalMessages} customer message${ins.totalMessages === 1 ? '' : 's'} in the last 14 days: ${body}` }
        }
        return { handled: true, intent: 'company_memory', sources: ['Customer inbox'], reply: `No customer messages have come through yet. Connect a channel (Settings → Slack & WhatsApp) and I'll start summarizing what customers ask.` }
      } catch { /* fall through */ }
    }
    try {
      const { count: openCount } = await admin.from('customer_threads').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open')
      const c = openCount || 0
      const noChannel = !ctx.integrations.whatsapp.connected && !ctx.integrations.slack.connected
      return { handled: true, intent: 'company_memory', sources: ['Customer inbox'], reply: c > 0
        ? `You have ${c} open conversation${c === 1 ? '' : 's'} in your inbox. Want me to summarize what they need?`
        : `Your inbox is clear — no open conversations right now.${noChannel ? ' (Connect WhatsApp or Slack in Settings to route customer chats here.)' : ''}` }
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

  // 3.5 · product how-to — deterministic in-app steps, STATE-AWARE (plan + Meta connection), BEFORE
  // anything that could pull company data. Passing ctx is what fixes bugs #1/#4 (a Creator no longer
  // hears "Connecting Meta is a paid feature" / "you're on Free").
  if (!item && intent === 'product_help') { const guide = productHowTo(q, toStateLite(ctx)); if (guide) return { handled: true, intent, sources: ctx ? ['Subscription', 'Integrations', 'Product help'] : ['Product help'], reply: guide } }

  // 4 · ads / metric question → the grounded audit (the SAME auditAccount the brief uses). Provenance +
  // no-guess handled inside answerAdsQuestion.
  if (intent === 'ads_metric') {
    try {
      const { answerAdsQuestion } = await import('@/lib/meta/answer')
      const ads = await answerAdsQuestion(admin, userId, q, { brandId })   // pass the SAME brand the brief uses
      if (ads) return { handled: true, intent, sources: ['Meta Ads audit'], reply: ads.reply }
    } catch { /* fall through to agent */ }
  }

  // 4.5 · company-knowledge → the Company Brain answer engine (beliefs + facts + learnings + signals),
  // cites its source. Returns null when there's nothing to ground on → escalate.
  if (!item && (intent === 'company_memory' || intent === 'general')) {
    try {
      const { brainAnswer } = await import('@/lib/brain')
      const ans = await brainAnswer(admin, userId, q, { brandId })
      if (ans?.reply) return { handled: true, intent, memoryIds: ans.memoryIds, sources: ans.sources?.length ? ans.sources : ['Company Brain'], reply: ans.sources?.length ? `${ans.reply}\n\n_Source · ${ans.sources.join(' · ')}_` : ans.reply }
    } catch { /* fall through */ }
  }

  // Not grounded here — escalate to the agent with brand-scoped context.
  return { handled: false, intent, brandId, watchLine }
}
