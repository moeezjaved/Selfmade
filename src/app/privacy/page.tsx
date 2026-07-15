const P: React.CSSProperties = { lineHeight: 1.8, marginBottom: 18, color: '#374151', fontSize: 15 }
const H2: React.CSSProperties = { fontSize: 19, fontWeight: 700, margin: '30px 0 10px', color: '#111' }

export default function PrivacyPage() {
  return (
    // Full light background so the dark body text is readable (page was inheriting a dark app bg).
    <div style={{ minHeight: '100vh', background: '#ffffff', color: '#111' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px 96px', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <a href="/" style={{ fontSize: 13, fontWeight: 700, color: '#166534', textDecoration: 'none' }}>← Selfmade</a>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: '18px 0 6px', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
        <p style={{ color: '#6b7280', marginBottom: 8, fontSize: 14 }}>Last updated: July 2026</p>
        <p style={P}>This Privacy Policy explains how Selfmade (“we”, “us”) collects, uses, and protects your information when you use tryselfmade.ai and related services.</p>

        <h2 style={H2}>1. Information we collect</h2>
        <p style={P}>We collect: (a) account details you provide (name, email, company); (b) content you upload (product photos, brand assets, ad copy); (c) data from accounts you connect, such as your Meta ad accounts, campaign performance, and settings via the official Meta Marketing API; and (d) usage data (pages viewed, features used, device/browser info) to operate and improve the product.</p>

        <h2 style={H2}>2. How we use your information</h2>
        <p style={P}>We use your data to provide and improve our services — analyzing ad performance, generating AI recommendations and creatives, and (where you connect Meta) creating or managing campaigns on your behalf. We also use it for account management, support, security, billing, and product communication. <b>We do not sell your personal data.</b></p>

        <h2 style={H2}>3. Meta / Facebook data</h2>
        <p style={P}>When you connect a Meta account, we access only the ad data needed to provide our services, through Meta’s official APIs. Access tokens are encrypted. You can revoke our access at any time in your Meta Business Settings, or by disconnecting inside Selfmade.</p>

        <h2 style={H2}>4. AI processing</h2>
        <p style={P}>To power features like ad remaking, scripts, and insights, we send relevant content (e.g. the copy or image you’re working on) to trusted AI providers. We don’t use your private data to train third-party models beyond what’s required to return your result.</p>

        <h2 style={H2}>5. Data sharing</h2>
        <p style={P}>We share data only with service providers who help us operate (hosting, storage, payment processing, AI, email) under confidentiality obligations, and where required by law. We never sell your data.</p>

        <h2 style={H2}>6. Data retention & security</h2>
        <p style={P}>We keep your data for as long as your account is active or as needed to provide the service, then delete or anonymize it. We use industry-standard encryption in transit and at rest and restrict internal access.</p>

        <h2 style={H2}>7. Your rights</h2>
        <p style={P}>You may access, correct, export, or delete your personal data, and withdraw consent, by contacting us. To delete your account and associated data, email us at the address below.</p>

        <h2 style={H2}>8. Contact</h2>
        <p style={{ ...P, marginBottom: 0 }}>Questions about privacy or a data request? Email <a href="mailto:privacy@tryselfmade.ai" style={{ color: '#166534', fontWeight: 600 }}>privacy@tryselfmade.ai</a>.</p>
      </div>
    </div>
  )
}
