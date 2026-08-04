/**
 * POST /api/channels/unipile/connect { provider: 'instagram' | 'whatsapp' }
 * Returns a Unipile hosted-auth URL the founder opens to connect that channel (login-proven session).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createHostedAuthLink } from '@/lib/channels/unipile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Which customer channels this founder has connected — powers the "Connected ✓" badges in Settings.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await createAdminClient().from('channel_identities')
    .select('provider, display, meta').eq('user_id', user.id).eq('active', true)
  const connected = (data || [])
    .filter((r: any) => r?.meta?.customer_channel || r?.meta?.founder_tool)
    .map((r: any) => ({ provider: r.provider, display: r.display || null, kind: r?.meta?.founder_tool ? 'founder' : 'customer' }))
  return NextResponse.json({ connected })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const provider = String(body.provider || '')
  const r = await createHostedAuthLink(user.id, provider)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ url: r.url })
}
