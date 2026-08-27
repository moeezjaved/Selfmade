/**
 * POST /api/geo/build  { kind: 'llms_txt' | 'schema' | 'fact_sheet' } → generate a crawlability/entity
 * asset (Phase C) as a draft in geo_assets. Copy-to-apply now; auto-apply to Shopify later. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { buildCrawlAsset, type CrawlKind } from '@/lib/geo/crawlability'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { resolveStore } from '@/lib/shopify/client'
import { publishFactSheetPage, applySchemaToTheme, extractJsonLd } from '@/lib/shopify/geo-apply'
import { mdToHtml } from '@/lib/geo/content'
import { getPlanId } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const KINDS: CrawlKind[] = ['llms_txt', 'schema', 'fact_sheet']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)

  // ── APPLY: push a built crawlability/entity asset onto the connected Shopify store. Paid feature. ──
  //   fact_sheet → a live Shopify Page;  schema → JSON-LD in the theme <head>;  llms_txt → not applicable
  //   (must live at site root /llms.txt, which the Admin API can't serve — copy it in manually).
  if (body?.action === 'apply') {
    const id = String(body?.id || '').trim()
    if (!id) return NextResponse.json({ error: 'Missing asset id' }, { status: 400 })
    const store = await resolveStore(admin as any, user.id, brandId)
    if (!store) return NextResponse.json({ error: 'no_store', reason: 'Connect your Shopify store first — I apply these to your store.' }, { status: 400 })
    const owner = await resolveBillingOwner(admin as any, user.id).catch(() => user.id)
    if ((await getPlanId(admin as any, owner).catch(() => 'free' as const)) === 'free') {
      return NextResponse.json({ error: 'upgrade_required', reason: 'Applying to your live store is a paid feature — drafting stays free. Upgrade to apply.' }, { status: 402 })
    }
    const { data: asset } = await admin.from('geo_assets').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    try {
      if (asset.kind === 'llms_txt') {
        return NextResponse.json({ error: 'unsupported', reason: 'llms.txt must live at your site root (yourstore.com/llms.txt). Shopify can’t serve a root file via the API — copy it in from your theme/hosting, or ask your dev to add it.' }, { status: 400 })
      }
      if (asset.kind === 'fact_sheet') {
        const res = await publishFactSheetPage(store as any, { title: asset.title || 'AI fact sheet', bodyHtml: mdToHtml(asset.body_markdown || '') })
        await admin.from('geo_assets').update({ status: 'published', published_url: res.url }).eq('id', id)
        try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin as any, { userId: user.id, brandId: (store as any).brand_id, category: 'content', title: 'Published an AI fact sheet', detail: asset.title, currency: (store as any).currency, meta: { geo_asset_id: id, url: res.url } }) } catch { /* optional */ }
        return NextResponse.json({ ok: true, url: res.url, applied: 'page' }, { status: 200 })
      }
      if (asset.kind === 'schema') {
        const jsonLd = extractJsonLd(asset.body_markdown || '')
        if (!jsonLd) return NextResponse.json({ error: 'no_schema', reason: 'Couldn’t find JSON-LD in this asset — rebuild it and try again.' }, { status: 400 })
        const res = await applySchemaToTheme(store as any, jsonLd)
        const liveUrl = `https://${(store as any).shop_domain}/`
        await admin.from('geo_assets').update({ status: 'published', published_url: liveUrl }).eq('id', id)
        try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin as any, { userId: user.id, brandId: (store as any).brand_id, category: 'content', title: 'Added brand schema to your store', detail: 'JSON-LD in the theme <head>', currency: (store as any).currency, meta: { geo_asset_id: id, themeId: res.themeId } }) } catch { /* optional */ }
        return NextResponse.json({ ok: true, applied: 'theme', alreadyPresent: res.alreadyPresent }, { status: 200 })
      }
      return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      // A missing write_themes / write_content scope surfaces as a 403 — tell the founder how to fix it.
      const scopeHint = /403|scope|access/i.test(msg) ? ' — your Shopify custom app may be missing the write_themes (schema) or write_content (page) permission. Add it in the app’s API scopes and reconnect.' : ''
      return NextResponse.json({ error: 'apply_failed', detail: (msg.slice(0, 160) + scopeHint) }, { status: 500 })
    }
  }

  const kind = body?.kind as CrawlKind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  let txId: string | null = null
  try { txId = (await reserveCredits(admin as any, user.id, 'geo_build')).id }
  catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Building a GEO asset costs credits — top up or upgrade.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const asset = await buildCrawlAsset(admin as any, user.id, brandId, kind)
    await commitCredits(admin as any, txId, { kind: 'geo_build', assetKind: kind }).catch(() => {})
    return NextResponse.json({ asset }, { status: 200 })
  } catch (e) {
    if (txId) await refundCredits(admin as any, txId).catch(() => {})
    return NextResponse.json({ error: 'geo_build_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
