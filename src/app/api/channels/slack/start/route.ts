/**
 * GET /api/channels/slack/start — the "Add to Slack" entry. Mints a one-time link code tied to the
 * logged-in founder, then redirects to Slack's authorize screen with that code as `state`. One click,
 * no code to copy. The callback uses `state` to bind the install to this founder.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mintCode } from '@/lib/channels/link'
import { slackAuthorizeUrl, slackOAuthConfigured } from '@/lib/channels/providers'

export const dynamic = 'force-dynamic'
const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${APP}/login`)
  if (!slackOAuthConfigured) return NextResponse.redirect(`${APP}/settings?slack=notconfigured`)
  const code = await mintCode(createAdminClient(), user.id, 'slack')
  return NextResponse.redirect(slackAuthorizeUrl(`${APP}/api/channels/slack/callback`, code))
}
