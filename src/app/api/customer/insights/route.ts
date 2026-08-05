/**
 * GET /api/customer/insights?days=30 — the Customer Success trends report: what customers keep asking
 * about over the window, with a concrete fix for each theme. Read-only. Cached briefly so opening the
 * tab (or the daily brief) doesn't re-run the model every time.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateCustomerInsights, type CustomerInsights } from '@/lib/customer/insights'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const cache = new Map<string, { at: number; data: CustomerInsights }>()
const TTL = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30))
  const key = `${user.id}:${days}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL && req.nextUrl.searchParams.get('fresh') !== '1') {
    return NextResponse.json(hit.data)
  }

  const admin = createAdminClient()
  try {
    const data = await generateCustomerInsights(admin, user.id, { days })
    cache.set(key, { at: Date.now(), data })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: 'insights_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
