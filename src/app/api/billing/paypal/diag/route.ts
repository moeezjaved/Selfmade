/**
 * GET /api/billing/paypal/diag?secret=<CRON_SECRET>
 * Diagnostic — returns the most recent PayPal orders (basket, kind, status, err_code, timestamps) so
 * we can see the real decline reason without DB access. CRON_SECRET-gated. Safe: read-only, no secrets.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

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
  return NextResponse.json({
    ok: true,
    mig145_card_columns: colErr ? `MISSING (${colErr.message})` : 'present',
    tableError: error?.message || null,
    orders: (data || []).map((o: any) => ({ basket: o.basket_id, kind: o.kind, status: o.status, err_code: o.err_code, order_id: o.paypal_order_id, created: o.created_at })),
  })
}
