/**
 * POST /api/reports/share — create a shareable snapshot of a report.
 *  mode 'once'    → a public link to a FROZEN snapshot (data won't change), with an optional note.
 *  mode 'partner' → same snapshot, emailed to a partner so they can view it without an account.
 * The snapshot JSON is stored in R2 (no DB dependency), served read-only at /r/<token>.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'
import { sendEmail, emailShell, emailEnabled } from '@/lib/email'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json()
  const mode: 'once' | 'partner' = b.mode === 'partner' ? 'partner' : 'once'
  const snapshot = {
    v: 1,
    name: b.name || 'Report',
    templateKey: b.templateKey || '',
    emoji: b.emoji || '📊',
    description: b.description || '',
    groupBy: b.groupBy || 'creative',
    metrics: b.metrics || [],
    rows: (b.rows || []).slice(0, 200),
    netResults: b.netResults || {},
    currency: b.currency || 'USD',
    dateRange: b.dateRange || '',
    note: (b.note || '').slice(0, 800),
    sharedBy: user.user_metadata?.full_name || user.email || 'A Selfmade user',
    sharedAt: new Date().toISOString(),
  }

  const token = randomUUID().replace(/-/g, '').slice(0, 22)
  const url = await uploadBufferToR2(Buffer.from(JSON.stringify(snapshot)), `shared-reports/${token}.json`, 'application/json')
  if (!url) return NextResponse.json({ error: 'Sharing is not configured (storage unavailable).' }, { status: 503 })
  const shareUrl = `${APP_URL}/r/${token}`

  if (mode === 'partner') {
    const email = (b.partnerEmail || '').trim()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid partner email is required.' }, { status: 400 })
    if (!emailEnabled) return NextResponse.json({ shareUrl, emailed: false, warning: 'Email is not configured — copy the link to share instead.' })
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = emailShell({
      title: `${esc(snapshot.sharedBy)} shared a report with you`,
      intro: `You've been invited to view the <b>“${esc(snapshot.name)}”</b> ad report on Selfmade.${snapshot.note ? `<br/><br/>“${esc(snapshot.note)}”` : ''}<br/><br/>No account needed — just open the report.`,
      ctaText: 'View the report', ctaUrl: shareUrl,
    })
    const ok = await sendEmail(email, `${snapshot.sharedBy} shared the “${snapshot.name}” report with you`, html)
    return NextResponse.json({ shareUrl, emailed: ok })
  }

  return NextResponse.json({ shareUrl })
}
