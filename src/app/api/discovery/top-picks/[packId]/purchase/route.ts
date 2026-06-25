/**
 * Top Picks — unlock a pack for the current user.
 *
 * PAYMENT RAIL IS NOT WIRED YET (the monetization model — Stripe one-time vs variable-credit
 * spend vs Core-subscription gate — is still an open product decision). So this records the
 * unlock (which the gating in [packId]/route.ts reads) but does NOT charge:
 *   • 'free' packs            → always unlock, $0.
 *   • paid/core packs         → unlock ONLY when TOP_PICKS_FREE_UNLOCK=1 (dev/preview); otherwise
 *                               402 "payment not configured". This keeps prod safe — no one gets a
 *                               paid pack for free by default.
 *
 * TO WIRE PAYMENT, replace the `chargeGate` block:
 *   • Stripe: create a Checkout Session for pack.price_cents, return its url; insert the purchase
 *     row from the webhook on `checkout.session.completed`.
 *   • Credits: add a variable-amount spend RPC (the existing reserve/commit is fixed-cost by
 *     action_type), deduct pack.price_cents (1 credit = 1¢), then insert the purchase row.
 * On a real sale, also credit the expert's revenue share (experts.revenue_share_pct).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: pack } = await admin
    .from('expert_packs')
    .select('id, price_cents, gate, is_published')
    .eq('id', packId).maybeSingle()
  if (!pack || !pack.is_published) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Already unlocked?
  const { data: existing } = await admin
    .from('expert_pack_purchases')
    .select('id').eq('user_id', user.id).eq('pack_id', packId).maybeSingle()
  if (existing) return NextResponse.json({ success: true, unlocked: true, already: true })

  // ── chargeGate ────────────────────────────────────────────────────────────
  const isFree = pack.gate === 'free' || pack.price_cents === 0
  if (!isFree && process.env.TOP_PICKS_FREE_UNLOCK !== '1') {
    return NextResponse.json(
      { error: 'payment_not_configured', message: 'Checkout for paid packs is not wired yet.' },
      { status: 402 },
    )
  }
  // ──────────────────────────────────────────────────────────────────────────

  const { error } = await admin.from('expert_pack_purchases').insert({
    user_id: user.id, pack_id: packId, price_paid_cents: isFree ? 0 : pack.price_cents,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, unlocked: true })
}
