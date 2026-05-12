/**
 * Admin diagnostic — tests the META_PROXY_* connection by making one call
 * through the proxy to a free "what's my IP" service. Shows exactly where
 * the proxy fails (env vars, auth, network, TLS, etc.) without depending
 * on Meta's API.
 *
 * GET /api/admin/proxy-test
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proxyFetch, metaProxyEnabled } from '@/lib/meta/proxy'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result: any = {
    env_vars_present: metaProxyEnabled,
    META_PROXY_HOST_set: !!process.env.META_PROXY_HOST,
    META_PROXY_PORT_set: !!process.env.META_PROXY_PORT,
    META_PROXY_USER_set: !!process.env.META_PROXY_USER,
    META_PROXY_PASS_set: !!process.env.META_PROXY_PASS,
    META_PROXY_HOST_value: process.env.META_PROXY_HOST?.slice(0, 30) || '(empty)',
    META_PROXY_PORT_value: process.env.META_PROXY_PORT || '(empty)',
    META_PROXY_USER_first6: process.env.META_PROXY_USER?.slice(0, 6) + '...' || '(empty)',
    META_PROXY_PASS_first4: process.env.META_PROXY_PASS?.slice(0, 4) + '...' || '(empty)',
  }

  // Test 1: direct fetch to icanhazip (no proxy) — confirms baseline network works
  try {
    const t0 = Date.now()
    const res = await fetch('https://ipv4.icanhazip.com', { signal: AbortSignal.timeout(8000) })
    const ip = (await res.text()).trim()
    result.direct_fetch = { ok: true, latency_ms: Date.now() - t0, your_ip: ip }
  } catch (e: any) {
    result.direct_fetch = { ok: false, error: e?.message || String(e), code: e?.code }
  }

  // Test 2: proxy fetch to icanhazip — should return a DIFFERENT IP if proxy works
  if (metaProxyEnabled) {
    try {
      const t0 = Date.now()
      const res = await proxyFetch('https://ipv4.icanhazip.com', { signal: AbortSignal.timeout(15000) })
      const ip = (await res.text()).trim()
      result.proxy_fetch = {
        ok: true,
        latency_ms: Date.now() - t0,
        proxy_ip: ip,
        is_different: ip !== result.direct_fetch?.your_ip,
      }
    } catch (e: any) {
      result.proxy_fetch = {
        ok: false,
        error: e?.message || String(e),
        code: e?.code || e?.cause?.code,
        cause: e?.cause ? { message: e.cause.message, code: e.cause.code } : undefined,
      }
    }
  } else {
    result.proxy_fetch = { skipped: 'env vars not set' }
  }

  return NextResponse.json(result, { status: 200 })
}
