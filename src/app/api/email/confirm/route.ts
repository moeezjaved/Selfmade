/**
 * Email confirm (double opt-in landing). GET /api/email/confirm?token=...
 * Sets user_profiles.email_confirmed_at for the matching token and shows a branded success page.
 * Marketing senders (daily winning-ad alerts / weekly digest) only send to confirmed users.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="margin:0;background:#eef5eb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
    <div style="max-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center;">
      <div style="color:#dffe95;background:#1a3a1a;display:inline-block;padding:8px 16px;border-radius:10px;font-weight:800;margin-bottom:18px;">Selfmade</div>
      <h1 style="color:#111;font-size:22px;margin:0 0 10px;">${title}</h1>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 22px;">${body}</p>
      <a href="${(process.env.APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')}/discovery" style="display:inline-block;background:#1a3a1a;color:#dffe95;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:10px;">Go to Selfmade</a>
    </div>
  </body></html>`
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const html = (t: string, b: string) => new NextResponse(page(t, b), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  if (!token) return html('Invalid link', 'This confirmation link is missing its token.')

  const admin = createAdminClient()
  const { data: prof } = await admin.from('user_profiles').select('id, email_confirmed_at').eq('email_confirm_token', token).maybeSingle()
  if (!prof) return html('Link expired', 'This confirmation link is no longer valid. You can re-trigger it from Settings.')

  if (!(prof as any).email_confirmed_at) {
    await admin.from('user_profiles').update({ email_confirmed_at: new Date().toISOString() }).eq('id', (prof as any).id)
  }
  return html("You're all set ✓", 'Your email is confirmed. You’ll now get fresh winning-ad picks straight to your inbox.')
}
