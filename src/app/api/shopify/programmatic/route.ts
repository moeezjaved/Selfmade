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
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { planPages, existingKeys, generateBatch, publishBatch } from '@/lib/shopify/programmatic'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
  const { admin, store, userId } = c
  const plan = await planPages(admin, store, userId)
  const done = await existingKeys(admin, userId, store.brand_id)
  const byType = { guide: 0, collection: 0, comparison: 0 }
  for (const t of plan) byType[t.type]++
  const { data: drafts } = await admin.from('geo_assets')
    .select('id, title, target_prompt, status, published_url, created_at')
    .eq('user_id', userId).eq('kind', 'pseo').order('created_at', { ascending: false }).limit(300)
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
  const { admin, store, userId } = c
  const body = await req.json().catch(() => ({}))
  const action = body.action

  if (action === 'generate') {
    const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 12)
    const res = await generateBatch(admin, store, userId, limit, body.withImage === true)
    return NextResponse.json({ ok: true, ...res })
  }
  if (action === 'publish') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []
    if (!ids.length) return NextResponse.json({ error: 'No pages selected' }, { status: 400 })
    const res = await publishBatch(admin, store, userId, ids)
    return NextResponse.json({ ok: true, ...res })
  }
  if (action === 'discard') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []
    await admin.from('geo_assets').delete().in('id', ids).eq('user_id', userId).eq('kind', 'pseo').eq('status', 'draft')
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
