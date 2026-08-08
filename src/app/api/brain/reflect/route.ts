/**
 * POST /api/brain/reflect  — the Company Brain's reflection loop (Phase 4).
 * Diffs what actually happened (learnings + approved actions) against what the founder said they
 * believe (DNA), and PROPOSES rule updates: a belief repeatedly contradicted, or a strong pattern
 * worth codifying. Proposals are written as company_dna rows with created_by='mello', active=false —
 * they never take effect until the founder approves them. Mello proposes; the founder decides.
 *
 * Auth: cookie ("look for patterns" from the Brain UI) OR Bearer CRON_SECRET + { userId } (nightly).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getDna } from '@/lib/brain'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  let userId: string | null = null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) userId = user.id
  else if (process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) {
    const b = await req.json().catch(() => ({})); userId = b.userId ? String(b.userId) : null
  }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ proposals: [], note: 'reasoning model not configured' })

  // The founder's active beliefs, recent learnings (facts), and existing proposals (to dedupe).
  const beliefs = await getDna(admin, userId)   // active only
  const { data: learns } = await admin.from('learnings').select('department, event, result, metric, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(80)
  const learnings = (learns || []) as any[]
  // v5 — also reflect on customer conversations (last 14 days), aggregated by topic.
  const { data: sigs } = await admin.from('customer_signals').select('topic, sentiment')
    .eq('user_id', userId).gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).limit(400)
  const sigAgg: Record<string, { n: number; neg: number }> = {}
  for (const s of (sigs || []) as any[]) { const k = String(s.topic || 'other'); sigAgg[k] ||= { n: 0, neg: 0 }; sigAgg[k].n++; if (s.sentiment === 'neg') sigAgg[k].neg++ }
  const topSignals = Object.entries(sigAgg).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([topic, v]) => ({ topic, mentions: v.n, negative: v.neg }))
  if (learnings.length < 5 && topSignals.length < 3) return NextResponse.json({ proposals: [], note: 'not enough history yet — the log and inbox need to fill first' })
  const { data: existing } = await admin.from('company_dna').select('rule')
    .eq('user_id', userId).eq('created_by', 'mello').eq('active', false).eq('source', 'reflection')
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
    const payload = { currentBeliefs: beliefs.map((b: any) => ({ rule: b.rule, department: b.department })), recentFacts: learnings.map((l) => ({ department: l.department, event: l.event, result: l.result, metric: l.metric })), customerSignals: topSignals }
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
    return NextResponse.json({ proposals: proposals.map((p: any) => ({ rule: p.rule, department: p.department || null, basedOn: p.basedOn || '' })) })
  } catch (e: any) {
    return NextResponse.json({ proposals: [], error: String(e?.message || e).slice(0, 120) })
  }
}
