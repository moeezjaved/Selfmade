/**
 * POST /api/channels/unipile/connect { provider: 'instagram' | 'whatsapp' }
 * Returns a Unipile hosted-auth URL the founder opens to connect that channel (login-proven session).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createHostedAuthLink, reconcileUnipileAccounts } from '@/lib/channels/unipile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Which customer channels this founder has connected — powers the "Connected ✓" badges in Settings.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  // Self-heal: pull the founder's real connected accounts from Unipile and bind any we're missing, so
  // the ✓ badges are right even when the connect redirect/notify didn't persist.
  try { await reconcileUnipileAccounts(admin, user.id) } catch { /* best-effort */ }
  let { data } = await admin.from('channel_identities')
    .select('provider, display, meta, brand_id').eq('user_id', user.id).eq('active', true)
  if (!data) { const r = await admin.from('channel_identities').select('provider, display, meta').eq('user_id', user.id).eq('active', true); data = r.data }  // pre-mig-143 fallback (no brand_id column)
  // Slack is a founder comms channel by nature (OAuth install; no customer_channel/founder_tool flag in
  // its meta), so it was being excluded here — which made the brief's "Get your brief on Slack" show
  // "Connect" even when Slack was connected. Treat a non-customer Slack as a founder channel.
  const isFounderSlack = (r: any) => r?.provider === 'slack' && r?.meta?.customer_channel !== true
  const connected = (data || [])
    .filter((r: any) => r?.meta?.customer_channel || r?.meta?.founder_tool || isFounderSlack(r))
    .map((r: any) => ({ provider: r.provider, display: r.display || null, kind: (r?.meta?.founder_tool || isFounderSlack(r)) ? 'founder' : 'customer', brand_id: r.brand_id || null }))
  return NextResponse.json({ connected })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const provider = String(body.provider || '')
  const kind = body.kind === 'founder' ? 'founder' : undefined   // founder = the founder's OWN Mello channel (WhatsApp brief), not a customer inbox
  const brandTag = (typeof body.brand === 'string' && body.brand) ? body.brand : undefined   // tag a customer channel to the brand it's connected under
  const r = await createHostedAuthLink(user.id, provider, String(body.returnTo || ''), kind, brandTag)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ url: r.url })
}

// DELETE /api/channels/unipile/connect { provider } → disconnect that provider for this founder.
// Matches the GET's source of truth: it deactivates the channel_identities rows the "Connected ✓"
// badge reads from, so the calendar/channels flip back to "Connect →" (was only offering Reconnect).
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const provider = String(body.provider || '')
  if (!provider) return NextResponse.json({ error: 'provider required' }, { status: 400 })
  const admin = createAdminClient()
  // Disconnect ONLY the CUSTOMER-inbox identity for this provider — never the founder's Mello channel of
  // the same provider (e.g. WhatsApp is both). They're independent connections; deactivating by provider
  // alone would kill both. Scope to customer_channel rows by id.
  const { data: rows } = await admin.from('channel_identities').select('id, meta').eq('user_id', user.id).eq('provider', provider).eq('active', true)
  const ids = ((rows || []) as any[]).filter((r: any) => r?.meta?.customer_channel && !r?.meta?.founder_tool).map((r: any) => r.id)
  if (ids.length) await admin.from('channel_identities').update({ active: false }).in('id', ids)
  return NextResponse.json({ ok: true })
}
