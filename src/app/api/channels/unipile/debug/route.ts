/**
 * Unipile connection diagnostics. Auth-gated (any signed-in user). Reports whether the server's Unipile
 * env is present and — crucially — LIVE-PROBES Unipile with the configured DSN + key so a failing
 * "Connect" is diagnosable without guessing. Never returns the API key itself (only a masked fingerprint),
 * so it's safe to hit from the browser: GET /api/channels/unipile/debug
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawDsn = (process.env.UNIPILE_DSN || '').trim()
  const rawKey = (process.env.UNIPILE_API_KEY || '').trim()
  let dsn = rawDsn.replace(/\/+$/, '')
  if (dsn && !/^https?:\/\//i.test(dsn)) dsn = `https://${dsn}`

  const out: any = {
    configured: !!(rawDsn && rawKey),
    dsn_host: dsn ? (() => { try { return new URL(dsn).host } catch { return `UNPARSEABLE:${dsn.slice(0, 40)}` } })() : null,
    api_key_set: !!rawKey,
    api_key_fingerprint: rawKey ? `${rawKey.slice(0, 4)}…${rawKey.slice(-2)} (len ${rawKey.length})` : null,
    webhook_secret_set: !!process.env.UNIPILE_WEBHOOK_SECRET,
    app_url: (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, ''),
  }

  // Live probe: a cheap authenticated GET. 200 = DSN + key are valid for this account. 401/403 = the key
  // is wrong/rotated or belongs to a different region than the DSN (the classic post-subscription break).
  if (out.configured && out.dsn_host && !String(out.dsn_host).startsWith('UNPARSEABLE')) {
    try {
      const res = await fetch(`${dsn}/api/v1/accounts?limit=1`, { headers: { accept: 'application/json', 'X-API-KEY': rawKey } })
      const body = await res.text().catch(() => '')
      out.probe = {
        status: res.status,
        ok: res.ok,
        hint: res.ok ? 'DSN + API key are valid ✓'
          : (res.status === 401 || res.status === 403) ? 'Rejected — wrong/rotated API key, or DSN points at the wrong region for this key.'
          : res.status === 404 ? 'DSN host reachable but path 404 — check the DSN value.'
          : `Unexpected status ${res.status}.`,
        body: body.slice(0, 300),
      }
    } catch (e: any) {
      out.probe = { status: 0, ok: false, hint: 'Could not reach the DSN host — the DSN is wrong or unreachable.', error: String(e?.message || e).slice(0, 200) }
    }
  }

  return NextResponse.json(out)
}
