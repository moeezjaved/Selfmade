/**
 * POST /api/billing/paypal/setup?secret=<CRON_SECRET>
 * One-time helper: creates the PayPal Product + billing Plans for each paid tier (Creator/Agency,
 * monthly + annual) and returns the plan ids to paste into Vercel env as PAYPAL_PLAN_<PLAN>_<CYCLE>.
 * Gated by CRON_SECRET so it can't be triggered by the public. Safe to re-run — it just mints new
 * plans (PayPal has no "get-or-create"); use the newest ids. Prices come from src/lib/plans.ts.
 *
 * Usage (once, after setting PAYPAL_CLIENT_ID/SECRET/ENV in Vercel):
 *   curl -X POST "https://tryselfmade.ai/api/billing/paypal/setup?secret=$CRON_SECRET"
 */
import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PRICING_PLANS } from '@/lib/plans'
import { paypalConfigured, planEnvKey, createProduct, createPlan } from '@/lib/paypal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('x-setup-secret') || ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!paypalConfigured()) return NextResponse.json({ error: 'not_configured', message: 'Set PAYPAL_CLIENT_ID and PAYPAL_SECRET first.' }, { status: 400 })

  try {
    const productId = await createProduct('Selfmade', 'Selfmade — your AI marketing company')
    const env: Record<string, string> = {}
    // Only mint plans for the tiers that are actually sold (PRICING_PLANS). Add 'business' here if
    // you re-enable Agency self-serve. Both cycles so annual is ready when you turn it on.
    const tiers = Array.from(new Set([...PRICING_PLANS, 'starter'])) as (keyof typeof PLANS)[]
    for (const tier of tiers) {
      const pl = PLANS[tier]
      if (!pl || pl.priceMonthly <= 0) continue
      const monthlyId = await createPlan({ productId, name: `Selfmade ${pl.label} — Monthly`, cycle: 'monthly', totalUsd: pl.priceMonthly })
      env[planEnvKey(tier, 'monthly')] = monthlyId
      const annualId = await createPlan({ productId, name: `Selfmade ${pl.label} — Annual`, cycle: 'annual', totalUsd: pl.priceAnnualMonthly * 12 })
      env[planEnvKey(tier, 'annual')] = annualId
    }
    return NextResponse.json({
      ok: true,
      productId,
      env,
      next: 'Add each key/value in `env` to Vercel (Production), then redeploy. Set NEXT_PUBLIC_PAYMENTS_PROVIDER=paypal when ready to cut over.',
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'setup_failed', message: String(e?.message || e) }, { status: 502 })
  }
}
