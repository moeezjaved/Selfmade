/**
 * Supabase OAuth callback (Google sign-in). The provider redirects here with a `code`; we exchange it
 * for a session (sets the auth cookies via the SSR client), then land the user in the app. Distinct
 * from /api/auth/callback, which is the Meta/Facebook ad-account OAuth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isFreeEmail } from '@/lib/email-domains'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'
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

  const dest = next.startsWith('/') ? next : '/dashboard'
  return NextResponse.redirect(`${origin}${dest}`)
}
