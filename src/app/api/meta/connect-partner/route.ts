/**
 * The EASIEST Meta connect — the agency-partner model (what Triple Whale/Northbeam do).
 *
 * The founder adds Selfmade as a PARTNER in their own Business Settings (paste our Business ID,
 * tick their ad account — 60 seconds, a screen they've used for freelancers). No app creation, no
 * system users, no token handling on their side. Our ONE platform system-user token (minted once by
 * the admin in Selfmade's own Business Manager) then reads/manages any ad account shared with us.
 *
 *   GET  → { businessId }                       — our partner Business ID for the copy button
 *   POST { action:'list' }                      — client ad accounts shared with Selfmade (via
 *                                                 platform token) so the founder can pick theirs
 *   POST { accountIds:[...] }                   — save picked accounts to meta_accounts with the
 *                                                 ENCRYPTED PLATFORM token → every downstream
 *                                                 surface (sync, audit, M4) works unchanged
 *
 * Env: META_PLATFORM_BUSINESS_ID + META_PLATFORM_TOKEN (system-user token, never expires).
 * Dev-tier honesty: until our new app passes review, Meta caps how many ad accounts the platform
 * token can touch — fine for early users; the UX is already the final one.
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
const BIZ = process.env.META_PLATFORM_BUSINESS_ID || ''
const TOKEN = process.env.META_PLATFORM_TOKEN || ''

async function graph(path: string) {
  const r = await fetch(`${G}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`, { signal: AbortSignal.timeout(20000) })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(j.error.error_user_msg || j.error.message || 'Meta API error')
  return j
}

export async function GET() {
  if (!BIZ) return NextResponse.json({ error: 'Partner connect isn’t configured yet — use the token option below.' }, { status: 503 })
  return NextResponse.json({ businessId: BIZ })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Meta connect is a Creator feature — gate on the billing owner's plan (teammates inherit it).
  {
    const gateAdmin = createAdminClient()
    const owner = await resolveBillingOwner(gateAdmin, user.id)
    const gate = await requireFeature(gateAdmin, owner, 'launch')
    if (gate) return NextResponse.json(gate, { status: 402 })
  }
  if (!BIZ || !TOKEN) return NextResponse.json({ error: 'Partner connect isn’t configured yet — use the token option below.' }, { status: 503 })

  const body = await req.json().catch(() => ({}))

  // Ad accounts other businesses have shared WITH Selfmade (client accounts) + our own (for admin).
  let accounts: any[] = []
  try {
    const [client, owned] = await Promise.all([
      graph(`${BIZ}/client_ad_accounts?fields=id,account_id,name,currency,timezone_name,account_status&limit=200`).catch(() => ({ data: [] })),
      graph(`${BIZ}/owned_ad_accounts?fields=id,account_id,name,currency,timezone_name,account_status&limit=50`).catch(() => ({ data: [] })),
    ])
    accounts = [...(client.data || []), ...(owned.data || [])]
  } catch (e: any) {
    return NextResponse.json({ error: `Couldn’t read shared accounts from Meta: ${String(e?.message || e).slice(0, 160)}` }, { status: 502 })
  }

  if (body.action === 'list') {
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({ account_id: String(a.account_id || a.id).replace(/^act_/, ''), name: a.name, currency: a.currency, timezone: a.timezone_name, active: a.account_status === 1 })),
    })
  }

  const pick: string[] = Array.isArray(body.accountIds) ? body.accountIds.map((s: any) => String(s).replace(/^act_/, '')) : []
  const chosen = accounts.filter((a) => pick.includes(String(a.account_id || a.id).replace(/^act_/, '')))
  if (!chosen.length) return NextResponse.json({ error: 'Pick the ad account you shared with Selfmade.' }, { status: 400 })

  const admin = createAdminClient()
  const enc = encryptToken(TOKEN)   // platform token, encrypted like any other — downstream is door-agnostic
  const { data: existing } = await admin.from('meta_accounts').select('id').eq('user_id', user.id).limit(1)
  // ONE AD ACCOUNT PER BRAND: if a specific brand is active (the project switcher isn't on "All brands"),
  // link the account(s) being connected to THAT brand. Otherwise a freshly-connected account is brand_id
  // null → shows only under "All brands", and the active brand keeps saying "Connect Meta" even though
  // the account is right there. Link-on-connect is what makes "Aura → its own ad account" actually stick.
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

  let learned: any = null
  try { learned = await runMetaAudit(admin, user.id, { syncFirst: true }) } catch { /* audit lands via cron */ }

  return NextResponse.json({
    ok: true, connected: chosen.length,
    learned: learned ? { campaigns: learned.total, activeSpend: learned.spend, roas: learned.avgRoas, scale: learned.scale.length, watch: learned.watch.length, pause: learned.pause.length } : null,
  })
}
