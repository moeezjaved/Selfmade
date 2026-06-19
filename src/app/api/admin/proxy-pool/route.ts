/**
 * Admin Proxy Pool API.
 *
 * Manages the proxy_pool table that drives the worker's round-robin proxy
 * picker (worker/src/proxy-pool.ts).
 *
 * Endpoints:
 *   GET    /api/admin/proxy-pool          — list proxies + per-IP metrics (p50/p95 latency, error rate, last-24h crawls)
 *   POST   /api/admin/proxy-pool          — { label, host, port, username, password, country?, isp?, notes? }
 *   PATCH  /api/admin/proxy-pool          — { id, enabled?, label?, notes? }
 *   DELETE /api/admin/proxy-pool?id=XX    — remove a proxy
 *
 * Alert logic (computed server-side, returned in GET response):
 *   - 🟡 any IP with p95 latency > 3000ms in last 24h → "consider adding 1 IP"
 *   - 🔴 any IP with error rate > 5% in last 1h        → "IP may be flagged"
 *   - 🔴 fewer than 2 enabled IPs                      → "single point of failure"
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 3600_000).toISOString()
  const hourAgo = new Date(now - 3600_000).toISOString()

  const { data: proxies } = await admin
    .from('proxy_pool')
    .select('id, label, provider, host, port, country, isp, enabled, disabled_at, disabled_reason, added_at, last_used_at, notes')
    .order('added_at', { ascending: true })

  const enriched = await Promise.all((proxies || []).map(async (p: any) => {
    const { data: events24h } = await admin
      .from('proxy_pool_events')
      .select('kind, latency_ms, http_status, bytes, ts')
      .eq('proxy_pool_id', p.id)
      .gte('ts', dayAgo)
      .order('ts', { ascending: false })
      .limit(5000)

    const evs = events24h || []
    const crawls24h = evs.filter((e: any) => e.kind === 'crawl').length
    const errors24h = evs.filter((e: any) => e.kind === 'error').length
    const evsHour = evs.filter((e: any) => e.ts >= hourAgo)
    const crawlsHour = evsHour.filter((e: any) => e.kind === 'crawl').length
    const errorsHour = evsHour.filter((e: any) => e.kind === 'error').length
    const errorRateHour = (crawlsHour + errorsHour) > 0 ? errorsHour / (crawlsHour + errorsHour) : 0

    const latencies = evs
      .filter((e: any) => e.latency_ms !== null && e.kind === 'crawl')
      .map((e: any) => e.latency_ms as number)
    const bytes24h = evs.reduce((s: number, e: any) => s + (e.bytes ?? 0), 0)

    let status: 'healthy' | 'slow' | 'flagged' | 'disabled' = 'healthy'
    if (!p.enabled) status = 'disabled'
    else if (errorRateHour > 0.05) status = 'flagged'
    else if (pct(latencies, 95) > 3000) status = 'slow'

    return {
      ...p,
      crawls_24h: crawls24h,
      errors_24h: errors24h,
      crawls_1h: crawlsHour,
      errors_1h: errorsHour,
      error_rate_1h: Math.round(errorRateHour * 1000) / 10, // percentage
      p50_latency_ms: pct(latencies, 50),
      p95_latency_ms: pct(latencies, 95),
      bytes_24h: bytes24h,
      status,
    }
  }))

  const enabled = enriched.filter((p: any) => p.enabled)
  const alerts: Array<{ level: 'warn' | 'crit'; message: string }> = []
  if (enabled.length < 2 && enabled.length > 0) {
    alerts.push({ level: 'crit', message: `Only ${enabled.length} proxy enabled — single point of failure. Add backup IPs.` })
  }
  for (const p of enriched) {
    if (p.status === 'flagged') alerts.push({ level: 'crit', message: `${p.label} (${p.host}) — ${p.error_rate_1h}% errors in last hour. May be flagged; consider swapping.` })
    if (p.status === 'slow') alerts.push({ level: 'warn', message: `${p.label} (${p.host}) — p95 latency ${(p.p95_latency_ms / 1000).toFixed(1)}s. Consider adding 1 IP to reduce load.` })
  }

  return NextResponse.json({
    proxies: enriched,
    summary: {
      total: enriched.length,
      enabled: enabled.length,
      disabled: enriched.length - enabled.length,
      total_crawls_24h: enriched.reduce((s, p: any) => s + p.crawls_24h, 0),
      total_errors_24h: enriched.reduce((s, p: any) => s + p.errors_24h, 0),
    },
    alerts,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { label, host, port, username, password, country, isp, notes, provider } = body
  if (!label || !host || !port || !username || !password) {
    return NextResponse.json({ error: 'label, host, port, username, password required' }, { status: 400 })
  }

  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('proxy_pool')
    .insert({
      label, host, port: Number(port), username, password,
      country: country || null,
      isp: isp || null,
      notes: notes || null,
      provider: provider || 'proxycheap',
      enabled: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ proxy: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { id, enabled, label, notes, disabled_reason } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient() as any
  const patch: any = {}
  if (typeof enabled === 'boolean') {
    patch.enabled = enabled
    patch.disabled_at = enabled ? null : new Date().toISOString()
    patch.disabled_reason = enabled ? null : (disabled_reason || 'manually disabled')
  }
  if (label !== undefined) patch.label = label
  if (notes !== undefined) patch.notes = notes

  const { data, error } = await admin.from('proxy_pool').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ proxy: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient() as any
  const { error } = await admin.from('proxy_pool').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
