/**
 * Mint (or reuse) the Chrome-extension token for the signed-in user. Called by the /extension/auth
 * authorize page after the user clicks "Connect". Session-cookie authed (the user is on our site).
 * Returns an `sk_mcp_…` token the extension stores and sends as Bearer on every save. We reuse the
 * mcp_keys table (label 'Chrome Extension') so there's one auth story, not two.
 *
 * NOT gated by the 'api' entitlement on purpose — saving ads from the web is a core funnel feature
 * we want every signed-up user to have (Atria parity), unlike the developer MCP server.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LABEL = 'Chrome Extension'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  // Reuse an existing, non-revoked extension key if the user already connected once.
  const { data: existing } = await admin.from('mcp_keys')
    .select('token').eq('user_id', user.id).eq('label', LABEL).eq('revoked', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.token) {
    return NextResponse.json({ token: existing.token, email: user.email, reused: true })
  }

  const token = 'sk_mcp_' + randomBytes(24).toString('hex')
  const { error } = await admin.from('mcp_keys').insert({ user_id: user.id, label: LABEL, token })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ token, email: user.email, reused: false })
}
