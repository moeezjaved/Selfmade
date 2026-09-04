/**
 * POST /api/builder/publish { pageId } — re-render the saved draft's body from its content + render_opts
 * and publish it into the merchant's Shopify as a native Page. Updates the row to status=published.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveStore } from '@/lib/shopify/client'
import { getTemplate } from '@/lib/builder/templates'
import { assembleShopifyBody } from '@/lib/builder/assemble'
import { publishBuilderPage } from '@/lib/builder/publish'
import type { RenderOpts } from '@/lib/builder/types'

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
  if (!tpl) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })

  const store = await resolveStore(admin, user.id, row.brand_id)
  if (!store) return NextResponse.json({ error: 'no_store', message: 'Connect a Shopify store for this brand first.' }, { status: 400 })

  const opts: RenderOpts = row.render_opts || { productName: row.product_name || 'Product', ctaHref: row.cta_href || '#' }
  const title = String((row.content && row.content.headline) || row.product_name || 'Landing page').replace(/\*+/g, '').trim().slice(0, 250)
  // Respect the visual editor: a hand-edited page publishes its edited_html body (the "page is the
  // document" source of truth); an un-edited page re-renders from its slots as before.
  const body = assembleShopifyBody(tpl, row.content || {}, opts, row.edited_html)

  let pub
  try {
    pub = await publishBuilderPage(store, { title, bodyHtml: body, published: true, themeId, themeLive })
  } catch (e: any) {
    await admin.from('builder_pages').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', pageId)
    return NextResponse.json({ error: e?.message || 'publish_failed' }, { status: 502 })
  }

  await admin.from('builder_pages').update({
    status: 'published', shopify_page_id: String(pub.pageId), shopify_url: pub.url, updated_at: new Date().toISOString(),
  }).eq('id', pageId)

  return NextResponse.json({ url: pub.url, handle: pub.handle, previewUrl: pub.previewUrl })
}
