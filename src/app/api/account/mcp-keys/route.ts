/**
 * User-facing MCP keys — subscribers on an API-enabled plan mint their own keys for the /api/mcp
 * server. Gated by the 'api' entitlement; keys are scoped to the requesting user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, admin: null as any }
  return { user, admin: createAdminClient() as any }
}

export async function GET() {
  const { user, admin } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Gate on the ORG billing owner's plan, not the member's own — so every seat on an API-enabled
  // org (Pro/Business) gets access, and the owner isn't wrongly locked by a stale personal plan_id.
  const gate = await requireFeature(admin, await resolveBillingOwner(admin, user.id), 'api')
  // Exclude the Chrome extension's auth token — it lives in mcp_keys too ("one auth story") but it's
  // managed by the extension, not a user-created API key. Showing it here confuses users and revoking
  // it would silently break their extension.
  const { data } = await admin.from('mcp_keys').select('id, label, token, created_at, last_used_at, revoked')
    .eq('user_id', user.id).eq('revoked', false).neq('label', 'Chrome Extension').order('created_at', { ascending: false })
  return NextResponse.json({ keys: data || [], locked: !!gate, upsell: gate || null })
}

export async function POST(request: NextRequest) {
  const { user, admin } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await requireFeature(admin, await resolveBillingOwner(admin, user.id), 'api')
  if (gate) return NextResponse.json(gate, { status: 403 })
  const { label } = await request.json().catch(() => ({}))
  const token = 'sk_mcp_' + randomBytes(24).toString('hex')
  const { data, error } = await admin.from('mcp_keys').insert({ user_id: user.id, label: label || 'My MCP key', token }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ key: data })
}

export async function DELETE(request: NextRequest) {
  const { user, admin } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await admin.from('mcp_keys').update({ revoked: true }).eq('id', id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
