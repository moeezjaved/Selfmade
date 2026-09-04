/**
 * Visual editor endpoints for a saved page.
 *   GET  /api/builder/editor?id=<pageId>  → { editorHtml, productImage, brandName, edited }
 *        editorHtml = the live page + the injected click-anywhere runtime (never used for publish).
 *   POST /api/builder/editor { pageId, html } → save the visually-edited BODY as edited_html (the "page
 *        is the document" source of truth). Scripts/handlers are stripped so a published page stays safe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getTemplate } from '@/lib/builder/templates'
import { assembleEditorDocument, assembleDocumentEdited } from '@/lib/builder/assemble'
import type { RenderOpts } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Strip anything executable so the saved (and later published) HTML can't run code.
function sanitizeBody(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 800_000)
}

function optsFrom(row: any): RenderOpts {
  return row.render_opts || { productName: row.product_name || 'Product', ctaHref: row.cta_href || '#' }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('builder_pages').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const tpl = getTemplate(row.template_id)
  if (!tpl) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })

  const opts = optsFrom(row)
  const editorHtml = assembleEditorDocument(tpl, row.content || {}, opts, row.edited_html)
  const productImage = opts.productImage || (row.content?.image_main as string) || null
  return NextResponse.json({ editorHtml, productImage, brandName: opts.productName, edited: !!row.edited_html })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const pageId = String(b?.pageId || '')
  const html = typeof b?.html === 'string' ? b.html : ''
  if (!pageId || !html.trim()) return NextResponse.json({ error: 'pageId and html required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('builder_pages').select('*').eq('id', pageId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const tpl = getTemplate(row.template_id)
  if (!tpl) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })

  const edited = sanitizeBody(html)
  const opts = optsFrom(row)
  const previewHtml = assembleDocumentEdited(tpl, row.content || {}, opts, edited)   // refresh the cached snapshot too
  const now = new Date().toISOString()
  await admin.from('builder_pages').update({ edited_html: edited, preview_html: previewHtml, edited_at: now, updated_at: now }).eq('id', pageId)

  return NextResponse.json({ ok: true })
}
