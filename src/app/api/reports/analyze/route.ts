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

  const { templateKey, metrics, rows, netResults, currency, groupBy } = await req.json()
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

  const prompt = `You are Mello, a sharp performance-marketing analyst for a DTC brand. Analyze this "${tpl.title}" report (grouped by ${groupBy}, currency ${currency}).

Columns: ${cols.join(', ')}
Net results (all rows): ${net}

Rows (top ${Math.min(rows.length, 15)}):
${top}

Write a tight analysis in 3 short sections using markdown:
**What's working** — 1-2 bullets naming specific winners and why.
**What's wasting budget** — 1-2 bullets naming specific under-performers.
**Do this next** — ONE concrete, specific action (scale X, kill Y, test Z).
Be specific with names and numbers. No preamble, no fluff, under 130 words total.`

  try {
    const res = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    return NextResponse.json({ analysis: res.content[0]?.text || 'Could not generate analysis.' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Analysis failed' }, { status: 200 })
  }
}
