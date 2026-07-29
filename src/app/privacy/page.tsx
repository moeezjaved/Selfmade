import type { Metadata } from 'next'
import LegalShell from '@/components/LegalShell'
import { COMPANY } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Privacy Policy — Selfmade' },
  description: 'How Selfmade collects, uses, and protects your information.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="July 2026"
      intro="How we collect, use, and protect your information when you use Selfmade.">
      <p>This Privacy Policy explains how {COMPANY.brand} (“we”, “us”), operated by {COMPANY.legalName}, collects, uses, and protects your information when you use tryselfmade.ai and related services.</p>

      <h2>1. Information we collect</h2>
      <p>We collect: (a) account details you provide (name, email, company); (b) content you upload (product photos, brand assets, ad copy); (c) data from accounts you connect, such as your Meta ad accounts, campaign performance, and settings via the official Meta Marketing API; and (d) usage data (pages viewed, features used, device/browser info) to operate and improve the product.</p>

      <h2>2. How we use your information</h2>
      <p>We use your data to provide and improve our services — analyzing ad performance, generating AI recommendations and creatives, and (where you connect Meta) creating or managing campaigns on your behalf. We also use it for account management, support, security, billing, and product communication. <b>We do not sell your personal data.</b></p>

      <h2>3. Meta / Facebook data</h2>
      <p>When you connect a Meta account, we access only the ad data needed to provide our services, through Meta’s official APIs. Access tokens are encrypted. You can revoke our access at any time in your Meta Business Settings, or by disconnecting inside Selfmade.</p>

      <h2>4. AI processing</h2>
      <p>To power features like ad remaking, scripts, and insights, we send relevant content (e.g. the copy or image you’re working on) to trusted AI providers. We don’t use your private data to train third-party models beyond what’s required to return your result.</p>

      <h2>5. Data sharing</h2>
      <p>We share data only with service providers who help us operate (hosting, storage, payment processing, AI, email) under confidentiality obligations, and where required by law. We never sell your data.</p>

      <h2>6. Data retention & security</h2>
      <p>We keep your data for as long as your account is active or as needed to provide the service, then delete or anonymize it. We use industry-standard encryption in transit and at rest and restrict internal access.</p>

      <h2>7. Your rights</h2>
      <p>You may access, correct, export, or delete your personal data, and withdraw consent, by contacting us. To delete your account and associated data, email us at the address below.</p>

      <h2>8. Contact</h2>
      <p style={{ marginBottom: 0 }}>Questions about privacy or a data request? Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
    </LegalShell>
  )
}
