import { redirect } from 'next/navigation'

// Legacy onboarding checkout — replaced by the real /pricing page (PricingSection), which is the
// single source of truth for plans/prices and uses the per-plan Stripe Checkout endpoint. This old
// page showed stale $49/$39 pricing and hit the legacy single-price route, so it just forwards now.
export default function PaymentPage() {
  redirect('/pricing')
}
