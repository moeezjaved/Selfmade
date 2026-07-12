/**
 * POST /api/reports/analyze — Mello's read on a generated report.
 * Takes the report's rows + Net Results and returns a short, concrete analysis:
 * what's working, what's bleeding budget, and the single best next action.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llm } from '@/lib/llm'
import { METRICS, TEMPLATE_BY_KEY, type MetricKey } from '@/lib/reports/templates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { templateKey, metrics, rows, netResults, currency, groupBy, mode, question } = await req.json()
  const tpl = TEMPLATE_BY_KEY[templateKey]
  if (!tpl) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ analysis: 'Not enough data to analyze yet — this report has no ads with spend in the selected period.' })

  const cols = (metrics as MetricKey[]).map(m => METRICS[m]?.label || m)
  const line = (r: any) => `${r.name} — ` + (metrics as MetricKey[]).map(m => {
    const met = METRICS[m]; const v = r.metrics?.[m] ?? 0
    if (met?.format === 'currency') return `${met.label} ${Math.round(v)} ${currency}`
    if (met?.format === 'percent') return `${met.label} ${v.toFixed(1)}%`
    if (met?.format === 'ratio') return `${met.label} ${v.toFixed(2)}x`
    if (met?.format === 'seconds') return `${met.label} ${v.toFixed(1)}s`
    return `${met.label} ${Math.round(v)}`
  }).join(', ')

  const top = rows.slice(0, 15).map(line).join('\n')
  const net = (metrics as MetricKey[]).map(m => `${METRICS[m]?.label || m}: ${netResults?.[m] ?? 0}`).join(', ')

  // Per-chip instructions (Mello quick prompts). Default = the 3-section analysis.
  const TASKS: Record<string, string> = {
    analyze: `Write a tight analysis in 3 short sections using markdown:\n**What's working** — 1-2 bullets naming specific winners and why.\n**What's wasting budget** — 1-2 bullets naming specific under-performers.\n**Do this next** — ONE concrete, specific action (scale X, kill Y, test Z).\nBe specific with names and numbers. Under 130 words total.`,
    brief: `Write a creative brief for the next round of ads, based on the top performers above. Use markdown with:\n**What to double down on** — the winning angle/format/hook and why (name specific creatives).\n**3 new ad concepts** — a numbered list; each = a one-line hook + format + angle to test next.\nBe concrete and production-ready. Under 160 words.`,
    working: `Answer "what's working and what's not" in two markdown sections:\n**Working** — 2-3 bullets, specific winners with the numbers that prove it.\n**Not working** — 2-3 bullets, specific losers with the numbers.\nName creatives/groups explicitly. Under 130 words.`,
    themes: `Look at the creative names and any tags. In markdown, identify the 2-3 recurring themes/angles/messages that show up in the best performers, and 1 theme that's underperforming. Name examples. Under 120 words.`,
    testing: `Propose a concrete A/B testing plan for next week based on this data. Markdown with:\n**Test 1 / Test 2 / Test 3** — each = a hypothesis (what to change and why, referencing a specific winner/loser) + the single metric to judge it on. Be specific and prioritized by expected impact. Under 160 words.`,
    patterns: `Find the shared patterns among the TOP performers here (format, hook, angle, audience, offer). In markdown: **Winning patterns** — 2-3 bullets naming the common traits with the creatives that prove them; **Do more of** — one concrete recommendation. Name specifics. Under 140 words.`,
  }
  const ask = (question || '').toString().trim().slice(0, 400)
  const task = ask
    ? `Answer this question about the report, using only the data above: "${ask}". Be specific with names and numbers, markdown, under 150 words.`
    : (TASKS[mode as string] || TASKS.analyze)

  const prompt = `You are Mello, a sharp performance-marketing analyst for a DTC brand. This is the "${tpl.title}" report (grouped by ${groupBy}, currency ${currency}).

Columns: ${cols.join(', ')}
Net results (all rows): ${net}

Rows (top ${Math.min(rows.length, 15)}):
${top}

${task}
No preamble, no fluff.`

  try {
    const res = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    return NextResponse.json({ analysis: res.content[0]?.text || 'Could not generate analysis.' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Analysis failed' }, { status: 200 })
  }
}
