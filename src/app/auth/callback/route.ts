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
  const next = searchParams.get('next') || '/brief'   // land on Mello's Morning Brief, not a tool page
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
    }
  } catch { /* best-effort */ }

  // First-time (or unfinished) users land in the competitor-first onboarding wizard instead of the
  // dashboard — email signups already route there; this covers Google sign-ins. Best-effort: any
  // lookup hiccup falls through to the normal destination rather than blocking login.
  try {
    const uid = data?.user?.id
    if (uid && (!next || next === '/discovery' || next === '/brief')) {
      const { data: prof } = await supabase.from('user_profiles').select('onboarding_completed').eq('user_id', uid).maybeSingle()
      if (!(prof as any)?.onboarding_completed) return NextResponse.redirect(`${origin}/onboarding`)
    }
  } catch { /* fall through */ }

  const dest = next.startsWith('/') ? next : '/brief'
  return NextResponse.redirect(`${origin}${dest}`)
}
