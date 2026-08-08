/**
 * GET  /api/channels/link            → { identities } the founder has connected
 * POST /api/channels/link { provider? } → { code, instructions } to connect Slack/WhatsApp
 * DELETE /api/channels/link { id }   → disconnect a channel
 *
 * Cookie-gated: a code can only be minted by someone logged into the account — that's what makes the
 * later "text this code to the bot" binding trustworthy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mintCode } from '@/lib/channels/link'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('channel_identities')
    .select('id, provider, display, active, created_at, meta').eq('user_id', user.id).eq('active', true)
  // This endpoint powers "Mello on Slack & WhatsApp" = the founder's OWN chat with Mello (founder_tool).
  // A customer-inbox WhatsApp (customer_channel, connected via Unipile) is a SEPARATE thing — exclude it,
  // or it shows the founder row as Connected and Disconnect won't flip it. (Standing rule: keep them apart.)
  const identities = ((data || []) as any[])
    .filter((i: any) => i?.meta?.customer_channel !== true)
    .map((i: any) => ({ id: i.id, provider: i.provider, display: i.display, active: i.active, created_at: i.created_at }))
  return NextResponse.json({ identities })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { provider } = await req.json().catch(() => ({}))
  const admin = createAdminClient()
  const code = await mintCode(admin, user.id, provider === 'slack' || provider === 'whatsapp' ? provider : undefined)
  const instructions = provider === 'slack'
    ? `In Slack, message the Selfmade app:  /selfmade ${code}`
    : `On WhatsApp, message our number:  ${code}`
  return NextResponse.json({ code, instructions, expiresInMinutes: 15 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('channel_identities').update({ active: false }).eq('id', String(id)).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
