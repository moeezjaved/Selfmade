/**
 * GET /api/channels/unipile/debug — TEMP diagnostic. Shows what Unipile returns for /accounts (so we can
 * see the real field names to match on) + what we currently have bound in the DB. Cookie-authed (self
 * only). No tokens are returned by Unipile's accounts endpoint. Safe to remove once connect is verified.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DSN = () => {
  let d = (process.env.UNIPILE_DSN || '').trim().replace(/\/+$/, '')
  if (d && !/^https?:\/\//i.test(d)) d = `https://${d}`
  return d
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const configured = !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY)
  let unipile: any = null
  let fetchError: string | null = null
  if (configured) {
    try {
      const res = await fetch(`${DSN()}/api/v1/accounts`, {
        headers: { accept: 'application/json', 'X-API-KEY': (process.env.UNIPILE_API_KEY || '').trim() },
      })
      unipile = await res.json().catch(() => ({ status: res.status, note: 'non-json body' }))
    } catch (e: any) { fetchError = String(e?.message || e) }
  }

  const { data: bound } = await createAdminClient().from('channel_identities')
    .select('provider, external_id, active, meta').eq('user_id', user.id)

  return NextResponse.json({
    myUserId: user.id,
    dsn: DSN(),
    configured,
    fetchError,
    unipileAccounts: unipile,        // ← the raw shape we need to see (id / name / type fields)
    boundInDb: bound || [],
  })
}
