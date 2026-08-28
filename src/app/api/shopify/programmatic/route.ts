/**
 * Programmatic SEO API.
 *   GET  /api/shopify/programmatic                        → the plan (buildable pages by type) + generated queue
 *   POST { action:'generate', limit?, withImage? }        → generate the next N un-built pages
 *   POST { action:'publish', ids:[...] }                  → bulk-publish drafts to the Shopify blog
 *   POST { action:'discard', ids:[...] }                  → drop drafts
 * Draft-first. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandForAction } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { planPages, existingKeys, generateBatch, publishBatch } from '@/lib/shopify/programmatic'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function ctx(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const { brandId, needsSelection } = await resolveBrandForAction(admin, user.id)
  // "All brands" with 2+ brands → per-brand action; prompt to pick one instead of defaulting.
  if (needsSelection || !brandId) return { error: NextResponse.json({ selectBrand: true }, { status: 200 }) }
  const store = await resolveStore(admin, user.id, brandId)
  const { data: b } = await admin.from('brands').select('name').eq('id', brandId).maybeSingle()
  if (!store) return { error: NextResponse.json({ error: 'connect_shopify', connected: false, brandName: b?.name || '' }, { status: 400 }) }
  return { admin, store, brandId, userId: user.id }
}

export async function GET(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store, brandId, userId } = c
  const plan = await planPages(admin, store, userId)
  const done = await existingKeys(admin, userId, store.brand_id)
  const byType = { guide: 0, collection: 0, comparison: 0 }
  for (const t of plan) byType[t.type]++
  const { data: drafts } = await admin.from('geo_assets')
    .select('id, title, target_prompt, status, published_url, created_at')
    .eq('user_id', userId).eq('brand_id', brandId).eq('kind', 'pseo').order('created_at', { ascending: false }).limit(300)
  const rows: any[] = drafts || []
  return NextResponse.json({
    connected: true,
    store: { shop_name: store.shop_name, shop_domain: store.shop_domain },
    plan: { total: plan.length, byType, generated: done.size, remaining: plan.length - done.size },
    drafts: rows,
    counts: { draft: rows.filter((r) => r.status === 'draft').length, published: rows.filter((r) => r.status === 'published').length },
  })
}

export async function POST(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store, brandId, userId } = c
  const body = await req.json().catch(() => ({}))
  const action = body.action

  if (action === 'generate') {
    const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 12)

    // Pages at Scale is a PAID feature: Free plan hits an upgrade wall (not just a credit top-up), paid
    // plans are charged PER PAGE. Resolve the billing owner's plan first.
    const { getPlanId } = await import('@/lib/entitlements')
    const { resolveBillingOwner } = await import('@/lib/org')
    const owner = await resolveBillingOwner(admin, userId).catch(() => userId)
    const planId = await getPlanId(admin, owner).catch(() => 'free' as const)
    if (planId === 'free') {
      return NextResponse.json({ error: 'plan_limit', upgradeTo: 'starter', reason: 'Pages at Scale is a paid feature — upgrade to build pages in bulk.' }, { status: 402 })
    }

    // Charge PER PAGE: reserve one `programmatic_page` per page up front, then commit only the pages that
    // actually got created and refund the rest. Out of credits → 402 upsell.
    const txIds: string[] = []
    try {
      for (let i = 0; i < limit; i++) txIds.push((await reserveCredits(admin, userId, 'programmatic_page')).id)
    } catch (e) {
      for (const id of txIds) await refundCredits(admin, id).catch(() => {})   // release any we already held
      if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Generating pages costs credits per page — top up to continue.' }, { status: 402 })
      return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
    }
    try {
      const res = await generateBatch(admin, store, userId, limit, body.withImage === true)
      const created = Math.max(0, Math.min(limit, Number((res as any)?.created ?? limit)))
      for (let i = 0; i < txIds.length; i++) {
        if (i < created) await commitCredits(admin, txIds[i], { kind: 'programmatic_page' }).catch(() => {})
        else await refundCredits(admin, txIds[i]).catch(() => {})              // page wasn't created → don't charge for it
      }
      return NextResponse.json({ ok: true, ...res })
    } catch (e) {
      for (const id of txIds) await refundCredits(admin, id).catch(() => {})
      return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
    }
  }
  if (action === 'publish') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []
    if (!ids.length) return NextResponse.json({ error: 'No pages selected' }, { status: 400 })
    const res = await publishBatch(admin, store, userId, ids)
    return NextResponse.json({ ok: true, ...res })
  }
  if (action === 'discard') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []
    await admin.from('geo_assets').delete().in('id', ids).eq('user_id', userId).eq('brand_id', brandId).eq('kind', 'pseo').eq('status', 'draft')
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
