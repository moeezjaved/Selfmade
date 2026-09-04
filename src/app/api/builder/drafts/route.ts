/**
 * GET /api/builder/drafts — the user's saved/published pages (for a "Your pages" list).
 * GET /api/builder/drafts?id=<pageId> — reopen ONE saved page: returns its re-rendered preview HTML
 * (from the stored content + render_opts) so the wizard can drop it back into the preview step.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getTemplate } from '@/lib/builder/templates'
import { assembleDocument } from '@/lib/builder/assemble'
import type { RenderOpts } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const { data: row } = await admin.from('builder_pages').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const tpl = getTemplate(row.template_id)
    if (!tpl) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })
    const opts: RenderOpts = row.render_opts || { productName: row.product_name || 'Product', ctaHref: row.cta_href || '#' }
    const previewHtml = assembleDocument(tpl, row.content || {}, opts)
    return NextResponse.json({
      pageId: row.id, previewHtml, status: row.status,
      productName: row.product_name, templateId: row.template_id, shopifyUrl: row.shopify_url,
      // for the inline editor: the saved copy + the template's editable slots
      content: row.content || {},
      schema: tpl.schema.map((s) => ({ key: s.key, type: s.type, label: s.label, hint: s.hint })),
    })
  }

  const { data } = await admin
    .from('builder_pages')
    .select('id, type, template_id, product_name, status, shopify_url, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ pages: data || [] })
}

/** DELETE /api/builder/drafts?id=<pageId> — remove one of the user's saved pages. Scoped to the owner. */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from('builder_pages').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
