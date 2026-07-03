/**
 * Notification preferences — the user controls how they hear about new ads on brands they follow.
 * GET → current prefs (or defaults if none saved). PUT → upsert.
 * Columns (migration 054): in_app, instant_email, digest_frequency ('weekly'|'daily'|'off').
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Emails are OPT-IN (they cost 2 credits each), so both default OFF. Only in-app is on by default.
const DEFAULTS = { in_app: true, instant_email: false, digest_frequency: 'off' as const }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin
    .from('notification_prefs')
    .select('in_app, instant_email, digest_frequency')
    .eq('user_id', user.id)
    .maybeSingle()
  return NextResponse.json({ prefs: data || DEFAULTS })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  const digest = ['weekly', 'daily', 'off'].includes(body.digest_frequency) ? body.digest_frequency : 'off'
  const row = {
    user_id: user.id,
    in_app: body.in_app !== false,                 // default true
    instant_email: body.instant_email === true,    // default false
    digest_frequency: digest,
  }
  const admin = createAdminClient()
  const { error } = await admin.from('notification_prefs').upsert(row, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, prefs: { in_app: row.in_app, instant_email: row.instant_email, digest_frequency: row.digest_frequency } })
}
