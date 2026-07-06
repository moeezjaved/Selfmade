/**
 * Supabase OAuth callback (Google sign-in). The provider redirects here with a `code`; we exchange it
 * for a session (sets the auth cookies via the SSR client), then land the user in the app. Distinct
 * from /api/auth/callback, which is the Meta/Facebook ad-account OAuth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'
  const err = searchParams.get('error_description') || searchParams.get('error')

  if (err) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(err)}`)
  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`)

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)

  // Safe same-origin redirect only.
  const dest = next.startsWith('/') ? next : '/dashboard'
  return NextResponse.redirect(`${origin}${dest}`)
}
