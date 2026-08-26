/**
 * GET /api/admin/site/[domain] — EVERYTHING we know about one website, keyed by the site itself.
 * The website is the spine: its free audit (always, even for anonymous scanners), whether anyone
 * claimed it, and — if a founder connected it — their brand workspace + owner. Admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { normalizeDomain } from '@/lib/audit/scan'
import { getPlanId } from '@/lib/entitlements'
import { PLANS } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { domain: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const domain = normalizeDomain(decodeURIComponent(params.domain || ''))
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })
  const admin = createAdminClient() as any
  const root = domain.replace(/^www\./, '')

  // The audit (unique per domain).
  const { data: scan } = await admin.from('audit_scans')
    .select('domain, site_name, category, score, result, claimed_by, created_at').eq('domain', domain).maybeSingle()

  // Brands whose website is this domain — the founders who actually built a workspace on this site.
  const { data: brandRows } = await admin.from('brands')
    .select('id, name, website, user_id, brand_kit, created_at').ilike('website', `%${root}%`)
  const brands = (brandRows || []).filter((b: any) => normalizeDomain(String(b.website || '')).replace(/^www\./, '') === root)

  // Resolve the owners (claimant + brand owners) to emails.
  const ownerIds = Array.from(new Set([scan?.claimed_by, ...brands.map((b: any) => b.user_id)].filter(Boolean)))
  const emailById: Record<string, string> = {}
  await Promise.all(ownerIds.map(async (id: string) => {
    try { const { data } = await admin.auth.admin.getUserById(id); if (data?.user) emailById[id] = data.user.email || '' } catch { /* skip */ }
  }))

  // A light workspace summary per matching brand (deep detail lives on the user page).
  const workspaces = await Promise.all(brands.map(async (b: any) => {
    const kit = (b.brand_kit && typeof b.brand_kit === 'object') ? b.brand_kit : {}
    const ads = kit.adsStudio || {}
    const [{ count: adsCount }, storeRes, planId] = await Promise.all([
      admin.from('creative_generations').select('id', { count: 'exact', head: true }).eq('brand_id', b.id),
      admin.from('shopify_stores').select('shop_domain, status').eq('brand_id', b.id).maybeSingle(),
      getPlanId(admin, b.user_id).catch(() => 'free' as const),
    ])
    return {
      brand_id: b.id, name: b.name, user_id: b.user_id, owner_email: emailById[b.user_id] || '',
      plan_label: PLANS[planId as keyof typeof PLANS]?.label || 'Free',
      shopify: storeRes.data ? { connected: true, shop_domain: storeRes.data.shop_domain, status: storeRes.data.status } : { connected: false },
      kb_present: Array.isArray(ads.facts) && ads.facts.length > 0,
      products: (ads.products?.data?.products || []).length,
      templates: Array.isArray(ads.templates) ? ads.templates.length : 0,
      audiences: (ads.audiences?.data?.audiences || []).length,
      ads_count: adsCount || 0,
    }
  }))

  return NextResponse.json({
    domain,
    audit: scan ? { site_name: scan.site_name, category: scan.category, score: scan.score, result: scan.result, created_at: scan.created_at } : null,
    claimed: !!scan?.claimed_by,
    claimant: scan?.claimed_by ? { user_id: scan.claimed_by, email: emailById[scan.claimed_by] || '' } : null,
    workspaces,
  })
}
