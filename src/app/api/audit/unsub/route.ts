/**
 * GET /api/audit/unsub?t=<token> — one-click unsubscribe from the audit nurture drip. Public; returns a
 * small confirmation page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { unsubscribeAuditLead } from '@/lib/audit/leads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') || ''
  const ok = await unsubscribeAuditLead(createAdminClient() as any, t)
  const msg = ok ? 'You’re unsubscribed. You won’t get any more audit emails.' : 'That link is invalid or already used.'
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f3eee3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;">
      <div style="max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;">
        <div style="background:#ef4a1e;color:#fff;font-weight:800;border-radius:10px;display:inline-block;padding:6px 12px;font-size:14px;">Selfmade</div>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:18px 0 0;">${msg}</p>
      </div>
    </body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
