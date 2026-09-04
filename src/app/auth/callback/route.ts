/**
 * Supabase OAuth callback (Google sign-in). The provider redirects here with a `code`; we exchange it
 * for a session (sets the auth cookies via the SSR client), then land the user in the app. Distinct
 * from /api/auth/callback, which is the Meta/Facebook ad-account OAuth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isFreeEmail } from '@/lib/email-domains'
import { sendWelcomeEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/hq'   // land on the chat-first Home (Unified Shell v2), not a tool page
  const err = searchParams.get('error_description') || searchParams.get('error')

  if (err) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(err)}`)
  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)

  // Business-email gate — block personal Gmail/Yahoo/etc. Google sign-ins (same rule as email signup).
  // Tear the just-created session back down and bounce to signup with the friendly-popup flag.
  const email = data?.user?.email || ''
  if (isFreeEmail(email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/signup?error=business_email&email=${encodeURIComponent(email)}`)
  }

  // Welcome email — this callback fires for Google sign-ins AND email-verification confirmations, so
  // it's the one place both new-account paths pass through. Idempotent via activity_logs, best-effort.
  try {
    const uid = data?.user?.id
    if (uid && email) {
      const admin = createAdminClient()
      const { data: prior } = await admin.from('activity_logs')
        .select('id').eq('user_id', uid).eq('action_type', 'WELCOME_EMAIL').limit(1).maybeSingle()
      if (!prior) {
        await admin.from('activity_logs').insert({
          user_id: uid, action_type: 'WELCOME_EMAIL', entity_type: 'account',
          description: 'Welcome email sent', performed_by: 'system',
        })
        await sendWelcomeEmail(email, (data?.user?.user_metadata?.full_name as string) || '')
      }
      // The audit drip is converted on PAID now (not signup) — signup precedes the audit. See paypal grant.
    }
  } catch { /* best-effort */ }

  // The audit IS onboarding, so EVERY first-time user runs it — regardless of ?next — otherwise a Google
  // sign-in (or any deep-linked signup) can skip the audit entirely and never enter the funnel (this is
  // how gulzarmalik0987 landed on /hq with no audit). Read via the ADMIN client so RLS/timing can't make
  // us miss the row. Only users who have ALREADY finished onboarding honor ?next / land on /hq. Best-effort:
  // a lookup hiccup falls through to the normal destination rather than blocking login.
  try {
    const uid = data?.user?.id
    if (uid && next !== '/store-audit') {
      const admin = createAdminClient()
      const { data: prof } = await admin.from('user_profiles').select('onboarding_completed').eq('user_id', uid).maybeSingle()
      if (!(prof as any)?.onboarding_completed) return NextResponse.redirect(`${origin}/store-audit`)
    }
  } catch { /* fall through */ }

  const dest = next.startsWith('/') ? next : '/hq'
  return NextResponse.redirect(`${origin}${dest}`)
}
