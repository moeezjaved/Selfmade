/**
 * POST /api/builder/publish { pageId } — re-render the saved draft's body from its content + render_opts
 * and publish it into the merchant's Shopify as a native Page. Updates the row to status=published.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveStore, shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'
import { getTemplate } from '@/lib/builder/templates'
import { bodyHtml } from '@/lib/builder/assemble'
import { paletteOverrideCss } from '@/lib/builder/palettes'
import { publishToTheme, type ThemeTarget } from '@/lib/builder/publish-theme'
import { renderDocForPublish, type RenderProduct } from '@/lib/builder/render'
import type { PageDoc } from '@/lib/builder/schema'
import type { RenderOpts, PageTemplate } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const pageId = String(b?.pageId || '')
  if (!pageId) return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
  const themeId = b?.themeId != null ? Number(b.themeId) : null
  const themeLive = b?.themeLive === true

  const admin = createAdminClient()
  const { data: row } = await admin.from('builder_pages').select('*').eq('id', pageId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const tpl = getTemplate(row.template_id)
  // The advanced editor's PageDoc is a source of truth on its own — publish it even for a page whose
  // template isn't in code. Only require a template when there's no doc to render from.
  const rowDoc = row.doc as PageDoc | undefined
  const hasDoc = !!rowDoc && Array.isArray(rowDoc.sections) && rowDoc.sections.length > 0
  if (!tpl && !hasDoc) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })

  const store = await resolveStore(admin, user.id, row.brand_id)
  if (!store) return NextResponse.json({ error: 'no_store', message: 'Connect a Shopify store for this brand first.' }, { status: 400 })

  const opts: RenderOpts = row.render_opts || { productName: row.product_name || 'Product', ctaHref: row.cta_href || '#' }
  const title = String((row.content && row.content.headline) || row.product_name || 'Landing page').replace(/\*+/g, '').trim().slice(0, 250)

  const kind = ((tpl as PageTemplate | undefined)?.type || row.type || 'advertorial') as PageTemplate['type']
  // EVERY template publishes into the THEME as native sections (product/home replace the PDP/home;
  // advertorial/listicle become a native page-template on a Shopify Page) — so all four types are edited
  // the same way in Shopify's customizer with the same settings panels.
  const target = (['this', 'selected', 'store'].includes(b?.target) ? b.target : 'this') as ThemeTarget
  const productIds: string[] = Array.isArray(b?.productIds) && b.productIds.length
    ? b.productIds.map((x: any) => String(x))
    : (row.product_id ? [String(row.product_id)] : [])

  // A product page built from an imported / external (AliExpress/Amazon/…) URL has no Shopify product yet,
  // so the template would be assigned to ZERO products and the link would fall back to the store home.
  // Create the product in Shopify Admin (title/images/description/price) and bind the page to it, so the
  // result is a REAL, connected product page. Idempotent: only when a product page has no bound product.
  if (kind === 'product' && !productIds.length) {
    const created = await createShopifyProduct(store, { title, content: row.content || {}, opts, doc: rowDoc }).catch(() => null)
    if (created?.id) {
      productIds.push(created.id)
      await admin.from('builder_pages').update({ product_id: created.id, updated_at: new Date().toISOString() }).eq('id', pageId)
    }
  }
  // Source of truth for the published HTML:
  //   1. the advanced editor's PageDoc (rendered by the one runtime → native sections), else
  //   2. the visual editor's edited_html, else
  //   3. the template rendered from its filled slots.
  let body: string, css: string
  if (hasDoc) {
    const product: RenderProduct = {
      title: opts.productName, price: opts.priceLabel, image: opts.productImage || null,
      rating: opts.rating?.stars, reviewCount: opts.rating?.countLabel ? parseInt(String(opts.rating.countLabel).replace(/[^\d]/g, ''), 10) || undefined : undefined,
    }
    const r = renderDocForPublish(rowDoc!, product)
    body = r.body
    css = `${r.css}${paletteOverrideCss((opts as any).paletteId) || ''}`
  } else {
    body = bodyHtml(tpl!, row.content || {}, opts, row.edited_html)
    css = `${tpl!.css}${paletteOverrideCss((opts as any).paletteId) || ''}`
  }
  try {
    const pub = await publishToTheme(store, { pageId, kind, title, css, body, target, productIds, shopifyPageId: row.shopify_page_id ? String(row.shopify_page_id) : null, themeId, themeLive })
    if (pub.needsScopes) {
      return NextResponse.json({ error: 'needs_theme_scopes', message: 'Publishing pages needs theme access. Reconnect your store with read_themes + write_themes to continue.' }, { status: 409 })
    }
    const upd: any = { status: 'published', shopify_url: pub.url, updated_at: new Date().toISOString() }
    if (pub.shopifyPageId) upd.shopify_page_id = String(pub.shopifyPageId)
    await admin.from('builder_pages').update(upd).eq('id', pageId)
    return NextResponse.json({ url: pub.url, previewUrl: pub.previewUrl, sections: pub.sections, mode: 'theme', target })
  } catch (e: any) {
    await admin.from('builder_pages').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', pageId)
    return NextResponse.json({ error: e?.message || 'publish_failed' }, { status: 502 })
  }
}

/** Create a real Shopify product from an imported/external product's data so the generated page can bind to
 * it (title, images, description, price/compare-at). Returns the new product's gid + handle. */
async function createShopifyProduct(
  store: StoreRow,
  src: { title: string; content: Record<string, any>; opts: RenderOpts; doc?: PageDoc },
): Promise<{ id: string; handle: string } | null> {
  const c = src.content || {}
  const num = (v: any) => { const n = String(v ?? '').replace(/[^\d.]/g, ''); return n && Number.isFinite(Number(n)) ? n : '' }
  // Images: the imported photos live on the doc's productRef, plus any image URLs in the page content.
  const imgs: string[] = []
  const pushImg = (u?: any) => { const s = String(u ?? '').trim(); if (/^https?:\/\//.test(s) && !imgs.includes(s)) imgs.push(s) }
  pushImg(src.opts.productImage)
  const ip = (src.doc as any)?.productRef?.importedProduct
  if (Array.isArray(ip?.images)) ip.images.forEach(pushImg)
  for (const v of Object.values(c)) {
    if (typeof v === 'string') pushImg(v)
    else if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object') { pushImg((it as any).image); pushImg((it as any).thumb) }
  }
  const description = String(ip?.description || c.subhead || c.hero_subline || c.description || '').replace(/\*\*/g, '').trim()
  const price = num(src.opts.priceLabel) || num(ip?.price) || '0.00'
  const compareAt = num(c.compare_at) || num(ip?.compareAtPrice)
  const productBody = {
    product: {
      title: (src.title || src.opts.productName || 'Imported product').slice(0, 250),
      body_html: description ? `<p>${description}</p>` : '',
      status: 'active',
      images: imgs.slice(0, 12).map((s) => ({ src: s })),
      variants: [{ price, ...(compareAt ? { compare_at_price: compareAt } : {}) }],
    },
  }
  const cr = await shopifyRest(store.shop_domain, tokenFor(store), 'products.json', { method: 'POST', body: productBody })
  const p = cr?.product
  if (!p?.id) return null
  return { id: `gid://shopify/Product/${p.id}`, handle: String(p.handle || '') }
}
