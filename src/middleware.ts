import { NextRequest, NextResponse } from 'next/server'
import { isFreeEmail } from '@/lib/email-domains'

// Business-email rule start. Accounts created BEFORE this are grandfathered (existing Gmail users
// keep working); free-domain accounts created after — only possible via Google, since email signup
// already blocks them — are sent to /business-email-required and can't enter the app.
const BIZ_EMAIL_CUTOFF = Date.parse('2026-07-04T00:00:00Z')

const PROTECTED = [
  '/brief',
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
  '/hq',              // chat-first Home (Unified Shell v2) — logged-in only
  '/ads-workspace',   // embedded Ad Studio — logged-in only (standalone /ads-studio stays public)
]

// Pages that need an active subscription (billing itself is always accessible). Pricing v2: Free is a
// real tier — the CORE make-an-ad loop (Discovery + My Creatives) is free-usable, so it's NOT gated
// here (a cancelled/lapsed user drops to Free and must still browse + remake). Only the Meta-analytics
// surfaces (coming-soon-flagged) stay behind the gate.
const REQUIRES_SUBSCRIPTION = [
  '/dashboard',
  '/recommendations',
  '/campaigns',
  '/ad-engine',
  '/reports',
  '/insights',
  '/m4',
]

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname === '/') return NextResponse.next()

  // Public image proxy for brand avatars (serves only public Facebook Page pictures) — must not be
  // auth-gated, or the <img> requests get 307'd to /login and every avatar falls back to a letter.
  if (pathname.startsWith('/api/discovery/brand-avatar/')) return NextResponse.next()

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

    // 2.5s cap (not the 4s default): under heavy DB/worker load getUser() can stall, and middleware
    // runs on EVERY request — a long stall delays (and can truncate) the page's server render. Fail
    // open fast; per-route server components + RLS still enforce real auth.
    const userRes = await withTimeout(supabase.auth.getUser(), 2500)
    if (!userRes) {
      // Supabase didn't answer in 4s — fail open. Per-page server components
      // will still re-check auth using their own (non-edge) Supabase clients.
      return response
    }
    const user = userRes.data.user

    if (PROTECTED.some(p => pathname.startsWith(p)) && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Business-email gate — block NEW free-domain accounts (new personal-Gmail Google signups) from
    // the app; grandfather anyone created before the cutoff. Only enforced on protected routes so
    // blocked users can still reach public pages + sign out.
    if (user?.email && user.created_at && Date.parse(user.created_at) > BIZ_EMAIL_CUTOFF
        && isFreeEmail(user.email) && PROTECTED.some(p => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/business-email-required', request.url))
    }

    if ((pathname === '/login' || pathname === '/signup') && user) {
      // Land on the Morning Brief — Mello's report — not a dashboard or an empty canvas.
      return NextResponse.redirect(new URL('/brief', request.url))
    }

    // ── Onboarding gate ──────────────────────────────────────────
    // A first-timer must complete onboarding before using the app. Signup DOES route them to
    // /onboarding, but that was the ONLY enforcement — a refresh, a bookmark, or a direct link to
    // /brief slipped straight past it (middleware never checked), which is how someone "signed up and
    // never saw onboarding". Enforce it here on every protected page. Cookie-cached: once we see the
    // profile is onboarded we stamp sm_onb=1 and never read the DB again, so onboarded users (the vast
    // majority of requests) pay ZERO extra latency. Exempt pages a mid-onboarding user still needs
    // (billing/settings/meta/payment) so the gate can never trap them; /onboarding itself isn't
    // protected, so there's no redirect loop. Fail open on any DB hiccup — never block on a timeout.
    // The AUDIT is the onboarding now (/store-audit collects site + ads + competitor and creates the
    // brand). A first-timer who hasn't completed it is sent there — never to the retired /onboarding.
    const ONBOARD_EXEMPT = ['/billing', '/settings', '/connect-meta', '/payment', '/business-email-required', '/store-audit', '/onboarding']
    if (user && request.cookies.get('sm_onb')?.value !== '1'
        && PROTECTED.some(p => pathname.startsWith(p))
        && !ONBOARD_EXEMPT.some(p => pathname.startsWith(p))) {
      const onbRes = await withTimeout(
        Promise.resolve(
          supabase.from('user_profiles').select('onboarding_completed').eq('user_id', user.id).single()
        ),
        1500,
      )
      if (onbRes?.data) {
        if (!(onbRes.data as any).onboarding_completed) {
          return NextResponse.redirect(new URL('/store-audit', request.url))
        }
        // Onboarded — remember it so we skip this read on every future request (30 days).
        response.cookies.set('sm_onb', '1', { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' })
      }
      // onbRes null (timeout) → fail open; the next request re-checks when the DB is responsive.
    }

    // ── Subscription gate ────────────────────────────────────────
    if (user && REQUIRES_SUBSCRIPTION.some(p => pathname.startsWith(p))) {
      const profileRes = await withTimeout(
        Promise.resolve(
          supabase
            .from('user_profiles')
            .select('subscription_status, trial_ends_at')
            .eq('user_id', user.id)
            .single()
        ),
        1500,   // tight: this DB read is the most load-sensitive middleware step; fail open fast
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
  // Exclude ALL /api routes — they authenticate themselves (getUser/getSession in-handler) and return
  // JSON 401s, so they never need the middleware's redirect logic. Running getUser() (a ~300-500ms POST
  // to Supabase auth) in middleware on EVERY api call — db-search, credits/balance, notifications, on
  // every scroll — was the biggest source of Discovery slowness. Pages still get full middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
