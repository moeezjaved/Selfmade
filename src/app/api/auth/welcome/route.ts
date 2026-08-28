/**
 * Send the one-time welcome email for the signed-in user. POST (no body).
 * Called by the signup page right after account creation. Idempotent via an activity_logs
 * 'WELCOME_EMAIL' row so a double-submit / refresh can't send twice. Always 200 (best-effort) so
 * it never blocks the signup → onboarding handoff.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ ok: false }, { status: 200 })

  const admin = createAdminClient()
  try {
    // Claim: only the first caller inserts the WELCOME_EMAIL row → only it sends.
    const { data: prior } = await admin.from('activity_logs')
      .select('id').eq('user_id', user.id).eq('action_type', 'WELCOME_EMAIL').limit(1).maybeSingle()
    if (prior) return NextResponse.json({ ok: true, already: true })
    await admin.from('activity_logs').insert({
      user_id: user.id, action_type: 'WELCOME_EMAIL', entity_type: 'account',
      description: 'Welcome email sent', performed_by: 'system',
    })
    await sendWelcomeEmail(user.email, (user.user_metadata?.full_name as string) || '')
    // They signed up → stop any audit nurture drip tied to this email.
    try { const { convertAuditLeads } = await import('@/lib/audit/leads'); await convertAuditLeads(admin, user.email || '', user.id) } catch { /* best-effort */ }
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true })
}
