/**
 * GET /api/cron/geo-monitor → the always-on GEO agent. Weekly, re-runs the AI-citation check for every
 * brand that opted into GEO (has geo_prompts), so the share-of-voice trend fills on its own, and drops a
 * Morning-Brief alert when it moves meaningfully. Secured by CRON_SECRET. Cost-capped per run.
 *
 * Reuses each brand's stored questions (no re-derive) → each sweep is just the engine calls.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runGeoSweep } from '@/lib/geo/monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const MAX_BRANDS = 15   // bound the LLM cost per run

function authorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get('secret')
  const auth = req.headers.get('authorization')
  const cron = process.env.CRON_SECRET
  if (!cron) return true
  return secret === cron || auth === `Bearer ${cron}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  // opted-in brands = those with active GEO questions; dedupe by (user, brand)
  let targets: { userId: string; brandId: string | null }[] = []
  try {
    const { data } = await admin.from('geo_prompts').select('user_id, brand_id').eq('active', true).limit(2000)
    const seen = new Set<string>()
    for (const r of (data || []) as any[]) {
      const key = `${r.user_id}|${r.brand_id || ''}`
      if (seen.has(key)) continue
      seen.add(key); targets.push({ userId: String(r.user_id), brandId: r.brand_id ? String(r.brand_id) : null })
    }
  } catch { /* table empty */ }
  targets = targets.slice(0, MAX_BRANDS)

  let checked = 0, alerted = 0
  for (const t of targets) {
    try {
      // previous score (before this run) for the delta
      let pq = admin.from('geo_audit').select('score').eq('user_id', t.userId).order('created_at', { ascending: false }).limit(1)
      if (t.brandId) pq = pq.eq('brand_id', t.brandId)
      const { data: prev } = await pq.maybeSingle()
      const prevScore = typeof prev?.score === 'number' ? prev.score : null

      const status = await runGeoSweep(admin, t.userId, t.brandId)   // stores a fresh geo_audit
      if (!status.hasData) continue
      checked++
      const now = status.score

      if (prevScore != null && Math.abs(now - prevScore) >= 5) {
        const up = now > prevScore
        try {
          await admin.from('brief_events').delete().eq('user_id', t.userId).eq('kind', 'geo_visibility').then(() => {}, () => {})
          await admin.from('brief_events').insert({
            user_id: t.userId, kind: 'geo_visibility', importance: up ? 70 : 78,
            title: up ? `You’re showing up more in AI answers — ${now}% share of voice.` : `Your AI share of voice slipped to ${now}%.`,
            body: up ? `Up from ${prevScore}%. Whatever you published is working — keep winning the answer gaps.` : `Down from ${prevScore}% — a rival is gaining. Check the gaps and publish the answer pages.`,
            cta_label: 'See your AI visibility', cta_href: '/mission/geo',
          }).then(() => {}, () => {})
          alerted++
        } catch { /* best-effort */ }
      }
    } catch { /* one brand failing must not stop the run */ }
  }

  return NextResponse.json({ ok: true, checked, alerted, considered: targets.length })
}
