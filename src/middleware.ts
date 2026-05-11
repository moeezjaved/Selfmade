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
  '/discovery',
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
  '/discovery',
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

  // Hard timeout helper — middleware MUST finish in <25s or Vercel returns 504.
  // When Supabase is under load (heavy worker writes, big index builds, etc.)
  // a single getUser() call can stall for 30s+. Better to fail open (let the
  // page render and rely on per-route auth) than 504 the whole site.
  const withTimeout = <T,>(p: Promise<T>, ms = 4000): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>(r => setTimeout(() => r(null), ms)),
    ])

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

    const userRes = await withTimeout(supabase.auth.getUser())
    if (!userRes) {
      // Supabase didn't answer in 4s — fail open. Per-page server components
      // will still re-check auth using their own (non-edge) Supabase clients.
      return response
    }
    const user = userRes.data.user

    if (PROTECTED.some(p => pathname.startsWith(p)) && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    if ((pathname === '/login' || pathname === '/signup') && user) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // ── Subscription gate ────────────────────────────────────────
    if (user && REQUIRES_SUBSCRIPTION.some(p => pathname.startsWith(p))) {
      const profileRes = await withTimeout(
        supabase
          .from('user_profiles')
          .select('subscription_status, trial_ends_at')
          .eq('user_id', user.id)
          .single()
      )

      if (profileRes?.data) {
        const profile = profileRes.data
        const status = profile.subscription_status
        const trialEnded = profile.trial_ends_at && new Date(profile.trial_ends_at) < new Date()
        const isLocked = status === 'canceled' || status === 'past_due' || status === 'incomplete'
          || (status === 'trialing' && trialEnded)

        if (isLocked) {
          return NextResponse.redirect(new URL('/billing?expired=1', request.url))
        }
      }
      // If profileRes is null (timeout), fail open — let user through.
      // Worst case: someone with an expired sub gets one extra page load before
      // the gate kicks in on the next request when DB is responsive.
    }

    return response
  } catch {
    return NextResponse.next()
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'],
}
