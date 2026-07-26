/**
 * POST /api/mello/documents/competitor-report  { competitor, brandId? }
 * Generates the flagship AI-authored Competitor Intelligence Report (Opus → Gemini 2.5 Pro → gpt-4o),
 * grounded in real crawled ad DNA, and saves it as a mello_documents row. Returns { id, title, model }.
 *
 * This is a heavy call (long-form generation over a full evidence pack) — up to ~120s.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateCompetitorReport } from '@/lib/mello/reports/competitor-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const competitor = String(b?.competitor || '').trim()
  const brandId = b?.brandId ? String(b.brandId) : null
  const pageId = b?.pageId ? String(b.pageId).replace(/[^0-9]/g, '') || undefined : undefined  // optional: point at an exact Meta page
  const preferModel = ['gpt-4o', 'gemini-2.5-pro', 'claude-opus'].includes(b?.preferModel) ? b.preferModel : undefined
  if (!competitor) return NextResponse.json({ error: 'competitor is required' }, { status: 400 })

  const admin = createAdminClient()

  // Resolve the reader's brand (for "what should MY brand do") — the named brand, else their first.
  // NOTE: brands has NO org_id column — selecting it errors the whole query.
  let myBrand: { name: string; industry?: string; website?: string; voice?: string; edge?: string } | null = null
  try {
    let q = admin.from('brands').select('id, name, industry, website, tone, usps').eq('user_id', user.id)
    q = brandId ? q.eq('id', brandId) : q.order('created_at', { ascending: true })
    const { data: brand } = await q.limit(1).maybeSingle()
    if (brand) {
      const arr = (v: any) => Array.isArray(v) ? v.filter(Boolean).join('/') : (v || undefined)
      myBrand = { name: brand.name, industry: arr(brand.industry), website: brand.website || undefined, voice: brand.tone || undefined, edge: arr(brand.usps) }
    }
  } catch { /* fail-soft — report still generates as generic operator advice */ }

  let report
  try {
    report = await generateCompetitorReport({ competitorName: competitor, myBrand, userId: user.id, preferModel, pageId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Report generation failed' }, { status: 502 })
  }

  const { data: saved, error } = await admin.from('mello_documents').insert({
    user_id: user.id,
    kind: 'competitor_report',
    title: report.title,
    subject: competitor,
    subject_brand_id: brandId,
    body_md: report.markdown,
    model: report.model,
    meta: { adCount: report.adCount, ...(report.fallbacks ? { fallbacks: report.fallbacks } : {}), ...(report.usage ? { usage: report.usage } : {}), ...(report.costUsd != null ? { costUsd: report.costUsd } : {}), ...(report.swipe?.length ? { swipe: report.swipe } : {}) },
  }).select('id, title, model, created_at').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: saved?.id, title: saved?.title, model: saved?.model, adCount: report.adCount })
}
