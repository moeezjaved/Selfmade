/**
 * POST /api/channels/unipile/bind { provider, accountId } — bind a just-connected Unipile account to the
 * signed-in founder, straight from the success redirect (?connected=…&account_id=…). This is the reliable
 * path: it doesn't depend on Unipile's server-to-server notify webhook firing. We read the account's real
 * type from Unipile so it's labeled correctly (a Google pick becomes email/calendar, etc.).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { bindUnipileAccount, fetchAccountType, labelForType } from '@/lib/channels/unipile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const accountId = String(body.accountId || '').trim()
  const requested = String(body.provider || '').trim()
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

  const type = await fetchAccountType(accountId)
  const provider = labelForType(type, requested)
  try { await bindUnipileAccount(createAdminClient(), user.id, provider, accountId) }
  catch { return NextResponse.json({ error: 'Could not save the connection.' }, { status: 500 }) }
  return NextResponse.json({ ok: true, provider })
}
