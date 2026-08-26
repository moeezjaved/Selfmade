/**
 * POST /api/agreement/accept — records that the founder signed Mello's "employment agreement" before
 * entering the workspace. Stores the timestamp + typed name in the user's metadata AND sets a cookie so
 * the workspace gate passes immediately (the session JWT only picks up metadata on its next refresh).
 * Body: { name }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').slice(0, 80).trim()
  const admin = createAdminClient() as any
  try {
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata || {}), hire_agreement_accepted_at: new Date().toISOString(), hire_agreement_name: name || undefined },
    })
  } catch { /* cookie below is the immediate signal; metadata is best-effort */ }
  const res = NextResponse.json({ ok: true })
  res.cookies.set('sf_hired', '1', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return res
}
