/**
 * POST /api/builder/generate { templateId, productId, persona, angle, research? }
 * Charges page_build credits, runs the generation pipeline (copy + images), assembles the preview,
 * saves a draft builder_pages row, and returns { pageId, previewHtml }. AI images are billed inside
 * the pipeline per image; this reserves only the copy cost. reserve → generate → commit / refund.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { generatePage } from '@/lib/builder/generate'
import { getTemplate } from '@/lib/builder/templates'
import { assembleDocument } from '@/lib/builder/assemble'

const ACTION = 'page_build'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const templateId = String(b?.templateId || '')
  const productId = String(b?.productId || '')
  const persona = b?.persona ?? null
  const angle = b?.angle ?? null
  const research = b?.research ? String(b.research) : undefined
  if (!templateId || !productId) return NextResponse.json({ error: 'templateId and productId are required' }, { status: 400 })
  const tpl = getTemplate(templateId)
  if (!tpl) return NextResponse.json({ error: 'unknown template' }, { status: 400 })

  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)

  let txId: string | null = null
  try {
    txId = (await reserveCredits(admin, user.id, ACTION)).id
  } catch (e: any) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  const refund = async () => { if (txId) await refundCredits(admin, txId).then(() => {}, () => {}) }

  let gen
  try {
    gen = await generatePage(user.id, { templateId, productId, persona, angle, brandId, research })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: e?.message || 'Generation failed' }, { status: 502 })
  }

  const previewHtml = assembleDocument(tpl, gen.content, gen.renderOpts)

  const { data: saved, error } = await admin.from('builder_pages').insert({
    user_id: user.id,
    brand_id: brandId,
    template_id: templateId,
    type: tpl.type,
    product_id: productId,
    product_name: gen.productName,
    cta_href: gen.ctaHref,
    persona,
    angle,
    research_ref: research ? 'inline' : null,
    content: gen.content,
    render_opts: gen.renderOpts,
    preview_html: previewHtml,
    status: 'draft',
  }).select('id').single()

  if (error || !saved) { await refund(); return NextResponse.json({ error: 'save_failed' }, { status: 500 }) }
  await commitCredits(admin, txId!, { page_id: saved.id, template: templateId }).then(() => {}, () => {})

  return NextResponse.json({ pageId: saved.id, previewHtml })
}
