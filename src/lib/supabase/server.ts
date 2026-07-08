import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server component — cookies can't be set (read-only)
          }
        },
      },
    }
  )
}

// Admin client with service role — bypasses RLS, talks to the PRIMARY (writable).
// Only use in API routes, NEVER in client components. Use for any route that WRITES
// (follows, saves, mello) and wherever strong read-after-write is required.
// Force cache:'no-store' on every supabase REST call. Without this, Next.js's Data Cache
// caches supabase-js's fetch() keyed on the PostgREST URL — so a brand read once mid-crawl
// (0 ads) stays cached at 0 even after it's fully crawled. no-store guarantees fresh reads.
const noStoreFetch = (url: any, opts: any = {}) => fetch(url, { ...opts, cache: 'no-store' })

export function createAdminClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: noStoreFetch } }
  )
}

// ── Ingestion ↔ serving split ────────────────────────────────────────────────
// READ-ONLY client for serving (the heavy discovery SELECTs). When SUPABASE_READ_URL
// is set to a Supabase READ REPLICA's API URL, all serving reads hit the replica, so
// a crawl/drain write spike on the primary can never slow (or 504) the product. Until
// a replica is provisioned + the env is set, it transparently falls back to the
// primary URL — identical behavior, zero risk to deploy now. Service role bypasses
// RLS; API routes only. NEVER write through this client (a replica is read-only).
export function createReadClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.SUPABASE_READ_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: noStoreFetch } }
  )
}
