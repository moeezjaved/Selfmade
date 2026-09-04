/**
 * /store-audit — SIGNUP-FIRST. The free store audit now requires an account before anything, so the whole
 * funnel (audit → report → nurture drip → deep-linked emails) runs under the founder's account. Unauthed
 * visitors are sent to signup with ?next=/store-audit so they come straight back here after signing up.
 * The interactive audit UI lives in StoreAuditClient (client component).
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StoreAuditClient from './StoreAuditClient'

export const dynamic = 'force-dynamic'

export default async function StoreAuditPage({ searchParams }: { searchParams: { focus?: string } }) {
  // Carry the capability the visitor came in for (nav → audit) through the signup bounce, so a
  // logged-out visitor who clicked "SEO"/"Paid Ads" still lands on the focused audit after signing up.
  const focus = searchParams?.focus
  const dest = focus ? `/store-audit?focus=${encodeURIComponent(focus)}` : '/store-audit'
  let signedIn = false, uid = ''
  try {
    const { data: { user } } = await (await createClient()).auth.getUser()
    signedIn = !!user; uid = user?.id || ''
  } catch { signedIn = false }
  if (!signedIn) redirect(`/signup?next=${encodeURIComponent(dest)}`)   // outside try — redirect() throws by design
  // Record that this founder REACHED the audit (one-time), so the funnel can tell "reached the audit but
  // didn't finish" apart from "signed up and never got here" — we stop losing track of new signups.
  if (uid) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/server')
      const admin = createAdminClient()
      const { data: prior } = await admin.from('activity_logs').select('id').eq('user_id', uid).eq('action_type', 'AUDIT_STARTED').limit(1).maybeSingle()
      if (!prior) await admin.from('activity_logs').insert({ user_id: uid, action_type: 'AUDIT_STARTED', entity_type: 'audit', description: 'Reached the store audit', performed_by: 'system' })
    } catch { /* best-effort */ }
  }
  return <StoreAuditClient />
}
