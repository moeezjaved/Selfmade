/**
 * GET /api/channels/slack/callback?code=&state= — Slack redirects here after "Add to Slack".
 * `state` is our one-time link code → tells us which founder. We exchange the code for THIS
 * workspace's bot token, open a DM, and bind the identity (bot token encrypted at rest). Then back to
 * Settings. No code-pasting — the whole connect is one click.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { slackOAuthExchange, slackOpenDm } from '@/lib/channels/providers'
import { encryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
const back = (s: string) => NextResponse.redirect(`${APP}/settings?slack=${s}`)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code'); const state = searchParams.get('state')
  if (searchParams.get('error')) return back('cancelled')
  if (!code || !state) return back('error')
  const admin = createAdminClient()

  // state must be a valid, unused, unexpired link code → gives us the founder.
  const { data: row } = await admin.from('channel_link_codes').select('*').eq('code', state).maybeSingle()
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return back('expired')

  const ex = await slackOAuthExchange(code, `${APP}/api/channels/slack/callback`)
  if (!ex.ok || !ex.botToken || !ex.authedUserId) return back('error')

  const dm = await slackOpenDm(ex.authedUserId, ex.botToken)   // private DM to send decisions into
  await admin.from('channel_identities').upsert({
    user_id: row.user_id, provider: 'slack', external_id: ex.authedUserId,
    display: ex.teamName || 'Slack',
    meta: { bot_token: encryptToken(ex.botToken), team_id: ex.teamId, channel_id: dm || null },
    verified: true, active: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_id' })
  await admin.from('channel_link_codes').update({ used_at: new Date().toISOString() }).eq('code', state)

  return back('connected')
}
