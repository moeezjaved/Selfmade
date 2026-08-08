/**
 * runReflection — the Company Brain's reflection pass for ONE user, shared by the on-demand route
 * (/api/brain/reflect) and the nightly cron (/api/cron/brain-reflect). Diffs what the company DID
 * (learnings) and what CUSTOMERS said (signals) against what the founder BELIEVES (active DNA), and
 * PROPOSES at most 3 rule updates as inactive company_dna rows (created_by='mello') that never take
 * effect until the founder approves them in the Review tab. Best-effort; never throws.
 */
import { getDna } from './index'

export type ReflectResult = { proposals: { rule: string; department: string | null; basedOn: string }[]; note?: string }

export async function runReflection(admin: any, userId: string): Promise<ReflectResult> {
  if (!process.env.OPENAI_API_KEY) return { proposals: [], note: 'reasoning model not configured' }

  const beliefs = await getDna(admin, userId) // active only
  const { data: learns } = await admin.from('learnings').select('department, event, result, metric, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(80)
  const learnings = (learns || []) as any[]

  const { data: sigs } = await admin.from('customer_signals').select('topic, sentiment')
    .eq('user_id', userId).gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).limit(400)
  const sigAgg: Record<string, { n: number; neg: number }> = {}
  for (const s of (sigs || []) as any[]) { const k = String(s.topic || 'other'); sigAgg[k] ||= { n: 0, neg: 0 }; sigAgg[k].n++; if (s.sentiment === 'neg') sigAgg[k].neg++ }
  const topSignals = Object.entries(sigAgg).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([topic, v]) => ({ topic, mentions: v.n, negative: v.neg }))

  if (learnings.length < 5 && topSignals.length < 3) return { proposals: [], note: 'not enough history yet — the log and inbox need to fill first' }

  const { data: existing } = await admin.from('company_dna').select('rule')
    .eq('user_id', userId).eq('created_by', 'mello').eq('active', false)
  const already = new Set((existing || []).map((r: any) => String(r.rule).toLowerCase().trim()))

  try {
    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.MELLO_MODEL || 'gpt-4o'
    const system = `You are the reflection loop of an AI marketing company's brain. You compare what the company DID (learnings/facts) and what CUSTOMERS said (signals) against what the founder BELIEVES (rules). Propose at most 3 rule updates, only when the evidence is strong:
- a belief the facts repeatedly contradict → propose a refined version (keep the belief, add the real exception).
- a clear repeated pattern in the facts worth making a standing rule.
- a recurring customer theme worth acting on as a rule (e.g. many complaints about one thing → a quality/messaging rule).
Reply ONLY as JSON: {"proposals":[{"rule":string,"department":string|null,"basedOn":string}]}.
- "rule": the proposed belief, in the founder's plain voice, one sentence.
- "department": research|creative|media|growth|customer|store|finance, or null for company-wide.
- "basedOn": one sentence citing the evidence (name the numbers). Empty proposals array is correct if nothing is strong enough. Never propose something already believed.`
    const payload = {
      currentBeliefs: beliefs.map((b: any) => ({ rule: b.rule, department: b.department })),
      recentFacts: learnings.map((l) => ({ department: l.department, event: l.event, result: l.result, metric: l.metric })),
      customerSignals: topSignals,
    }
    const resp = await openai.chat.completions.create({
      model, temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
    })
    let parsed: any = {}
    try { parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}') } catch { parsed = {} }
    const proposals = (Array.isArray(parsed.proposals) ? parsed.proposals : [])
      .filter((p: any) => p?.rule && !already.has(String(p.rule).toLowerCase().trim())).slice(0, 3)

    for (const p of proposals) {
      await admin.from('company_dna').insert({
        user_id: userId, rule: String(p.rule).slice(0, 400), department: p.department || null,
        priority: 'normal', active: false, created_by: 'mello', source: 'reflection',
        evidence: p.basedOn ? { basedOn: String(p.basedOn).slice(0, 300) } : {},
      }).then(() => {}, () => {})
    }
    return { proposals: proposals.map((p: any) => ({ rule: p.rule, department: p.department || null, basedOn: p.basedOn || '' })) }
  } catch (e: any) {
    return { proposals: [], note: String(e?.message || e).slice(0, 120) }
  }
}
