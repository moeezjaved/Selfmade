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
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

const REPORT_ACTION = 'competitor_report'   // 50 credits (mig 122)

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
  const charge = b?.charge !== false   // 50 credits per report; onboarding's first report passes charge:false (free wow)
  if (!competitor) return NextResponse.json({ error: 'competitor is required' }, { status: 400 })

  const admin = createAdminClient()

  // Reserve 50 credits BEFORE the expensive generation so "not enough credits" surfaces immediately,
  // and refund if generation/save fails (reserve → do work → commit / refund, the app-wide pattern).
  let txId: string | null = null
  if (charge) {
    try {
      const tx = await reserveCredits(admin, user.id, REPORT_ACTION)
      txId = tx.id
    } catch (e: any) {
      if (e instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have }, { status: 402 })
      }
      return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
    }
  }
  const refund = async () => { if (txId) await refundCredits(admin, txId).then(() => {}, () => {}) }

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
    await refund()
    return NextResponse.json({ error: e?.message || 'Report generation failed' }, { status: 502 })
  }
  // If it grounded on 0 ads it's not worth charging for — refund and still return it.
  if (!report.adCount) await refund()

  const { data: saved, error } = await admin.from('mello_documents').insert({
    user_id: user.id,
    kind: 'competitor_report',
    title: report.title,
    subject: competitor,
    subject_brand_id: brandId,
    body_md: report.markdown,
    model: report.model,
    meta: { adCount: report.adCount, ...(report.fallbacks ? { fallbacks: report.fallbacks } : {}), ...(report.usage ? { usage: report.usage } : {}), ...(report.costUsd != null ? { costUsd: report.costUsd } : {}), ...(report.swipe?.length ? { swipe: report.swipe } : {}), ...(report.stats ? { stats: report.stats } : {}) },
  }).select('id, title, model, created_at').maybeSingle()

  if (error) { await refund(); return NextResponse.json({ error: error.message }, { status: 500 }) }
  // Commit the 50-credit charge now that a real, ad-grounded report is saved.
  if (txId && report.adCount) await commitCredits(admin, txId, { model: report.model, costUsd: report.costUsd ?? null, docId: saved?.id }).then(() => {}, () => {})
  return NextResponse.json({ id: saved?.id, title: saved?.title, model: saved?.model, adCount: report.adCount, charged: !!(txId && report.adCount) })
}
