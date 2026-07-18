import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthUsers } from '@/lib/admin/users'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

/**
 * Admin payments — subscription invoices (Stripe) + one-time top-up purchases (DB). The old version
 * read ONLY Stripe subscription invoices, so it showed $0 revenue while real top-up purchases existed
 * (top-ups are one-time PaymentIntents — they don't create invoices). Now both are merged into revenue.
 */
export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows: any[] = []
  let totalRevenue = 0

  // ── Subscription invoices (Stripe) ──
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any })
      const paid = await stripe.invoices.list({ limit: 100, status: 'paid' })
      for (const inv of paid.data) {
        const amount = inv.amount_paid / 100
        rows.push({ id: inv.id, type: 'subscription', amount, currency: inv.currency.toUpperCase(), status: inv.status, customer_email: inv.customer_email || '', created: new Date(inv.created * 1000).toISOString(), hosted_invoice_url: inv.hosted_invoice_url || '' })
        totalRevenue += amount
      }
      const open = await stripe.invoices.list({ limit: 20, status: 'open' })
      for (const inv of open.data) {
        rows.push({ id: inv.id, type: 'subscription', amount: inv.amount_due / 100, currency: inv.currency.toUpperCase(), status: 'failed', customer_email: inv.customer_email || '', created: new Date(inv.created * 1000).toISOString(), hosted_invoice_url: inv.hosted_invoice_url || '' })
      }
    } catch { /* Stripe unreachable → still return the top-ups below */ }
  }

  // ── One-time top-up purchases (DB) — the revenue the invoice-only view missed ──
  try {
    const admin = createAdminClient()
    const { data: topups } = await admin.from('topup_purchases')
      .select('id, owner_id, amount_usd, credits, created_at')
      .order('created_at', { ascending: false }).limit(200)
    const authUsers = (topups && topups.length) ? await getAuthUsers(admin) : new Map()
    for (const t of (topups || []) as any[]) {
      const amount = Number(t.amount_usd) || 0
      rows.push({
        id: t.id, type: 'topup', amount, currency: 'USD', status: 'paid',   // 'paid' = the string the page counts/greens as Success
        customer_email: (authUsers.get(t.owner_id) as any)?.email || '',
        created: new Date(t.created_at).toISOString(), hosted_invoice_url: '', credits: t.credits,
      })
      totalRevenue += amount
    }
  } catch { /* topup_purchases unreachable → skip */ }

  return NextResponse.json({
    invoices: rows.sort((a, b) => b.created.localeCompare(a.created)),
    totalRevenue,
  })
}
