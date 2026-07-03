import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
})

export const PLANS = {
  monthly: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY!,
    amount: 4900,   // $49.00 in cents
    interval: 'month' as const,
    label: 'Pro Monthly',
  },
  annual: {
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL!,
    amount: 47040,  // $39.20/mo × 12 = $470.40/year (20% off)
    interval: 'year' as const,
    label: 'Pro Annual',
  },
} as const

// Create or retrieve Stripe customer
export async function getOrCreateCustomer(userId: string, email: string, name?: string) {
  // Check if customer exists in Supabase
  const { createAdminClient } = await import('@/lib/supabase/server')
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()

  if (profile?.stripe_customer_id) {
    return await stripe.customers.retrieve(profile.stripe_customer_id) as Stripe.Customer
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name: name || email,
    metadata: { user_id: userId },
  })

  // Save to Supabase
  await supabase
    .from('user_profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('user_id', userId)

  return customer
}

// Create checkout session
export async function createCheckoutSession(params: {
  userId: string
  email: string
  name?: string
  plan: 'monthly' | 'annual'
  successUrl: string
  cancelUrl: string
}) {
  const customer = await getOrCreateCustomer(params.userId, params.email, params.name)
  const planConfig = PLANS[params.plan]

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 7,
      metadata: { user_id: params.userId },
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { user_id: params.userId },
    allow_promotion_codes: true,
  })

  return session
}

// Create customer portal session
export async function createPortalSession(customerId: string, returnUrl: string) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

// Handle Stripe webhook events
export async function handleStripeWebhook(payload: string, signature: string) {
  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  )

  const { createAdminClient } = await import('@/lib/supabase/server')
  const supabase = createAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const ownerId = session.metadata?.owner_id || session.metadata?.user_id

      // ── Top-up pack (one-time payment) → grant credits + FIFO purchase row ──
      if (session.mode === 'payment' && session.metadata?.topup_pack && ownerId) {
        const credits = parseInt(session.metadata.topup_credits || '0', 10)
        const amount = parseFloat(session.metadata.amount_usd || '0')
        if (credits > 0) {
          await supabase.rpc('grant_topup_pack', { p_user: ownerId, p_credits: credits, p_amount: amount, p_stripe: session.payment_intent as string })
        }
        break
      }

      // ── Subscription plan upgrade ──
      const userId = ownerId
      if (!userId) break
      const subscriptionId = session.subscription as string
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const plan = session.metadata?.plan
      const cycle = session.metadata?.cycle || 'monthly'
      const periodEnd = new Date((sub as any).current_period_end * 1000).toISOString()

      await supabase.from('subscriptions').upsert({
        owner_id: userId, plan: plan || undefined, billing_cycle: cycle, status: sub.status,
        stripe_customer_id: session.customer as string, stripe_subscription_id: subscriptionId,
        current_period_start: new Date((sub as any).current_period_start * 1000).toISOString(),
        current_period_end: periodEnd, trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        scheduled_plan: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id' })

      await supabase.from('user_profiles').update({
        stripe_subscription_id: subscriptionId, stripe_customer_id: session.customer as string,
        subscription_status: sub.status,
        trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      }).eq('user_id', userId)

      // Flip the plan + refill plan credits to the new allotment immediately (spec §5).
      if (plan) await supabase.rpc('apply_plan', { p_user: userId, p_plan: plan, p_reset: periodEnd })
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.owner_id || sub.metadata?.user_id
      if (!userId) break
      const periodEnd = new Date((sub as any).current_period_end * 1000).toISOString()

      await supabase.from('subscriptions').update({
        status: sub.status, current_period_end: periodEnd,
        trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('owner_id', userId)

      await supabase.from('user_profiles').update({
        subscription_status: sub.status,
        trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      }).eq('user_id', userId)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.user_id
      if (!userId) break

      await supabase.from('user_profiles').update({
        subscription_status: 'canceled',
      }).eq('user_id', userId)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
      const userId = sub.metadata?.user_id
      if (!userId) break

      await supabase.from('user_profiles').update({
        subscription_status: 'past_due',
      }).eq('user_id', userId)
      break
    }
  }

  return event
}
