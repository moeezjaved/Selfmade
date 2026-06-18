/**
 * Diagnostic endpoint — shows which R2 env vars are set/missing.
 * Does NOT leak secret values, only "set" or "missing".
 *
 * GET /api/thumbnails/check-env
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth: any logged-in user OR cron secret
  const cronSecret = process.env.CRON_SECRET
  const secret = req.nextUrl.searchParams.get('secret')
  let authed = !cronSecret || secret === cronSecret
  if (!authed) {
    try {
      const sb = await createClient()
      const { data: { user } } = await sb.auth.getUser()
      authed = !!user
    } catch { /* ignore */ }
  }
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
    'BROWSERLESS_TOKEN',
  ]

  const status: Record<string, { set: boolean; preview?: string; length?: number }> = {}
  for (const k of required) {
    const v = process.env[k]
    if (v) {
      status[k] = {
        set: true,
        length: v.length,
        // Show only first 4 + last 4 chars so you can verify it's the right value
        // without leaking the secret
        preview: v.length > 12 ? `${v.slice(0, 4)}...${v.slice(-4)}` : '(short)',
      }
    } else {
      status[k] = { set: false }
    }
  }

  const missing = required.filter(k => !status[k].set)

  return NextResponse.json({
    all_set: missing.length === 0,
    missing,
    status,
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'unknown',
    vercel_env: process.env.VERCEL_ENV || 'unknown',
    fix: missing.length > 0
      ? `Add these to Vercel → Settings → Environment Variables, enable for Production, then REDEPLOY: ${missing.join(', ')}`
      : '✅ All env vars set. If /api/thumbnails still says "not configured", redeploy with cache disabled.',
  })
}
