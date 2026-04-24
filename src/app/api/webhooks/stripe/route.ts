import { NextRequest, NextResponse } from 'next/server'
import { handleStripeWebhook } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 })
    }

    await handleStripeWebhook(payload, signature)

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Stripe webhook error:', err)
    const message = err instanceof Error ? err.message : 'Webhook failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
