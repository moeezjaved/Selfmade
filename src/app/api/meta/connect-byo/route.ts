/**
 * POST /api/meta/connect-byo — "Teach Mello your ad account" without waiting for Meta app review.
 *
 * The BYO (bring-your-own) token door: the founder mints a System User token in their OWN Business
 * Settings (their business, their token — no app review involved) and pastes it here.
 *
 *   { token, action:'validate' }            → live-check the token, return the ad accounts it can see
 *   { token, accountIds:[...] }             → encrypt + save the picked accounts, first sync + audit,
 *                                             return what Mello learned (real numbers, immediately)
 *
 * Security: token validated server-side against Graph, AES-encrypted via the existing encryptToken,
 * never logged, never echoed back. Rows land in meta_accounts exactly like the OAuth door — every
 * downstream surface (sync, M4, reports, audits) is door-agnostic.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/meta/client'
import { runMetaAudit } from '@/lib/meta/audit'
import { resolveBillingOwner } from '@/lib/org'
import { requireFeature } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const V = process.env.META_API_VERSION || 'v20.0'
const G = `https://graph.facebook.com/${V}`

async function graph(path: string, token: string) {
  const r = await fetch(`${G}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20000) })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(j.error.error_user_msg || j.error.message || 'Meta API error')
  return j
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Meta connect + running ads is a Creator feature. Gate on the BILLING OWNER's plan so a Creator's
  // teammate is allowed, and a Free user gets a clean upgrade prompt instead of connecting.
  {
    const gateAdmin = createAdminClient()
    const owner = await resolveBillingOwner(gateAdmin, user.id)
    const gate = await requireFeature(gateAdmin, owner, 'launch')
    if (gate) return NextResponse.json(gate, { status: 402 })
  }

  const body = await req.json().catch(() => ({}))
  const token = String(body.token || '').trim()
  if (token.length < 30) return NextResponse.json({ error: 'That doesn’t look like a Meta token — paste the full System User token.' }, { status: 400 })

  // ── Validate live: who is this, and which ad accounts can it see? ──
  let me: any, accounts: any[]
  try {
    me = await graph('me?fields=id,name', token)
    const acc = await graph('me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status&limit=50', token)
    accounts = acc.data || []
  } catch (e: any) {
    const m = String(e?.message || e)
    const friendly = /expired|invalid|malformed|OAuth/i.test(m)
      ? 'Meta rejected this token. Generate a fresh System User token (with ads_read + ads_management) and paste it again.'
      : `Meta said: ${m.slice(0, 160)}`
    return NextResponse.json({ error: friendly }, { status: 400 })
  }
  if (!accounts.length) {
    return NextResponse.json({ error: 'The token is valid but can’t see any ad accounts. In Business Settings, assign your ad account(s) to the System User, then regenerate the token.' }, { status: 400 })
  }

  // ── Validate-only: show the founder what Mello CAN see, let them pick. ──
  if (body.action === 'validate') {
    return NextResponse.json({
      ok: true,
      name: me?.name || 'your business',
      accounts: accounts.map((a) => ({ account_id: String(a.account_id || a.id).replace(/^act_/, ''), name: a.name, currency: a.currency, timezone: a.timezone_name, active: a.account_status === 1 })),
    })
  }

  // ── Save: encrypt once, upsert each picked account (or all if none specified). ──
  const pick: string[] = Array.isArray(body.accountIds) && body.accountIds.length
    ? body.accountIds.map((s: any) => String(s).replace(/^act_/, ''))
    : accounts.map((a) => String(a.account_id || a.id).replace(/^act_/, ''))
  const chosen = accounts.filter((a) => pick.includes(String(a.account_id || a.id).replace(/^act_/, '')))
  if (!chosen.length) return NextResponse.json({ error: 'Pick at least one ad account.' }, { status: 400 })

  const admin = createAdminClient()
  const enc = encryptToken(token)
  const { data: existing } = await admin.from('meta_accounts').select('id').eq('user_id', user.id).limit(1)
  // ONE AD ACCOUNT PER BRAND: link the connected account(s) to the active brand so the brand stops
  // showing "Connect Meta" (see connect-partner). Null only under "All brands".
  let activeBrand: string | null = null
  try { const { resolveActiveBrandId } = await import('@/lib/brand/active'); activeBrand = await resolveActiveBrandId(admin, user.id).catch(() => null) } catch { /* All-brands → leave null */ }
  for (let i = 0; i < chosen.length; i++) {
    const a = chosen[i]
    await admin.from('meta_accounts').upsert({
      user_id: user.id,
      account_id: String(a.account_id || a.id).replace(/^act_/, ''),
      account_name: a.name || 'Ad account',
      access_token: enc,
      currency: a.currency || 'USD',
      timezone: a.timezone_name || 'America/New_York',
      status: 'active',
      is_primary: !existing?.length && i === 0,
      ...(activeBrand ? { brand_id: activeBrand } : {}),
    }, { onConflict: 'user_id,account_id' })
  }

  // ── First sync + audit, inline — so the read-back has REAL numbers and tomorrow's brief has the
  // audit. Best-effort: a slow Graph never blocks the connect itself. ──
  let learned: any = null
  try { learned = await runMetaAudit(admin, user.id, { syncFirst: true }) } catch { /* audit lands via cron instead */ }

  return NextResponse.json({
    ok: true,
    connected: chosen.length,
    name: me?.name || 'your business',
    learned: learned ? {
      campaigns: learned.total, activeSpend: learned.spend, roas: learned.avgRoas,
      scale: learned.scale.length, watch: learned.watch.length, pause: learned.pause.length,
    } : null,
  })
}
