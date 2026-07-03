/**
 * Auto-refill rule (spec §3.2): "when my balance drops below X, auto-buy pack Y". Stores the rule on
 * the wallet. Gated on canBuyCredits. The actual off-session charge fires from the spend path once a
 * saved payment method + Stripe prices exist (see maybeAutoRefill note); this persists the rule now.
 * GET → { threshold, pack } · POST { threshold, pack } · POST { threshold:null } to disable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/entitlements'
import { TOPUP_PACKS } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('credit_wallets').select('autorefill_threshold, autorefill_pack').eq('owner_id', user.id).maybeSingle()
  return NextResponse.json({ threshold: (data as any)?.autorefill_threshold ?? null, pack: (data as any)?.autorefill_pack ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const gate = await requireFeature(admin, user.id, 'canBuyCredits')
  if (gate) return NextResponse.json(gate, { status: 402 })

  const { threshold, pack } = await req.json().catch(() => ({}))
  if (threshold != null) {
    if (!TOPUP_PACKS.find((p) => p.id === pack)) return NextResponse.json({ error: 'invalid_pack' }, { status: 400 })
    if (typeof threshold !== 'number' || threshold < 0) return NextResponse.json({ error: 'invalid_threshold' }, { status: 400 })
  }
  await admin.from('credit_wallets').update({ autorefill_threshold: threshold ?? null, autorefill_pack: threshold != null ? pack : null }).eq('owner_id', user.id)
  return NextResponse.json({ ok: true, threshold: threshold ?? null, pack: threshold != null ? pack : null })
}
