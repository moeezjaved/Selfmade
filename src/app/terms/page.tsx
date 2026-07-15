const P: React.CSSProperties = { lineHeight: 1.8, marginBottom: 18, color: '#374151', fontSize: 15 }
const H2: React.CSSProperties = { fontSize: 19, fontWeight: 700, margin: '30px 0 10px', color: '#111' }

export default function TermsPage() {
  return (
    // Full light background so the dark body text is readable (page was inheriting a dark app bg).
    <div style={{ minHeight: '100vh', background: '#ffffff', color: '#111' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px 96px', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <a href="/" style={{ fontSize: 13, fontWeight: 700, color: '#166534', textDecoration: 'none' }}>← Selfmade</a>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: '18px 0 6px', letterSpacing: '-0.02em' }}>Terms of Service</h1>
        <p style={{ color: '#6b7280', marginBottom: 8, fontSize: 14 }}>Last updated: July 2026</p>
        <p style={P}>These Terms govern your use of Selfmade (tryselfmade.ai). By creating an account or using the service, you agree to them.</p>

        <h2 style={H2}>1. The service</h2>
        <p style={P}>Selfmade is an AI-powered ad-intelligence and creative platform: discover competitor ads, remake them with your own product, generate scripts and creatives, track brands, and (where connected) analyze and manage Meta campaigns.</p>

        <h2 style={H2}>2. Accounts & eligibility</h2>
        <p style={P}>You must provide accurate information, keep your credentials secure, and be responsible for activity under your account. You must be at least 18. We may suspend accounts that violate these Terms or applicable law.</p>

        <h2 style={H2}>3. Acceptable use</h2>
        <p style={P}>Don’t misuse the service — no scraping our systems, reverse-engineering, reselling access, infringing others’ IP, or generating unlawful, deceptive, or infringing ad content. You’re responsible for the creatives and campaigns you produce and run.</p>

        <h2 style={H2}>4. Meta / third-party platforms</h2>
        <p style={P}>Where you connect Meta or other platforms, you must comply with their terms and advertising policies. We integrate via their official APIs and are not responsible for their decisions, outages, or your campaign performance.</p>

        <h2 style={H2}>5. Credits, billing & subscriptions</h2>
        <p style={P}>Paid plans and AI credits are billed per your selected plan. Subscription fees are separate from any ad spend, which is billed directly to you by Meta. Trials, if offered, may require a card and convert to paid unless cancelled. Fees are non-refundable except where required by law.</p>

        <h2 style={H2}>6. Intellectual property</h2>
        <p style={P}>You retain rights to the content and creatives you upload and generate. You grant us a limited license to process them to provide the service. The Selfmade platform, brand, and software remain ours.</p>

        <h2 style={H2}>7. Disclaimers & limitation of liability</h2>
        <p style={P}>The service is provided “as is.” We don’t guarantee ad results or business outcomes. To the maximum extent permitted by law, Selfmade is not liable for ad spend, lost profits, or indirect damages arising from your use of the service.</p>

        <h2 style={H2}>8. Changes & termination</h2>
        <p style={P}>We may update these Terms or the service; continued use means acceptance. You may stop using the service and delete your account at any time.</p>

        <h2 style={H2}>9. Contact</h2>
        <p style={{ ...P, marginBottom: 0 }}>Questions? Email <a href="mailto:hello@tryselfmade.ai" style={{ color: '#166534', fontWeight: 600 }}>hello@tryselfmade.ai</a>.</p>
      </div>
    </div>
  )
}
