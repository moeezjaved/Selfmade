/**
 * Shopify Catalog cluster API.
 *   GET  /api/shopify/catalog                 → connected store + gap counts + open drafts (grouped by agent)
 *   POST /api/shopify/catalog { action:'draft',  agent, limit } → run an agent, produce drafts (no writes)
 *   POST /api/shopify/catalog { action:'apply', draftIds:[...] } → write approved drafts to Shopify
 *   POST /api/shopify/catalog { action:'skip',  draftIds:[...] } → dismiss drafts
 * Brand-scoped, approve-mode. Nothing hits the store except 'apply'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { generateDrafts, applyDrafts, catalogTargets, type Agent } from '@/lib/shopify/catalog'
import { catalogHealth } from '@/lib/shopify/sync'
import { getPlanId, isGrandfathered } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const AGENTS: Agent[] = ['seo', 'description', 'alt', 'title', 'tags', 'collection', 'page']
const isAgent = (a: any): a is Agent => AGENTS.includes(a)

async function ctx(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return { error: NextResponse.json({ error: 'No Shopify store connected', connected: false }, { status: 400 }) }
  return { admin, store, user }
}

export async function GET(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store } = c
  const health = await catalogHealth(admin, store.id).catch(() => null)
  const { data: drafts } = await admin.from('shopify_catalog_drafts')
    .select('id, product_gid, product_title, agent, proposal, status, error, created_at')
    .eq('store_id', store.id).eq('status', 'draft').order('created_at', { ascending: false }).limit(500)
  const byAgent: Record<string, any[]> = { seo: [], description: [], alt: [], title: [], tags: [], collection: [], page: [] }
  for (const d of (drafts || [])) (byAgent[d.agent] ||= []).push(d)
  const counts: Record<string, number> = {}
  for (const a of AGENTS) counts[a] = (byAgent[a] || []).length
  return NextResponse.json({
    connected: true,
    store: { shop_domain: store.shop_domain, shop_name: store.shop_name, currency: store.currency },
    health, drafts: byAgent, counts,
  })
}

export async function POST(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store, user } = c
  const body = await req.json().catch(() => ({}))
  const action = body.action

  if (action === 'draft') {
    if (!isAgent(body.agent)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50)
    const res = await generateDrafts(admin, store, body.agent, limit)
    return NextResponse.json({ ok: true, agent: body.agent, ...res })
  }

  if (action === 'apply' || action === 'skip') {
    const ids = Array.isArray(body.draftIds) ? body.draftIds.map(String).slice(0, 500) : []
    if (!ids.length) return NextResponse.json({ error: 'No drafts selected' }, { status: 400 })
    if (action === 'skip') {
      await admin.from('shopify_catalog_drafts').update({ status: 'skipped' }).in('id', ids).eq('store_id', store.id).eq('status', 'draft')
      return NextResponse.json({ ok: true, skipped: ids.length })
    }
    // Free to PREVIEW (draft), pay to APPLY: pushing changes live to Shopify needs a paid plan.
    // Existing users (created before the cutoff) are grandfathered and keep applying free.
    const owner = await resolveBillingOwner(admin, user.id).catch(() => user.id)
    if (!isGrandfathered(user.created_at) && (await getPlanId(admin, owner)) === 'free') {
      return NextResponse.json({ error: 'upgrade_required', reason: 'Applying fixes to your live store is a paid feature — drafting stays free. Upgrade to push these live.' }, { status: 402 })
    }
    const res = await applyDrafts(admin, store, ids)
    const health = await catalogHealth(admin, store.id).catch(() => null)
    return NextResponse.json({ ok: true, ...res, health })
  }

  if (action === 'targets') {
    if (!isAgent(body.agent)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
    const t = await catalogTargets(admin, store.id, body.agent, 50)
    return NextResponse.json({ ok: true, count: t.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
