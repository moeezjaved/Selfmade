import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession, createPortalSession, getOrCreateCustomer } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan = 'monthly', action = 'checkout' } = await request.json()
    const origin = request.nextUrl.origin

    if (action === 'portal') {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('stripe_customer_id, full_name')
        .eq('user_id', user.id)
        .single()

      const customer = await getOrCreateCustomer(user.id, user.email!, profile?.full_name || undefined)
      const session = await createPortalSession(customer.id, `${origin}/billing`)
      return NextResponse.json({ url: session.url })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single()

    const session = await createCheckoutSession({
      userId: user.id,
      email: user.email!,
      name: profile?.full_name || undefined,
      plan: plan as 'monthly' | 'annual',
      successUrl: `${origin}/dashboard?welcome=1`,
      cancelUrl: `${origin}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Stripe checkout error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
