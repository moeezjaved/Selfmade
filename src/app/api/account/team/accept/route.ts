/**
 * Accept a team invite. The logged-in user joins the invite's org (shared workspace) with the invited
 * role; the invite is marked accepted. Idempotent on the (org, user) unique constraint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  const { token } = await request.json().catch(() => ({}))
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })
  const admin = createAdminClient() as any
  const { data: inv } = await admin.from('org_invites').select('*').eq('token', token).eq('status', 'pending').maybeSingle()
  if (!inv) return NextResponse.json({ error: 'This invite is invalid or already used.' }, { status: 404 })
  // add membership (ignore if already a member), then mark accepted
  await admin.from('org_members').upsert(
    { org_id: inv.org_id, user_id: user.id, role: inv.role },
    { onConflict: 'org_id,user_id', ignoreDuplicates: true },
  )
  // A team member joins an EXISTING workspace — there is nothing to onboard (brand, competitors, and
  // assets are the owner's, shared org-wide). Stamp onboarding_completed so middleware doesn't drag the
  // new member through the from-scratch onboarding wizard; they land straight on the shared brief.
  await admin.from('user_profiles')
    .upsert({ user_id: user.id, onboarding_completed: true }, { onConflict: 'user_id' })
    .then(() => {}, () => admin.from('user_profiles').update({ onboarding_completed: true }).eq('user_id', user.id).then(() => {}, () => {}))
  await admin.from('org_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', inv.id)
  const { data: org } = await admin.from('organizations').select('name').eq('id', inv.org_id).maybeSingle()
  return NextResponse.json({ ok: true, org: org?.name || 'the team' })
}
