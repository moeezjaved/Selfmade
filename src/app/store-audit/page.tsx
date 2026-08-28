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

export default async function StoreAuditPage() {
  let signedIn = false
  try {
    const { data: { user } } = await (await createClient()).auth.getUser()
    signedIn = !!user
  } catch { signedIn = false }
  if (!signedIn) redirect('/signup?next=/store-audit')   // outside try — redirect() throws by design
  return <StoreAuditClient />
}
