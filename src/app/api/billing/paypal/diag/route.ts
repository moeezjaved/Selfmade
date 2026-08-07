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
  const { data } = await admin.from('paypal_orders')
    .select('basket_id, kind, plan, amount, status, err_code, paypal_order_id, card_brand, card_last4, created_at, paid_at')
    .order('created_at', { ascending: false }).limit(10)
  return NextResponse.json({ ok: true, orders: data || [] })
}
