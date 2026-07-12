/**
 * POST /api/reports/share — create a shareable snapshot of a report.
 *  mode 'once'    → a public link to a FROZEN snapshot (data won't change), with an optional note.
 *  mode 'partner' → same snapshot, emailed to a partner so they can view it without an account.
 * The snapshot JSON is stored in R2 (no DB dependency), served read-only at /r/<token>.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'
import { recordSnapshot } from '@/lib/reports/snapshots'
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

  // Freeze creative thumbnails into R2 so the shared snapshot keeps its images forever — Meta's
  // thumbnail URLs are temporary/signed and would otherwise expire and go blank in a client's link.
  // Best-effort, bounded to the visible rows; rows without a thumbnail (Meta returned none) stay as-is.
  await Promise.all((snapshot.rows as any[]).slice(0, 60).map(async (r, i) => {
    const t = r?.thumbnail
    if (!t || typeof t !== 'string' || t.startsWith('data:') || t.includes('.r2.dev') || t.includes('r2.cloudflarestorage') || t.includes('cdn.tryselfmade')) return
    try {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(t)}&w=240&output=webp&q=80`
      const res = await fetch(proxied)
      if (!res.ok) return
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length || buf.length > 2_000_000) return
      const frozen = await uploadBufferToR2(buf, `shared-reports/${token}/t${i}.webp`, 'image/webp')
      if (frozen) r.thumbnail = frozen
    } catch { /* keep the original url on failure */ }
  }))

  const url = await uploadBufferToR2(Buffer.from(JSON.stringify(snapshot)), `shared-reports/${token}.json`, 'application/json')
  if (!url) return NextResponse.json({ error: 'Sharing is not configured (storage unavailable).' }, { status: 503 })
  const shareUrl = `${APP_URL}/r/${token}`

  // File a copy in the org's Snapshots archive (frozen, listable at /snapshots). Best-effort.
  try {
    const org = await getUserOrg(createAdminClient() as any, user.id)
    if (org?.orgId) await recordSnapshot(org.orgId, { token, name: snapshot.name, emoji: snapshot.emoji, templateKey: snapshot.templateKey, note: snapshot.note, createdAt: snapshot.sharedAt, sharedBy: snapshot.sharedBy, mode })
  } catch { /* archive is best-effort — never block the share */ }

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
