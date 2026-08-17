import { redirect } from 'next/navigation'

// One billing surface. Every "Upgrade plan" / "Plans & Pricing" link now lands on /billing — the full
// account page (plan grid + invite code + subscription management) — so users never see two different
// pricing screens (one with the invite-code box, one without). /billing renders the same PricingSection.
export default function PricingPage() {
  redirect('/billing')
}
