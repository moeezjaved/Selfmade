import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  typescript: true,
})

export const PLANS = {
  monthly: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY!,
    amount: 9900,   // $99.00 in cents
    interval: 'month' as const,
    label: 'Pro Monthly',
  },
  annual: {
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL!,
    amount: 94800,  // $79/mo × 12 = $948/year
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
      const userId = session.metadata?.user_id
      if (!userId) break

      await supabase.from('user_profiles').update({
        stripe_subscription_id: session.subscription as string,
        subscription_status: 'trialing',
      }).eq('user_id', userId)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.user_id
      if (!userId) break

      await supabase.from('user_profiles').update({
        subscription_status: sub.status as string,
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
