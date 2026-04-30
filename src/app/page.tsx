import Link from 'next/link'

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: '#0a0a0a', overflowX: 'hidden' }}>

      {/* NAV */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #f0f0f0', padding: '0 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <img src="/logo.png" alt="Selfmade" style={{ height: 36, width: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <a href="#how" style={{ fontSize: 14, fontWeight: 500, color: '#444', textDecoration: 'none' }}>How it works</a>
          <a href="#features" style={{ fontSize: 14, fontWeight: 500, color: '#444', textDecoration: 'none' }}>Features</a>
          <a href="#pricing" style={{ fontSize: 14, fontWeight: 500, color: '#444', textDecoration: 'none' }}>Pricing</a>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a', textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" style={{ background: '#dffe95', color: '#0a0a0a', padding: '9px 22px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start free trial</Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ paddingTop: 160, paddingBottom: 80, textAlign: 'center', background: '#fff', position: 'relative' }}>
        {/* Social proof bar */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#f6f6f6', border: '1px solid #ebebeb', borderRadius: 100, padding: '8px 20px', marginBottom: 32, fontSize: 13, fontWeight: 600, color: '#444' }}>
          <span style={{ background: '#dffe95', borderRadius: 100, padding: '2px 10px', fontSize: 11, fontWeight: 800, color: '#0a0a0a' }}>NEW</span>
          AI trained on $2.4M+ in real ad spend · 3.8× avg ROAS lift
        </div>

        <h1 style={{ fontSize: 72, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.03em', maxWidth: 800, margin: '0 auto 24px', color: '#0a0a0a' }}>
          The most powerful<br />
          <span style={{ color: '#0a0a0a', fontStyle: 'italic' }}>Meta ads platform</span><br />
          for your brand
        </h1>

        <p style={{ fontSize: 20, color: '#666', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.6, fontWeight: 400 }}>
          Built for DTC brands and founders who want creative velocity, real-time ROAS tracking, and repeatable results — without an agency.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 48 }}>
          <Link href="/signup" style={{ background: '#dffe95', color: '#0a0a0a', padding: '14px 32px', borderRadius: 100, fontSize: 16, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start free trial →</Link>
          <Link href="/login" style={{ background: '#f6f6f6', color: '#0a0a0a', padding: '14px 32px', borderRadius: 100, fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>Log in</Link>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 48, justifyContent: 'center', marginBottom: 64 }}>
          {[['$2.4M+', 'Ad spend managed'], ['3.8×', 'Avg ROAS lift'], ['7 days', 'Free trial'], ['1,200+', 'Active brands']].map(([val, label]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#0a0a0a', letterSpacing: '-0.02em' }}>{val}</div>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 500, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Ticker */}
        <div style={{ background: '#0a0a0a', padding: '14px 0', overflow: 'hidden', marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: 48, animation: 'ticker 20s linear infinite', whiteSpace: 'nowrap' }}>
            {['✦ Approval-First AI', '✦ Live ROAS Tracking', '✦ Auto Pause Losers', '✦ Scale Winners', '✦ Meta API Direct', '✦ Creative Studio', '✦ Zero Ads Manager', '✦ Approval-First AI', '✦ Live ROAS Tracking', '✦ Auto Pause Losers', '✦ Scale Winners', '✦ Meta API Direct', '✦ Creative Studio', '✦ Zero Ads Manager'].map((t, i) => (
              <span key={i} style={{ fontSize: 13, fontWeight: 700, color: '#dffe95', letterSpacing: '.06em', flexShrink: 0 }}>{t}</span>
            ))}
          </div>
        </div>

        {/* Hero image placeholder */}
        <div style={{ background: 'linear-gradient(135deg, #f0fde4 0%, #e8f5e9 100%)', margin: '0 auto', maxWidth: 1100, borderRadius: '0 0 32px 32px', padding: '48px 48px 0', overflow: 'hidden', minHeight: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#0a0a0a', borderRadius: '16px 16px 0 0', padding: 24, width: '100%', maxWidth: 900, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: 16, color: '#dffe95', fontWeight: 700 }}>Scale & Insights Dashboard</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>Live ROAS · Scale winners · Pause losers</div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUSTED BY */}
      <section style={{ padding: '48px 48px', textAlign: 'center', background: '#fafafa', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 24 }}>Trusted by growth-focused brands</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 64, alignItems: 'center', flexWrap: 'wrap' }}>
          {['DTC Brand', 'E-Commerce', 'SaaS', 'Real Estate', 'Health & Beauty', 'Fashion'].map(b => (
            <div key={b} style={{ fontSize: 15, fontWeight: 700, color: '#ccc', letterSpacing: '.02em' }}>{b}</div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: '100px 48px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'inline-block', background: '#dffe95', borderRadius: 100, padding: '6px 16px', fontSize: 12, fontWeight: 800, color: '#0a0a0a', marginBottom: 16 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
            You know what worked.<br /><span style={{ fontStyle: 'italic' }}>Selfmade knows why.</span>
          </h2>
        </div>

        {[
          { num: '01', title: 'Connect Meta', desc: 'Link your Facebook ad account in one click via OAuth. Selfmade syncs all your campaigns, ad sets, and performance data in real time.' },
          { num: '02', title: 'AI analyses everything', desc: '5 AI agents run in parallel — audience, creative, funnel, competitive, budget. You get full reasoning behind every insight.' },
          { num: '03', title: 'You approve, we execute', desc: 'Nothing changes without your explicit approval. Click approve and Selfmade calls the Meta API instantly. You stay in control.' },
        ].map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 64, alignItems: 'center', marginBottom: 80, flexDirection: i % 2 === 1 ? 'row-reverse' : 'row' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#dffe95', background: '#0a0a0a', display: 'inline-block', padding: '4px 12px', borderRadius: 100, marginBottom: 16 }}>{step.num}</div>
              <h3 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.2 }}>{step.title}</h3>
              <p style={{ fontSize: 18, color: '#666', lineHeight: 1.7, margin: 0 }}>{step.desc}</p>
            </div>
            <div style={{ flex: 1, background: 'linear-gradient(135deg, #f0fde4, #e8f5e9)', borderRadius: 24, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 64 }}>{['🔗', '🧠', '✅'][i]}</div>
            </div>
          </div>
        ))}
      </section>

      {/* METRIC BANNER */}
      <div style={{ background: '#dffe95', padding: '20px 48px', display: 'flex', justifyContent: 'center', gap: 80 }}>
        {[['2-3×', 'faster from insight to launch'], ['40%', 'higher ROAS on average'], ['10×', 'faster campaign creation']].map(([val, label]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#0a0a0a', letterSpacing: '-0.02em' }}>{val}</div>
            <div style={{ fontSize: 13, color: '#444', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" style={{ padding: '100px 48px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'inline-block', background: '#dffe95', borderRadius: 100, padding: '6px 16px', fontSize: 12, fontWeight: 800, color: '#0a0a0a', marginBottom: 16 }}>FEATURES</div>
          <h2 style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
            From assets to live ads,<br /><span style={{ fontStyle: 'italic' }}>in a click.</span>
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {[
            { icon: '📊', title: 'Live KPI Dashboard', desc: 'ROAS, CPA, CTR, Spend updated in real time. No more opening Ads Manager.' },
            { icon: '🎯', title: 'AI Recommendations', desc: 'Claude surfaces what to pause, scale or test — with full reasoning behind every suggestion.' },
            { icon: '🚀', title: 'Launch Ads (M4 Method)', desc: 'Create and launch complete Meta campaigns in minutes without touching Ads Manager.' },
            { icon: '📈', title: 'Scale & Insights', desc: 'Spot winning ad sets and scale them into a dedicated Scaling campaign with one click.' },
            { icon: '🎨', title: 'Creative Studio', desc: 'Pick your best ad. Claude generates 6 strategic variation briefs with image prompts.' },
            { icon: '📋', title: 'Deep Reports', desc: 'Breakdown by age, gender, placement, device, time of day, region. All in one place.' },
          ].map((f, i) => (
            <div key={i} style={{ background: '#fafafa', border: '1px solid #ebebeb', borderRadius: 20, padding: 32, transition: 'all .2s' }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>{f.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0a0a0a', marginBottom: 10 }}>{f.title}</div>
              <div style={{ fontSize: 15, color: '#666', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CALLOUT */}
      <section style={{ margin: '0 48px 80px', background: '#0a0a0a', borderRadius: 32, padding: '80px 64px', display: 'flex', gap: 64, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 44, fontWeight: 900, color: 'white', letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 20px' }}>
            One platform to replace<br />analytics, ad launchers,<br />and <span style={{ color: '#dffe95' }}>agency fees.</span>
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, margin: '0 0 32px' }}>
            Selfmade replaces your $4k/month agency with AI that works 24/7, shows you every decision, and executes only with your approval.
          </p>
          <Link href="/signup" style={{ background: '#dffe95', color: '#0a0a0a', padding: '14px 32px', borderRadius: 100, fontSize: 16, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start free trial →</Link>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {['"CPL dropped 34% in 3 weeks. Selfmade caught creative fatigue before it killed my best campaign." — Aisha L., Real Estate',
            '"I replaced my $4k/month agency. Better results, full transparency, I understand every decision." — Marcus K., SaaS',
            '"The recommendations are scary accurate. It caught a CPM spike I would have missed for days." — Sophie R., E-Commerce'].map((q, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '20px 24px', fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
              {q}
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '100px 48px', textAlign: 'center', background: '#fafafa' }}>
        <div style={{ display: 'inline-block', background: '#dffe95', borderRadius: 100, padding: '6px 16px', fontSize: 12, fontWeight: 800, color: '#0a0a0a', marginBottom: 16 }}>PRICING</div>
        <h2 style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
          One plan.<br /><span style={{ fontStyle: 'italic' }}>Everything included.</span>
        </h2>
        <p style={{ fontSize: 18, color: '#666', marginBottom: 48 }}>No agency. No contracts. Cancel anytime.</p>

        <div style={{ background: 'white', border: '2px solid #dffe95', borderRadius: 32, padding: '48px', maxWidth: 480, margin: '0 auto', boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#888', marginBottom: 8 }}>SELFMADE PRO</div>
          <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: '-0.04em', color: '#0a0a0a', lineHeight: 1 }}>$99<span style={{ fontSize: 20, fontWeight: 500, color: '#888' }}>/mo</span></div>
          <div style={{ fontSize: 14, color: '#aaa', marginBottom: 32 }}>7-day free trial · Cancel anytime</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32, textAlign: 'left' }}>
            {['Live KPI Dashboard', 'AI Recommendations', 'Approval-First AI', 'Launch Ads (M4 Method)', 'Scale & Insights', 'Creative Studio', 'Deep Reports', 'Multiple Accounts', 'Activity Log'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: '#333' }}>
                <span style={{ background: '#dffe95', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>✓</span>
                {f}
              </div>
            ))}
          </div>
          <Link href="/signup" style={{ display: 'block', background: '#0a0a0a', color: 'white', padding: '16px 32px', borderRadius: 100, fontSize: 16, fontWeight: 800, textDecoration: 'none', textAlign: 'center' }}>Start Free Trial →</Link>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '100px 48px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2 style={{ fontSize: 48, fontWeight: 900, letterSpacing: '-0.03em' }}>Frequently asked<br /><span style={{ fontStyle: 'italic' }}>questions.</span></h2>
        </div>
        {[
          { q: 'Does Selfmade change my ads without asking?', a: 'Never. Every recommendation requires your explicit click to execute. We have full API write access but use it only when you approve.' },
          { q: 'What Meta permissions do you need?', a: 'ads_management, ads_read, business_management and pages_read_engagement. ads_management is required to execute approved actions.' },
          { q: 'Do I need Meta ads experience?', a: 'No. Selfmade works for beginners and pros. The M4 Method guides you through everything step by step.' },
          { q: 'How is this different from Meta\'s own tools?', a: 'Meta shows you data. Selfmade tells you what to do with it and executes when you approve. Dashboard vs co-pilot.' },
          { q: 'Can I cancel anytime?', a: 'Yes. No contracts, no penalties. Cancel from your billing page and access remains until end of billing period.' },
        ].map((faq, i) => (
          <details key={i} style={{ borderBottom: '1px solid #ebebeb', padding: '20px 0' }}>
            <summary style={{ fontSize: 17, fontWeight: 700, cursor: 'pointer', color: '#0a0a0a', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {faq.q}
              <span style={{ fontSize: 20, color: '#aaa', flexShrink: 0 }}>+</span>
            </summary>
            <div style={{ fontSize: 15, color: '#666', lineHeight: 1.7, marginTop: 12 }}>{faq.a}</div>
          </details>
        ))}
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: '80px 48px', textAlign: 'center', background: '#0a0a0a' }}>
        <h2 style={{ fontSize: 56, fontWeight: 900, color: 'white', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16 }}>
          You know what worked.<br /><span style={{ color: '#dffe95', fontStyle: 'italic' }}>Let's build.</span>
        </h2>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 40 }}>Join 1,200+ advertisers who replaced agency fees with AI-powered media buying.</p>
        <Link href="/signup" style={{ background: '#dffe95', color: '#0a0a0a', padding: '16px 40px', borderRadius: 100, fontSize: 18, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start Free Trial → No card needed</Link>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#0a0a0a', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '32px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <img src="/logo.png" alt="Selfmade" style={{ height: 28, filter: 'brightness(10)' }} />
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>© 2025 Selfmade. All rights reserved.</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Link href="/privacy" style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Privacy</Link>
          <Link href="/terms" style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Terms</Link>
        </div>
      </footer>

      <style>{`
        @keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        * { box-sizing: border-box; }
        details summary::-webkit-details-marker { display: none; }
      `}</style>
    </div>
  )
}
