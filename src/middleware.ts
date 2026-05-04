import { NextRequest, NextResponse } from 'next/server'

const PROTECTED = [
  '/dashboard',
  '/recommendations',
  '/campaigns',
  '/creative-studio',
  '/ad-engine',
  '/activity',
  '/settings',
  '/billing',
  '/reports',
  '/insights',
  '/m4',
]

// Pages that need an active subscription (billing itself is always accessible)
const REQUIRES_SUBSCRIPTION = [
  '/dashboard',
  '/recommendations',
  '/campaigns',
  '/creative-studio',
  '/ad-engine',
  '/activity',
  '/settings',
  '/reports',
  '/insights',
  '/m4',
]

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname === '/') return NextResponse.next()

  // ── Admin routes ────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next()
    const cookie = request.cookies.get('admin_token')?.value
    const adminToken = process.env.ADMIN_TOKEN
    if (!adminToken || cookie !== adminToken) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
    return NextResponse.next()
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next()
  }

  try {
    const { createServerClient } = await import('@supabase/ssr')
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookies.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookies.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (PROTECTED.some(p => pathname.startsWith(p)) && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    if ((pathname === '/login' || pathname === '/signup') && user) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // ── Subscription gate ────────────────────────────────────────
    if (user && REQUIRES_SUBSCRIPTION.some(p => pathname.startsWith(p))) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('subscription_status, trial_ends_at')
        .eq('user_id', user.id)
        .single()

      if (profile) {
        const status = profile.subscription_status
        const trialEnded = profile.trial_ends_at && new Date(profile.trial_ends_at) < new Date()
        const isLocked = status === 'canceled' || status === 'past_due' || status === 'incomplete'
          || (status === 'trialing' && trialEnded)

        if (isLocked) {
          return NextResponse.redirect(new URL('/billing?expired=1', request.url))
        }
      }
    }

    return response
  } catch {
    return NextResponse.next()
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'],
}
