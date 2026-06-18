import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ invoices: [], totalRevenue: 0 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any })

  const invoices = await stripe.invoices.list({ limit: 100, status: 'paid' })
  const allInvoices = invoices.data.map(inv => ({
    id: inv.id,
    amount: inv.amount_paid / 100,
    currency: inv.currency.toUpperCase(),
    status: inv.status,
    customer_email: inv.customer_email || '',
    created: new Date(inv.created * 1000).toISOString(),
    hosted_invoice_url: inv.hosted_invoice_url || '',
  }))

  const totalRevenue = allInvoices.reduce((sum, inv) => sum + inv.amount, 0)

  // Also get failed invoices separately
  const failedInvoices = await stripe.invoices.list({ limit: 20, status: 'open' })
  const failed = failedInvoices.data.map(inv => ({
    id: inv.id,
    amount: inv.amount_due / 100,
    currency: inv.currency.toUpperCase(),
    status: 'failed',
    customer_email: inv.customer_email || '',
    created: new Date(inv.created * 1000).toISOString(),
    hosted_invoice_url: inv.hosted_invoice_url || '',
  }))

  return NextResponse.json({
    invoices: [...allInvoices, ...failed].sort((a, b) => b.created.localeCompare(a.created)),
    totalRevenue,
  })
}
