/**
 * POST /api/builder/update { pageId, content } — save edited copy for a saved page and return the
 * re-rendered preview HTML. Content is the FilledContent (slot key → value) from the inline editor.
 * Publishing still goes through /api/builder/publish, which re-renders from this saved content.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getTemplate } from '@/lib/builder/templates'
import { assembleDocument } from '@/lib/builder/assemble'
import type { RenderOpts, FilledContent } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const pageId = String(b?.pageId || '')
  const content = (b?.content && typeof b.content === 'object') ? (b.content as FilledContent) : null
  // The classic form sends this after the user confirms discarding visual-editor changes.
  const discardVisualEdits = b?.discardVisualEdits === true
  if (!pageId || !content) return NextResponse.json({ error: 'pageId and content are required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('builder_pages').select('*').eq('id', pageId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const tpl = getTemplate(row.template_id)
  if (!tpl) return NextResponse.json({ error: 'unknown_template' }, { status: 400 })

  // Keep only keys this template actually has, so the editor can't inject arbitrary fields.
  const allowed = new Set(tpl.schema.map((s) => s.key))
  const clean: FilledContent = {}
  for (const [k, v] of Object.entries(content)) if (allowed.has(k)) clean[k] = v as any
  // Preserve any pipeline-filled keys the editor didn't touch (e.g. images).
  const merged: FilledContent = { ...(row.content || {}), ...clean }

  // If the caller confirmed, the form's structured copy becomes the source of truth again — drop the
  // visual-editor override so preview + publish re-render from `content`.
  const patch: any = { content: merged, updated_at: new Date().toISOString() }
  if (discardVisualEdits && row.edited_html) { patch.edited_html = null; patch.edited_at = null }
  await admin.from('builder_pages').update(patch).eq('id', pageId)

  const opts: RenderOpts = row.render_opts || { productName: row.product_name || 'Product', ctaHref: row.cta_href || '#' }
  const previewHtml = assembleDocument(tpl, merged, opts)
  return NextResponse.json({ pageId, previewHtml })
}
