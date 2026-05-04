import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const key = process.env.STRIPE_SECRET_KEY
    const monthlyPrice = process.env.STRIPE_PRICE_ID_MONTHLY
    const annualPrice = process.env.STRIPE_PRICE_ID_ANNUAL

    // Log what we have (masked)
    console.log('Stripe key present:', !!key, key ? `${key.slice(0, 8)}...` : 'MISSING')
    console.log('Monthly price:', monthlyPrice || 'MISSING')
    console.log('Annual price:', annualPrice || 'MISSING')

    if (!key) return NextResponse.json({ error: 'STRIPE_SECRET_KEY is not set' }, { status: 500 })

    const stripe = new Stripe(key.trim())

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan = 'monthly', action = 'checkout' } = await request.json()
    const origin = request.nextUrl.origin
    const priceId = plan === 'annual' ? annualPrice : monthlyPrice

    if (!priceId) {
      return NextResponse.json({ error: `STRIPE_PRICE_ID_${plan.toUpperCase()} is not set` }, { status: 500 })
    }

    if (action === 'portal') {
      const admin = createAdminClient()
      const { data: profile } = await admin
        .from('user_profiles')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .single()

      let customerId = profile?.stripe_customer_id
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email!, metadata: { user_id: user.id } })
        customerId = customer.id
        await admin.from('user_profiles').update({ stripe_customer_id: customerId }).eq('user_id', user.id)
      }
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/billing` })
      return NextResponse.json({ url: session.url })
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { user_id: user.id },
      },
      customer_email: user.email,
      success_url: `${origin}/dashboard?welcome=1`,
      cancel_url: `${origin}/billing`,
      metadata: { user_id: user.id },
      allow_promotion_codes: true,
    })

    console.log('Session created:', session.id, session.url?.slice(0, 40))
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Stripe error type:', err.type)
    console.error('Stripe error code:', err.code)
    console.error('Stripe error message:', err.message)
    console.error('Stripe raw error:', JSON.stringify(err, null, 2))
    return NextResponse.json({ error: err.message, type: err.type, code: err.code }, { status: 500 })
  }
}
