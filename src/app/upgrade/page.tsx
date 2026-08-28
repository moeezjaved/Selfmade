/**
 * /upgrade — the paywall. Clicking any "Fix it" / agent action as a free user, or any "Upgrade" CTA,
 * lands here: the Employment Agreement (countersign) wired straight to PayPal checkout. Agreement → pay,
 * in one screen. (This is the single home for the agreement now — it no longer appears in the audit.)
 */
import HireAgreement from '@/components/ads/HireAgreement'

export const dynamic = 'force-dynamic'

export default function UpgradePage() {
  return <HireAgreement />
}
