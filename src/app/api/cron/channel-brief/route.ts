/**
 * Daily morning brief → chat. Sends every founder who has linked Slack/WhatsApp their brief (the office
 * report + the top decision), independent of whether they have a Meta account. This is what makes the
 * brief actually arrive every morning — previously it only piggybacked on the Meta-audit cron.
 * Auth: CRON_SECRET (header/param), same as the other crons.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { assembleBrief } from '@/lib/brief/assemble'
import { sendReportToChannels } from '@/lib/channels/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const h = req.headers.get('authorization') || ''
  return h === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Distinct founders with a linked FOUNDER comms channel (Slack/WhatsApp, not a connected customer one).
  const { data: ids } = await admin.from('channel_identities')
    .select('user_id, provider, meta').eq('active', true).in('provider', ['slack', 'whatsapp']).limit(2000)
  const users = Array.from(new Set<string>((ids || []).filter((i: any) => !i.meta?.customer_channel).map((i: any) => String(i.user_id))))

  let sent = 0, skipped = 0
  for (const uid of users) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(uid)
      const meta = { email: u?.user?.email || null, full_name: (u?.user?.user_metadata as any)?.full_name }
      // One founder, many brands → one section per brand so each brand's brief is distinct. A founder with
      // a single brand (or none) gets the account-wide brief exactly as before.
      const { data: brands } = await admin.from('brands').select('id, name').eq('user_id', uid).order('created_at', { ascending: true })
      const list = (brands || []) as any[]
      let any = 0
      if (list.length > 1) {
        for (const b of list) {
          const brief = await assembleBrief(admin, uid, meta, { brandId: String(b.id) })
          const r = await sendReportToChannels(admin, uid, brief, { brandId: String(b.id), brandLabel: b.name })
          any += r.sent
        }
      } else {
        const brief = await assembleBrief(admin, uid, meta, {})
        const r = await sendReportToChannels(admin, uid, brief)
        any += r.sent
      }
      if (any > 0) sent++; else skipped++
    } catch { skipped++ }
  }
  return NextResponse.json({ ok: true, founders: users.length, sent, skipped })
}
