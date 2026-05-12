/**
 * Admin Token Pool API
 *
 * GET    /api/admin/tokens           — list all meta_accounts with pool status + cooldown
 * PATCH  /api/admin/tokens           — { id, is_indexer_pool: bool } toggle pool membership
 * POST   /api/admin/tokens/test      — { id } run a dry hit against Meta to verify token health
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('meta_accounts')
    .select('id, user_id, account_name, account_id, is_indexer_pool, cooldown_until, last_used_at, total_calls, calls_today, created_at, status')
    .order('is_indexer_pool', { ascending: false })
    .order('created_at', { ascending: false })

  const now = Date.now()
  const enriched = (rows || []).map((r: any) => {
    const cooldownMs = r.cooldown_until ? new Date(r.cooldown_until).getTime() : 0
    const isCooling = cooldownMs > now
    const cooldownRemainingMin = isCooling ? Math.ceil((cooldownMs - now) / 60_000) : 0
    return {
      ...r,
      is_cooling: isCooling,
      cooldown_remaining_min: cooldownRemainingMin,
    }
  })

  const pool = enriched.filter((r: any) => r.is_indexer_pool)
  return NextResponse.json({
    accounts: enriched,
    pool_summary: {
      total: pool.length,
      cooling: pool.filter((r: any) => r.is_cooling).length,
      available: pool.filter((r: any) => !r.is_cooling).length,
      // Theoretical hourly capacity (200 calls/hr per token is Meta's default for user tokens)
      est_calls_per_hour: pool.length * 200,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { id, is_indexer_pool, clear_cooldown } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const update: Record<string, any> = {}
  if (typeof is_indexer_pool === 'boolean') update.is_indexer_pool = is_indexer_pool
  if (clear_cooldown) update.cooldown_until = null

  const { error } = await admin.from('meta_accounts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  // Manual token test — hit Meta with a tiny query to verify it's not blocked
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: acc } = await admin
    .from('meta_accounts')
    .select('access_token')
    .eq('id', id)
    .single()
  if (!acc) return NextResponse.json({ error: 'account not found' }, { status: 404 })

  const token = decryptToken(acc.access_token)
  if (!token) return NextResponse.json({ error: 'token decrypt failed' }, { status: 500 })

  // Cheapest possible Meta call: fetch own /me. Doesn't count toward Ads Library quota.
  try {
    const res = await fetch(`https://graph.facebook.com/${V}/me?access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    if (data.error) return NextResponse.json({ ok: false, error: data.error.message })
    return NextResponse.json({ ok: true, name: data.name, id: data.id })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message ?? e) })
  }
}
