/**
 * GET /api/cron/ads-health — the always-on Meta ads watchdog. For every brand with a connected Meta account,
 * reads account health (recent vs baseline) and drops a Morning-Brief alert for the top issue when something
 * meaningful moved (CPA spike, ROAS drop, fatigue, CPM spike, spend pacing). This is the retention hook —
 * "your CPA jumped 40% today" pulls the founder back. Secured by CRON_SECRET. Cost-capped per run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkAdsHealth } from '@/lib/meta/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const MAX = 40

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

  // Distinct (user, brand) pairs that have a connected Meta account.
  let targets: { userId: string; brandId: string | null }[] = []
  try {
    const { data } = await admin.from('meta_accounts').select('user_id, brand_id').limit(2000)
    const seen = new Set<string>()
    for (const r of (data || []) as any[]) {
      const key = `${r.user_id}|${r.brand_id || ''}`
      if (seen.has(key)) continue
      seen.add(key); targets.push({ userId: String(r.user_id), brandId: r.brand_id ? String(r.brand_id) : null })
    }
  } catch { /* table empty */ }
  targets = targets.slice(0, MAX)

  let checked = 0, alerted = 0
  for (const t of targets) {
    try {
      const health = await checkAdsHealth(admin, t.userId, t.brandId)
      if (!health.connected || !health.issues.length) continue
      checked++
      const top = health.issues[0]
      // one live ads-health alert per user at a time (replace the previous)
      await admin.from('brief_events').delete().eq('user_id', t.userId).eq('kind', 'ads_health').then(() => {}, () => {})
      await admin.from('brief_events').insert({
        user_id: t.userId, kind: 'ads_health', importance: top.severity === 'high' ? 88 : 72,
        title: top.title, body: top.body,
        cta_label: 'See your ads', cta_href: '/mission',
      }).then(() => {}, () => {})
      alerted++
    } catch { /* one brand failing must not stop the run */ }
  }

  return NextResponse.json({ ok: true, checked, alerted, considered: targets.length })
}
