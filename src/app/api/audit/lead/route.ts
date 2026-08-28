/**
 * POST /api/audit/lead — signup-first funnel. A logged-in founder finished the free store-audit; we capture
 * the lead under THEIR account email, queue the nurture drip (which converts when they go paid), and send
 * email #1 instantly. Falls back to a body email for any legacy/anonymous caller.
 * Body: { email?, domain?, brandName?, report?, adUrls? }  (report = the client's scan snapshot).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { captureAuditLead } from '@/lib/audit/leads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  // Signup-first: prefer the session user's email; a body email is a legacy/anonymous fallback.
  let email = ''
  try { const { data: { user } } = await (await createClient()).auth.getUser(); email = (user?.email || '').trim().toLowerCase() } catch { /* not logged in */ }
  if (!email) email = String(body?.email || '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'valid_email_required' }, { status: 400 })
  }
  const admin = createAdminClient() as any
  const report = (body?.report && typeof body.report === 'object') ? {
    score: Number(body.report.score) || undefined,
    category: body.report.category ? String(body.report.category).slice(0, 80) : undefined,
    currency: body.report.currency ? String(body.report.currency).slice(0, 4) : undefined,
    revenueLostPerYear: Number(body.report.revenueLostPerYear) || undefined,
    topLeak: body.report.topLeak ? String(body.report.topLeak).slice(0, 200) : undefined,
    leaks: Array.isArray(body.report.leaks) ? body.report.leaks.map((s: any) => String(s).slice(0, 160)).slice(0, 6) : undefined,
    rivalName: body.report.rivalName ? String(body.report.rivalName).slice(0, 80) : undefined,
    rivalFormula: body.report.rivalFormula ? String(body.report.rivalFormula).slice(0, 120) : undefined,
    aiMissing: Number.isFinite(body.report.aiMissing) ? Number(body.report.aiMissing) : undefined,
    aiTotal: Number.isFinite(body.report.aiTotal) ? Number(body.report.aiTotal) : undefined,
  } : undefined
  const adUrls = Array.isArray(body?.adUrls) ? body.adUrls.map((s: any) => String(s)).filter((s: string) => s.startsWith('http')).slice(0, 6) : []

  const res = await captureAuditLead(admin, {
    email, domain: body?.domain ? String(body.domain) : null, brandName: body?.brandName ? String(body.brandName).slice(0, 80) : null, report, adUrls,
  })
  if (!res.ok) return NextResponse.json({ error: 'capture_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
