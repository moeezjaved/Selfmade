/**
 * Admin Token Pool API — operates exclusively on the indexer_tokens table.
 *
 * ARCHITECTURAL ISOLATION: Never touches meta_accounts. The crawler token
 * infrastructure is fully separated from end-user OAuth state.
 *
 * Endpoints:
 *   GET    /api/admin/tokens         — list all pool tokens + summary
 *   POST   /api/admin/tokens         — { label, raw_token } add a new token
 *                                      (validates via /me, exchanges to long-lived,
 *                                      stores encrypted)
 *   PATCH  /api/admin/tokens         — { id, is_active?, clear_cooldown? }
 *   DELETE /api/admin/tokens?id=XX   — remove a token from the pool
 *   POST   /api/admin/tokens/test    — { id } health-check a token via /me
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { encryptToken, decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'
const META_APP_ID = process.env.META_APP_ID
const META_APP_SECRET = process.env.META_APP_SECRET

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: rows } = await (admin as any)
    .from('indexer_tokens')
    .select('id, label, fb_user_id, fb_user_name, expires_at, cooldown_until, last_used_at, total_calls, is_active, created_at')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })

  const now = Date.now()
  const enriched = (rows || []).map((r: any) => {
    const cooldownMs = r.cooldown_until ? new Date(r.cooldown_until).getTime() : 0
    const isCooling = cooldownMs > now
    const expiresMs = r.expires_at ? new Date(r.expires_at).getTime() : 0
    const daysUntilExpiry = expiresMs ? Math.ceil((expiresMs - now) / 86_400_000) : null
    return {
      ...r,
      is_cooling: isCooling,
      cooldown_remaining_min: isCooling ? Math.ceil((cooldownMs - now) / 60_000) : 0,
      days_until_expiry: daysUntilExpiry,
      expires_soon: daysUntilExpiry !== null && daysUntilExpiry <= 7,
    }
  })

  const active = enriched.filter((r: any) => r.is_active)
  return NextResponse.json({
    accounts: enriched,
    pool_summary: {
      total: active.length,
      cooling: active.filter((r: any) => r.is_cooling).length,
      available: active.filter((r: any) => !r.is_cooling).length,
      expiring_soon: active.filter((r: any) => r.expires_soon).length,
      // Theoretical hourly capacity (200 calls/hr per token is Meta's typical user-token limit)
      est_calls_per_hour: active.length * 200,
    },
  })
}

/**
 * POST — add a new token to the pool.
 * Body: { label: string, raw_token: string }
 *
 * Steps:
 * 1. Validate label + token
 * 2. Call Meta /me with the token to verify it works (also captures fb_user_id/name)
 * 3. Try to exchange short-lived → long-lived (60-day) token via fb_exchange_token
 *    (no-op if already long-lived; returns same token)
 * 4. Encrypt the long-lived token with our AES key
 * 5. Insert into indexer_tokens with is_active=true
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const label = (body.label || '').toString().trim()
  const rawToken = (body.raw_token || '').toString().trim()
  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 })
  if (!rawToken) return NextResponse.json({ error: 'raw_token required' }, { status: 400 })
  if (!rawToken.startsWith('EAA')) {
    return NextResponse.json({ error: 'invalid token — should start with EAA' }, { status: 400 })
  }

  // Step 1 — verify token works by calling /me
  let fbUserId = ''
  let fbUserName = ''
  try {
    const res = await fetch(
      `https://graph.facebook.com/${V}/me?fields=id,name&access_token=${encodeURIComponent(rawToken)}`,
      { signal: AbortSignal.timeout(10_000) },
    )
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: `Meta validation failed: ${data.error.message}` }, { status: 400 })
    fbUserId = data.id || ''
    fbUserName = data.name || ''
  } catch (e: any) {
    return NextResponse.json({ error: `Meta /me call failed: ${e.message ?? e}` }, { status: 500 })
  }

  // Step 2 — exchange short-lived → long-lived token (60 days).
  // If the token is already long-lived, Meta returns the same token + new expiry.
  // If app credentials missing, we skip and store the raw token (will expire sooner).
  let longLivedToken = rawToken
  let expiresAt: Date | null = null
  if (META_APP_ID && META_APP_SECRET) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${V}/oauth/access_token?` + new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          fb_exchange_token: rawToken,
        }),
        { signal: AbortSignal.timeout(10_000) },
      )
      const data = await res.json()
      if (!data.error && data.access_token) {
        longLivedToken = data.access_token
        // expires_in is seconds; default 60 days if not provided
        const seconds = Number(data.expires_in) || 60 * 86400
        expiresAt = new Date(Date.now() + seconds * 1000)
      }
    } catch {
      // Exchange failed — keep raw token, no expires_at recorded
    }
  }
  if (!expiresAt) {
    // Conservative default — assume 1 hour if exchange failed (admin will see "expires soon" warning)
    expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  }

  // Step 3 — encrypt and insert
  const encryptedToken = encryptToken(longLivedToken)
  const admin = createAdminClient()
  const { data, error } = await (admin as any)
    .from('indexer_tokens')
    .insert({
      label,
      access_token: encryptedToken,
      fb_user_id: fbUserId || null,
      fb_user_name: fbUserName || null,
      expires_at: expiresAt.toISOString(),
      is_active: true,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    token: {
      id: data.id,
      label: data.label,
      fb_user_name: fbUserName,
      expires_at: data.expires_at,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { id, is_active, clear_cooldown } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const update: Record<string, any> = { updated_at: new Date().toISOString() }
  if (typeof is_active === 'boolean') update.is_active = is_active
  if (clear_cooldown) update.cooldown_until = null

  const { error } = await (admin as any).from('indexer_tokens').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await (admin as any).from('indexer_tokens').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
