/**
 * brainAnswer — "Ask Mello anything about your company." The read side of the Company Brain.
 *
 * Retrieves across every layer (identity + beliefs + facts + learnings + prefs + live context + the last
 * two weeks of customer signals), reasons with the model, and answers in Mello's voice with a Source line.
 * Honest by design: if the Brain doesn't hold the answer, it says so and offers to find out — that reads as
 * more intelligent, not less. No vectors — structured retrieval (recency + confidence + topic aggregation).
 *
 * Returns null when the message isn't a company-knowledge question or there's nothing to ground on, so the
 * caller (askMello) can fall through to the ads router / general agent.
 */

// Fires for questions about the company itself — not ads specifics (the ads router handles those first).
const COMPANY_Q = /\b(our|we|us|my company|the company|customers?|clients?|brand|position|believe|belief|rule|policy|learn(?:ed|ing)?|remember|know about|decision|complain|feedback|best|worst|top|why did|why do|should we|do we|are we|what do we|what did we|what's our|whats our|how do we)\b/i

function isCompanyQuestion(q: string): boolean {
  const t = q.trim()
  if (t.length < 3) return false
  const looksAsk = t.includes('?') || /^(what|why|how|which|who|when|do|does|are|is|should|tell me|show me|remind)/i.test(t)
  return looksAsk && COMPANY_Q.test(t)
}

export async function brainAnswer(
  admin: any, userId: string, question: string, opts?: { brandId?: string | null },
): Promise<{ reply: string; sources: string[] } | null> {
  const q = String(question || '').trim().slice(0, 500)
  if (!q || !isCompanyQuestion(q)) return null
  const nowIso = new Date().toISOString()
  const since = new Date(Date.now() - 14 * 86400000).toISOString()

  const brandId = opts?.brandId || null
  // Scope every layer to the ACTIVE brand: this brand's rows + account-wide (null). Answers under Hair
  // ResQ no longer pull Aura's facts/learnings/customer signals/identity. (brand_id absent pre-mig on
  // mello_memory → those treated as account-wide; other tables already have brand_id.)
  const inBrand = (r: any) => !brandId || !r.brand_id || r.brand_id === brandId
  const strictBrand = (r: any) => !brandId || r.brand_id === brandId   // signals/competitors are brand-specific
  let dna: any[] = [], mem: any[] = [], learns: any[] = [], signals: any[] = [], ctx: any[] = [], follows: any[] = [], identity: any = null
  try {
    const [dnaR, memR, lnR, sgR, cxR, flR, idR] = await Promise.all([
      admin.from('company_dna').select('rule, department, priority, source, brand_id').eq('user_id', userId).eq('active', true).order('created_at', { ascending: false }).limit(80),
      admin.from('mello_memory').select('content, category, confidence, department, brand_id').eq('user_id', userId).is('retired_at', null).order('confidence', { ascending: false }).limit(80),
      admin.from('learnings').select('department, event, result, metric, created_at, brand_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
      admin.from('customer_signals').select('topic, sentiment, quote, brand_id').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(300),
      admin.from('brain_context').select('kind, body, brand_id').eq('user_id', userId).or(`expires_at.is.null,expires_at.gt.${nowIso}`).order('created_at', { ascending: false }).limit(40),
      admin.from('followed_brands').select('brand_name, brand_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(40),
      brandId
        ? admin.from('brands').select('name, industry, brand_type').eq('user_id', userId).eq('id', brandId).limit(1)
        : admin.from('brands').select('name, industry, brand_type').eq('user_id', userId).order('created_at', { ascending: true }).limit(1),
    ])
    dna = (dnaR?.data || []).filter(inBrand).slice(0, 40)
    mem = (memR?.data || []).filter(inBrand).slice(0, 40)
    learns = (lnR?.data || []).filter(inBrand).slice(0, 30)
    signals = (sgR?.data || []).filter(strictBrand).slice(0, 200)
    ctx = (cxR?.data || []).filter(inBrand).slice(0, 20)
    follows = (flR?.data || []).filter(strictBrand).slice(0, 20)
    identity = (idR?.data || [])[0] || null
  } catch { /* fall through with whatever we have */ }

  // Nothing to ground on → let the caller's general agent take it.
  const hasBrain = dna.length || mem.length || learns.length || signals.length || ctx.length || identity
  if (!hasBrain) return null

  // Aggregate customer signals by topic → "18 customers mentioned the applicator".
  const topicAgg: Record<string, { n: number; neg: number; quote?: string }> = {}
  for (const s of signals) {
    const k = String(s.topic || 'other')
    topicAgg[k] ||= { n: 0, neg: 0 }
    topicAgg[k].n++
    if (s.sentiment === 'neg') topicAgg[k].neg++
    if (!topicAgg[k].quote && s.quote) topicAgg[k].quote = s.quote
  }
  const topTopics = Object.entries(topicAgg).sort((a, b) => b[1].n - a[1].n).slice(0, 6)

  // Compile a compact, source-labelled context in order of authority.
  const parts: string[] = []
  const sources: string[] = []
  if (identity) { parts.push(`IDENTITY: ${identity.name || 'the brand'}${identity.industry ? ` · ${identity.industry}` : ''}${identity.brand_type ? ` · ${identity.brand_type}` : ''}.`); sources.push('Identity') }
  if (dna.length) { parts.push(`BELIEFS (rules, never break):\n${dna.map((d: any) => `• ${d.rule}${d.department ? ` [${d.department}]` : ''}`).join('\n')}`); sources.push('Beliefs') }
  if (mem.length) { parts.push(`KNOWN FACTS:\n${mem.slice(0, 20).map((m: any) => `• ${m.content}`).join('\n')}`); sources.push('Knowledge') }
  if (learns.length) { parts.push(`LEARNED (event → outcome):\n${learns.slice(0, 18).map((l: any) => `• ${l.event}${l.result ? ` → ${l.result}` : ''}`).join('\n')}`); sources.push('Learnings') }
  if (topTopics.length) { parts.push(`CUSTOMER SIGNALS (last 14 days, ${signals.length} conversations):\n${topTopics.map(([t, v]) => `• ${t}: ${v.n} mention${v.n === 1 ? '' : 's'}${v.neg ? ` (${v.neg} negative)` : ''}${v.quote ? ` — “${v.quote}”` : ''}`).join('\n')}`); sources.push('Customer conversations') }
  if (ctx.length) { parts.push(`HAPPENING NOW:\n${ctx.map((c: any) => `• ${c.kind}: ${c.body}`).join('\n')}`); sources.push('Live context') }
  const followNames = follows.map((f: any) => f.brand_name).filter((n: string) => n && !/^\d+$/.test(String(n).trim()))
  if (followNames.length) { parts.push(`WATCHING: ${followNames.join(', ')}.`); sources.push('Competitors watched') }

  const context = parts.join('\n\n')

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.MELLO_MODEL || 'gpt-4o'
    const system = `You are Mello, the founder's in-house chief of staff. Answer the founder's question about THEIR company using ONLY the Company Brain below. First person, warm, concise (2–5 sentences or a short list). Be specific — cite real numbers from the brain.
HARD RULES:
- If the brain does not contain enough to answer confidently, say so plainly and offer to find out: "I don't have enough on that yet — I can research it." Do NOT invent facts.
- When you reason (e.g. "should we launch this?"), combine beliefs + learnings + signals and give a clear recommendation.
- Never mention "the brain", "context", JSON, or that you were given data. Just answer like a colleague who knows the company.

--- COMPANY BRAIN ---
${context}`
    const resp: any = await Promise.race([
      openai.chat.completions.create({
        model, temperature: 0.4, max_tokens: 320,
        messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('brain_answer_timeout')), 14000)),
    ])
    const reply = (resp?.choices?.[0]?.message?.content || '').trim()
    if (!reply) return null
    return { reply, sources }
  } catch { return null }
}

export { isCompanyQuestion }
