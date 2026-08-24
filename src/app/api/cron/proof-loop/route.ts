/**
 * GET /api/cron/proof-loop — the proof loop. Weekly, for every brand with a Shopify store + ledger wins, it
 * banks the REAL organic revenue lift against the organic moves (content/pages/catalog/SEO/GEO) and — when
 * it banks something new — drops a "here's the receipt" Morning-Brief alert. This is the retention killer:
 * grey projected numbers turn green because real money showed up. Secured by CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runProofLoop } from '@/lib/mello/proof'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const MAX = 60

function authorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get('secret')
  const auth = req.headers.get('authorization')
  const cron = process.env.CRON_SECRET
  if (!cron) return true
  return secret === cron || auth === `Bearer ${cron}`
}

function money(n: number, cur?: string | null) {
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur ? cur + ' ' : '$')
  return `${sym}${(n || 0).toLocaleString()}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  // Brands that have ledger wins (only these can have anything to bank). Dedup by (user, brand).
  let targets: { userId: string; brandId: string | null }[] = []
  try {
    const { data } = await admin.from('wins').select('user_id, brand_id').limit(4000)
    const seen = new Set<string>()
    for (const r of (data || []) as any[]) {
      const key = `${r.user_id}|${r.brand_id || ''}`
      if (seen.has(key)) continue
      seen.add(key); targets.push({ userId: String(r.user_id), brandId: r.brand_id ? String(r.brand_id) : null })
    }
  } catch { /* empty */ }
  targets = targets.slice(0, MAX)

  let ran = 0, banked = 0
  for (const t of targets) {
    try {
      const res = await runProofLoop(admin, t.userId, t.brandId)
      if (!res.ran) continue
      ran++
      if (res.newlyBanked > 0) {
        banked++
        await admin.from('brief_events').delete().eq('user_id', t.userId).eq('kind', 'proof_receipt').then(() => {}, () => {})
        await admin.from('brief_events').insert({
          user_id: t.userId, kind: 'proof_receipt', importance: 82,
          title: `Your organic work just banked ${money(res.newlyBanked, res.currency)}.`,
          body: `Real organic revenue is up ${money(res.lift, res.currency)} since you started publishing and fixing your store — verified from your orders, not an estimate. It's in your ledger.`,
          cta_label: 'See your growth', cta_href: '/grow',
        }).then(() => {}, () => {})
      }
    } catch { /* one brand must not stop the run */ }
  }

  return NextResponse.json({ ok: true, ran, banked, considered: targets.length })
}
