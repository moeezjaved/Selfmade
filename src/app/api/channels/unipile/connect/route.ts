/**
 * POST /api/channels/unipile/connect { provider: 'instagram' | 'whatsapp' }
 * Returns a Unipile hosted-auth URL the founder opens to connect that channel (login-proven session).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHostedAuthLink } from '@/lib/channels/unipile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
