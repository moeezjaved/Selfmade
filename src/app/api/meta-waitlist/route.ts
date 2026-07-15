/**
 * Meta-features waitlist. POST { feature } — records that a signed-in user wants a
 * Meta-connected surface (Launch/Campaigns/Insights/Reports) while META_LIVE is off.
 * Zero-DDL by design (launch day): best-effort email to the team via Resend; always 200 so
 * the teaser UX never breaks. Volume is tiny (one click per user per feature).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, emailEnabled } from '@/lib/email'

export const dynamic = 'force-dynamic'
const TEAM_EMAIL = process.env.WAITLIST_EMAIL || 'moeez@virginteez.com'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { feature } = await req.json().catch(() => ({}))
  const f = String(feature || 'Meta features').slice(0, 60)

  if (emailEnabled) {
    await sendEmail(
      TEAM_EMAIL,
      `Meta waitlist: ${f}`,
      `<p><b>${user.email || user.id}</b> wants <b>${f}</b> (clicked notify-me on the coming-soon page).</p>`
    ).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
