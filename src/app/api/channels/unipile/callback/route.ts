/**
 * POST /api/channels/unipile/callback — Unipile's server-to-server notify after a hosted-auth connect.
 * Payload: { status, account_id, name } where name = "<userId>:<provider>" (what we set on the link).
 * On success we bind the new account_id to that founder so inbound customer DMs can route to them.
 * Optional shared secret via UNIPILE_WEBHOOK_SECRET (header x-unipile-secret or ?secret=).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { bindUnipileAccount } from '@/lib/channels/unipile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authed(req: NextRequest): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET
  if (!secret) return true // no secret configured → accept (Unipile→us only)
  return req.headers.get('x-unipile-secret') === secret || req.nextUrl.searchParams.get('secret') === secret
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const status = String(body.status || '')
  const accountId = String(body.account_id || body.accountId || '')
  const name = String(body.name || '')
  const [userId, provider] = name.split(':')

  // Only bind on a successful creation with everything we need.
  if (!/success/i.test(status) || !accountId || !userId || !provider) {
    return NextResponse.json({ ok: true, ignored: true })
  }
  try { await bindUnipileAccount(createAdminClient(), userId, provider, accountId) } catch { /* best-effort */ }
  return NextResponse.json({ ok: true })
}
