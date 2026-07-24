/**
 * End the free trial NOW and unlock the full plan credit pool.
 *
 * POST → sets the Stripe subscription's trial_end to 'now' (Stripe immediately invoices + charges the
 * card on file), then — if the charge put the sub into 'active' — clears the trial credit cap and
 * grants the full plan allotment right away (the webhook does the same on its own; this makes the UI
 * update instant). If the card fails, the sub goes past_due/incomplete and we report that back.
 *
 * Only the workspace/billing owner (the account with the subscription row) can do this.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const admin = createAdminClient()
  const { data: subRow } = await admin.from('subscriptions')
    .select('stripe_subscription_id, plan, status')
    .eq('owner_id', user.id).maybeSingle()
  const subId = (subRow as any)?.stripe_subscription_id as string | undefined
  if (!subId) return NextResponse.json({ error: 'no_subscription', message: 'You’re on the Free plan — there’s no trial to unlock. Choose a plan to add credits.' }, { status: 400 })
  if ((subRow as any)?.status && (subRow as any).status !== 'trialing') {
    return NextResponse.json({ error: 'not_on_trial', message: 'This subscription is not on a trial.' }, { status: 400 })
  }

  const { stripe } = await import('@/lib/stripe')
  try {
    // Ending the trial triggers an immediate invoice + charge on the saved card.
    const updated = await stripe.subscriptions.update(subId, { trial_end: 'now', proration_behavior: 'none' })

    if (updated.status === 'active') {
      const plan = (subRow as any)?.plan as string | undefined
      const periodEnd = new Date((updated as any).current_period_end * 1000).toISOString()
      // Clear the trial cap + grant the full pool now (idempotent with the webhook).
      await admin.from('subscriptions').update({ monthly_credits_override: null, status: 'active', updated_at: new Date().toISOString() }).eq('owner_id', user.id)
      await admin.from('user_profiles').update({ subscription_status: 'active' }).eq('user_id', user.id)
      if (plan) await admin.rpc('apply_plan', { p_user: user.id, p_plan: plan, p_reset: periodEnd })
      return NextResponse.json({ ok: true, status: 'active' })
    }

    // Charge didn't clear (declined / requires action) — surface it so the UI can prompt to update the card.
    return NextResponse.json({ ok: false, status: updated.status, message: 'Payment didn’t go through. Please update your card in Billing.' }, { status: 402 })
  } catch (e: any) {
    return NextResponse.json({ error: 'stripe_error', message: String(e?.message || e) }, { status: 502 })
  }
}
