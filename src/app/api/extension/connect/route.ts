/**
 * Form target for the /extension/auth "Connect" button. Session-cookie authed. Mints (or reuses) the
 * user's extension token, then hands it to the extension by 303-redirecting to
 * <redirect_uri>#token=…&email=…  (Chrome's launchWebAuthFlow captures that navigation). When there's
 * no redirect_uri (a human opened the page directly) we render the token to copy manually.
 *
 * Native <form> POST → this route: no client JS, so it survives pages where other browser extensions
 * break React hydration. Not gated by the 'api' entitlement — saving from the web is a core feature.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LABEL = 'Chrome Extension'

async function mintToken(userId: string): Promise<string | null> {
  const admin = createAdminClient() as any
  const { data: existing } = await admin.from('mcp_keys')
    .select('token').eq('user_id', userId).eq('label', LABEL).eq('revoked', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.token) return existing.token
  const token = 'sk_mcp_' + randomBytes(24).toString('hex')
  const { error } = await admin.from('mcp_keys').insert({ user_id: userId, label: LABEL, token })
  return error ? null : token
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const form = await request.formData().catch(() => null)
  const redirectUri = (form?.get('redirect_uri') as string) || ''

  if (!user) {
    const next = `/extension/auth${redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : ''}`
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url), 303)
  }

  const token = await mintToken(user.id)
  if (!token) return htmlPage('Something went wrong minting your token. Please try again.', true)

  if (redirectUri) {
    const dest = `${redirectUri}#token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email || '')}`
    return NextResponse.redirect(dest, 303)
  }
  // No redirect_uri → show the key to paste manually.
  return htmlPage(`Copy this key into the Selfmade extension:</p><code style="display:block;word-break:break-all;background:#f3f5f2;border:1px solid #e2e6e0;border-radius:10px;padding:12px;font:12px monospace;color:#243d20;margin-top:8px">${token}</code><p style="margin-top:14px">✅ Connected — you can close this tab.`)
}

function htmlPage(inner: string, isError = false): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f5;font-family:'Inter',-apple-system,sans-serif;padding:20px">
  <div style="max-width:420px;background:#fff;border:1px solid #ececec;border-radius:20px;box-shadow:0 10px 40px rgba(14,27,18,.06);padding:32px 30px;text-align:center">
    <div style="width:54px;height:54px;border-radius:15px;background:${isError ? '#fef2f2' : '#f0fdf4'};border:1px solid ${isError ? '#fecaca' : '#bbf7d0'};display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:27px">${isError ? '⚠️' : '🧩'}</div>
    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px">Selfmade extension</h1>
    <p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0">${inner}</p>
  </div>
</div>`
  return new NextResponse(html, { status: isError ? 400 : 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}
