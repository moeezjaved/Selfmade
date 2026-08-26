import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { PLANS, type PlanId } from '@/lib/plans'
import type { User } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const page = parseInt(request.nextUrl.searchParams.get('page') || '1')
  const search = request.nextUrl.searchParams.get('search') || ''
  const perPage = 50

  // List auth users with pagination
  const { data: authData } = await admin.auth.admin.listUsers({ page, perPage })
  const authUsers: User[] = authData?.users || []

  // Get profiles for these users
  const userIds = authUsers.map((u: User) => u.id)
  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, full_name, subscription_status, plan_id, created_at')
    .in('user_id', userIds)

  type Profile = { user_id: string; full_name: string | null; subscription_status: string | null; plan_id: string | null; created_at: string | null }
  const profileMap = Object.fromEntries((profiles || []).map((p: Profile) => [p.user_id, p]))

  // Facebook-connected? Count active Meta ad accounts per user so the list shows who's linked (and how
  // many accounts) at a glance — the thing you want to see next to every user.
  const { data: metaRows } = await admin
    .from('meta_accounts')
    .select('user_id, status')
    .in('user_id', userIds)
  const metaCount: Record<string, number> = {}
  for (const m of (metaRows || [])) {
    if (String((m as any).status) === 'active') metaCount[(m as any).user_id] = (metaCount[(m as any).user_id] || 0) + 1
  }

  // Shopify connected? · SEO active? · #ads · revenue — the at-a-glance "is this user working" columns.
  const [storesRes, geoRes, creativesRes, ordersRes] = await Promise.all([
    admin.from('shopify_stores').select('id, user_id, status').in('user_id', userIds),
    admin.from('geo_assets').select('user_id, status').in('user_id', userIds).eq('status', 'published'),
    admin.from('creative_generations').select('user_id').in('user_id', userIds),
    admin.from('shopify_orders').select('user_id, total_price, currency').in('user_id', userIds),
  ])
  const stores = storesRes.data || []
  const shopifyByUser: Record<string, boolean> = {}
  const storeToUser: Record<string, string> = {}
  for (const s of stores) { shopifyByUser[(s as any).user_id] = true; storeToUser[(s as any).id] = (s as any).user_id }
  // Applied catalog fixes → which users are actively pushing SEO to their live store.
  const storeIds = stores.map((s: any) => s.id)
  const seoByUser: Record<string, boolean> = {}
  for (const g of (geoRes.data || [])) seoByUser[(g as any).user_id] = true   // published a blog
  if (storeIds.length) {
    const { data: applied } = await admin.from('shopify_catalog_drafts').select('store_id').in('store_id', storeIds).eq('status', 'applied')
    for (const a of (applied || [])) { const uid = storeToUser[(a as any).store_id]; if (uid) seoByUser[uid] = true }
  }
  const adsByUser: Record<string, number> = {}
  for (const c of (creativesRes.data || [])) adsByUser[(c as any).user_id] = (adsByUser[(c as any).user_id] || 0) + 1
  const revByUser: Record<string, { total: number; currency: string }> = {}
  for (const o of (ordersRes.data || [])) {
    const uid = (o as any).user_id
    const cur = revByUser[uid] || { total: 0, currency: (o as any).currency || 'USD' }
    cur.total += (typeof (o as any).total_price === 'number' ? (o as any).total_price : parseFloat((o as any).total_price)) || 0
    revByUser[uid] = cur
  }

  let users = authUsers.map((u: User) => {
    const planId = (profileMap[u.id]?.plan_id || 'free') as PlanId
    return {
    id: u.id,
    email: u.email || '',
    full_name: profileMap[u.id]?.full_name || '',
    subscription_status: profileMap[u.id]?.subscription_status || 'trialing',
    plan_id: planId,
    plan_label: PLANS[planId]?.label || planId,   // Free / Creator / Agency / … — the REAL plan
    created_at: profileMap[u.id]?.created_at || u.created_at,
    last_sign_in_at: u.last_sign_in_at || null,
    meta_accounts: metaCount[u.id] || 0,
    meta_connected: (metaCount[u.id] || 0) > 0,
    shopify_connected: !!shopifyByUser[u.id],
    seo_active: !!seoByUser[u.id],
    ads_count: adsByUser[u.id] || 0,
    revenue: revByUser[u.id]?.total || 0,
    revenue_currency: revByUser[u.id]?.currency || 'USD',
    }
  })

  if (search) {
    const q = search.toLowerCase()
    users = users.filter(u => u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
  }

  return NextResponse.json({ users, total: authData?.total || 0 })
}
