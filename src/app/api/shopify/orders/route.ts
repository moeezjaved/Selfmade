/**
 * Shopify orders / true revenue API.
 *   GET  /api/shopify/orders            → revenue summary (30d): revenue, AOV, per-channel, organic (SEO) split
 *   POST { action:'sync', days? }       → pull recent orders from Shopify (read_orders)
 * Brand-scoped. Auto-syncs on first GET if the store has never been order-synced.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { syncOrders, revenueSummary } from '@/lib/shopify/orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function ctx(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return { error: NextResponse.json({ error: 'No Shopify store connected', connected: false }, { status: 400 }) }
  return { admin, store, userId: user.id }
}

export async function GET(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store } = c
  // Auto-sync once if we've never pulled orders for this store.
  const { count } = await admin.from('shopify_orders').select('id', { count: 'exact', head: true }).eq('store_id', store.id)
  if (!count) { try { await syncOrders(admin, store, 90) } catch { /* best-effort */ } }
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 7), 365)
  const summary = await revenueSummary(admin, store, days)
  return NextResponse.json({ connected: true, store: { shop_name: store.shop_name, currency: store.currency }, summary })
}

export async function POST(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store } = c
  const body = await req.json().catch(() => ({}))
  if (body.action === 'sync') {
    const days = Math.min(Math.max(Number(body.days) || 90, 7), 365)
    const res = await syncOrders(admin, store, days)
    const summary = await revenueSummary(admin, store, 30)
    return NextResponse.json({ ok: true, ...res, summary })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
