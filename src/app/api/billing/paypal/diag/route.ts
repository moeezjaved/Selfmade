/**
 * GET /api/billing/paypal/diag?secret=<CRON_SECRET>
 * Diagnostic — returns the most recent PayPal orders (basket, kind, status, err_code, timestamps) so
 * we can see the real decline reason without DB access. CRON_SECRET-gated. Safe: read-only, no secrets.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { IS_LIVE, PAYPAL_BASE } from '@/lib/paypal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  // select('*') so this never fails on a not-yet-applied migration (145 card columns).
  const { data, error } = await admin.from('paypal_orders')
    .select('*').order('created_at', { ascending: false }).limit(10)
  // Also report whether the mig-145 card columns exist (surfaces "migration not applied").
  const { error: colErr } = await admin.from('paypal_orders').select('card_brand').limit(1)
  // Recent PayPal subscriptions — confirm the vaulted card is saved for auto-renewal.
  const { data: subs } = await admin.from('subscriptions')
    .select('owner_id, plan, status, provider, current_period_end, card_brand, card_last4, paypal_vault_id')
    .eq('provider', 'paypal').order('updated_at', { ascending: false }).limit(5)

  return NextResponse.json({
    ok: true,
    environment: IS_LIVE ? 'LIVE' : 'sandbox',
    paypal_base: PAYPAL_BASE,
    mig145_card_columns: colErr ? `MISSING (${colErr.message})` : 'present',
    tableError: error?.message || null,
    orders: (data || []).map((o: any) => ({ basket: o.basket_id, kind: o.kind, status: o.status, err_code: o.err_code, order_id: o.paypal_order_id, card: o.card_last4 ? `${o.card_brand} ····${o.card_last4}` : null, created: o.created_at })),
    subscriptions: (subs || []).map((s: any) => ({ plan: s.plan, status: s.status, card: s.card_last4 ? `${s.card_brand} ····${s.card_last4}` : null, vault_saved: !!s.paypal_vault_id, renews: s.current_period_end })),
  })
}
