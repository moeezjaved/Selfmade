/**
 * GET /api/discovery/patterns?niche=Supplements[&topic=hair+loss]
 *
 * Pattern Detection — "creative intelligence, not ad spying." Aggregates the
 * Creative DNA among WINNING-tier ads in a niche (optionally narrowed to a topic)
 * and returns what REPEATS: format mix (UGC vs studio), dominant visual styles,
 * hooks, emotions, angles, run-time, common offers. No new AI — pure aggregation
 * over the DNA + the Winner Score we already compute.
 *
 * Creatives are deduped by hash so one reused winner doesn't dominate a pattern.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createReadClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const CAP = 5000

type Row = {
  ad_id: string; image_hash: string | null; video_hash: string | null; format: string | null
  days_running: number | null; niche: string | null; hook_type: string | null
  emotion: string[] | null; angle: string | null; tone: string | null; persona: string | null
  cta: string | null; format_style: string | null; visual_style: string | null
  on_screen_text: string | null; usp: string | null; topics: string[] | null
}

// top-N of a scalar field, as {value, count, pct}
function topScalar(rows: Row[], pick: (r: Row) => string | null | undefined, n = 6) {
  const m: Record<string, number> = {}
  let total = 0
  for (const r of rows) { const v = pick(r); if (v) { m[v] = (m[v] || 0) + 1; total++ } }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([value, count]) => ({ value, count, pct: total ? Math.round((100 * count) / total) : 0 }))
}
function topArray(rows: Row[], pick: (r: Row) => string[] | null | undefined, n = 6) {
  const m: Record<string, number> = {}
  let denom = 0
  for (const r of rows) { const arr = pick(r) || []; if (arr.length) denom++; for (const v of arr) if (v) m[v] = (m[v] || 0) + 1 }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([value, count]) => ({ value, count, pct: denom ? Math.round((100 * count) / denom) : 0 }))
}

export async function GET(req: NextRequest) {
  const admin = createReadClient()
  const niche = (req.nextUrl.searchParams.get('niche') || '').trim()
  const topic = (req.nextUrl.searchParams.get('topic') || '').trim().toLowerCase()

  // Pull winning-tier ads (optionally in a niche), with their Creative DNA.
  const rows: Row[] = []
  let cursor = ''
  const cols = 'ad_id,image_hash,video_hash,format,days_running,niche,hook_type,emotion,angle,tone,persona,cta,format_style,visual_style,on_screen_text,usp,topics'
  while (rows.length < CAP) {
    let q = admin.from('discovery_ads_index').select(cols)
      .eq('performance_tier', 'winning').order('ad_id', { ascending: true }).limit(1000)
    if (niche) q = q.eq('niche', niche)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || !data.length) break
    rows.push(...(data as Row[]))
    cursor = (data[data.length - 1] as Row).ad_id
    if (data.length < 1000) break
  }

  // Optional topic narrowing (matches topics tag, on-screen text, or usp).
  let pool = rows
  if (topic) {
    pool = rows.filter(r =>
      (r.topics || []).some(t => (t || '').toLowerCase().includes(topic)) ||
      (r.on_screen_text || '').toLowerCase().includes(topic) ||
      (r.usp || '').toLowerCase().includes(topic))
  }

  // Dedup by creative hash so a reused winner counts once.
  const seen = new Set<string>()
  const uniq: Row[] = []
  for (const r of pool) {
    const k = r.image_hash || r.video_hash || r.ad_id
    if (seen.has(k)) continue
    seen.add(k); uniq.push(r)
  }

  // Run-time buckets.
  const rt = { '0–7d': 0, '7–30d': 0, '30–90d': 0, '90d+': 0 }
  for (const r of uniq) { const d = r.days_running || 0; if (d < 7) rt['0–7d']++; else if (d < 30) rt['7–30d']++; else if (d < 90) rt['30–90d']++; else rt['90d+']++ }
  const rtTotal = uniq.length || 1
  const runtime = Object.entries(rt).map(([value, count]) => ({ value, count, pct: Math.round((100 * count) / rtTotal) }))

  return NextResponse.json({
    niche: niche || 'All niches',
    topic: topic || null,
    sampleSize: uniq.length,
    patterns: {
      format_style: topScalar(uniq, r => r.format_style),
      visual_style: topScalar(uniq, r => r.visual_style),
      format: topScalar(uniq, r => r.format),
      hook_type: topScalar(uniq, r => r.hook_type),
      emotion: topArray(uniq, r => r.emotion),
      angle: topScalar(uniq, r => r.angle),
      tone: topScalar(uniq, r => r.tone),
      persona: topScalar(uniq, r => r.persona, 5),
      cta: topScalar(uniq, r => r.cta, 5),
      runtime,
    },
    // a few real on-screen hooks/offers from this set (evidence)
    sampleHooks: uniq.map(r => r.on_screen_text).filter(t => t && t.length > 8).slice(0, 8),
  })
}
