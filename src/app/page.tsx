import Link from 'next/link'

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", color: '#0a0a0a', overflowX: 'hidden', background: '#f0f4ee' }}>

      {/* GLOBAL BACKGROUND with blobs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: -200, left: -200, width: 700, height: 700, background: 'radial-gradient(circle, rgba(168,230,61,0.18) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', top: 300, right: -150, width: 500, height: 500, background: 'radial-gradient(circle, rgba(200,240,120,0.12) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', top: 800, left: '30%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(150,220,80,0.1) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', top: 1600, right: '10%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(180,235,100,0.12) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', top: 2400, left: '5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(168,230,61,0.1) 0%, transparent 65%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', top: 3200, right: '20%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(140,215,70,0.12) 0%, transparent 65%)', borderRadius: '50%' }} />
      </div>

      {/* NAV */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(15,31,10,0.96)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(223,254,149,0.08)', padding: '0 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <img src="/logo.png" alt="Selfmade" style={{ height: 44, width: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {[['#how', 'How it works'], ['#features', 'Features'], ['#pricing', 'Pricing']].map(([href, label]) => (
            <a key={href} href={href} style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>{label}</a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', padding: '8px 16px' }}>Log in</Link>
          <Link href="/signup" style={{ background: '#dffe95', color: '#10211f', padding: '9px 22px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start free trial</Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ paddingTop: 160, paddingBottom: 80, textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.35)', borderRadius: 100, padding: '7px 18px', marginBottom: 28, fontSize: 13, fontWeight: 600, color: '#3a6b00', backdropFilter: 'blur(8px)' }}>
          <span style={{ background: '#dffe95', borderRadius: 100, padding: '2px 10px', fontSize: 11, fontWeight: 800, color: '#10211f' }}>NEW</span>
          AI trained on $2.4M+ in real ad spend
        </div>

        <h1 style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.04, letterSpacing: '-0.035em', maxWidth: 860, margin: '0 auto 12px', color: '#0a0a0a' }}>
          Launch profitable
        </h1>
        <h1 style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.04, letterSpacing: '-0.035em', maxWidth: 860, margin: '0 auto 8px', color: '#0a0a0a' }}>
          <span style={{ background: '#0f1f0a', color: '#dffe95', padding: '0 14px', borderRadius: 8, display: 'inline-block' }}>Meta ads</span>
        </h1>
        <h1 style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.04, letterSpacing: '-0.035em', maxWidth: 860, margin: '0 auto 28px', color: '#0a0a0a', fontStyle: 'italic' }}>
          for your brand
        </h1>

        <p style={{ fontSize: 19, color: '#555', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.7 }}>
          Your AI media buyer that never sleeps. Scale winners, pause losers, launch campaigns — all with your approval.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16 }}>
          <Link href="/signup" style={{ background: '#dffe95', color: '#10211f', padding: '15px 36px', borderRadius: 100, fontSize: 16, fontWeight: 800, textDecoration: 'none', display: 'inline-block' }}>Start free trial →</Link>
          <Link href="/login" style={{ background: 'rgba(255,255,255,0.8)', color: '#333', padding: '15px 36px', borderRadius: 100, fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)', backdropFilter: 'blur(8px)' }}>Log in</Link>
        </div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 56 }}>$169/mo · 7-day free trial · Cancel anytime</div>

        {/* Stats row */}
        <div style={{ display: 'inline-flex', gap: 0, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.2)', borderRadius: 20, padding: '16px 0', marginBottom: 64, backdropFilter: 'blur(12px)' }}>
          {[['$2.4M+', 'Ad spend managed'], ['3.8×', 'Avg ROAS lift'], ['1,200+', 'Active brands'], ['7 days', 'Free trial']].map(([val, label], i) => (
            <div key={label} style={{ textAlign: 'center', padding: '0 36px', borderRight: i < 3 ? '1px solid rgba(0,0,0,0.08)' : 'none' }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#0a0a0a', letterSpacing: '-0.02em' }}>{val}</div>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 500, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Dashboard preview */}
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 48px' }}>
          <div style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(168,230,61,0.25)', borderRadius: 24, padding: 8, backdropFilter: 'blur(12px)', boxShadow: '0 20px 80px rgba(0,0,0,0.08)' }}>
            <div style={{ background: '#0f1f0a', borderRadius: 18, padding: 32, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
                <div style={{ fontSize: 18, color: '#dffe95', fontWeight: 800, marginBottom: 8 }}>Scale & Insights Dashboard</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Live ROAS · Scale winners · Pause losers · Deep reports</div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                  {[['3.97×', 'ROAS'], ['PKR 90K', 'Revenue'], ['5', 'Conversions'], ['5.2%', 'CTR']].map(([v, l]) => (
                    <div key={l} style={{ background: 'rgba(125,214,0,0.1)', border: '1px solid rgba(125,214,0,0.2)', borderRadius: 12, padding: '10px 18px' }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#dffe95' }}>{v}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div style={{ background: '#0f1f0a', padding: '13px 0', overflow: 'hidden', position: 'relative', zIndex: 1, margin: '48px 0' }}>
        <div style={{ display: 'flex', gap: 48, animation: 'ticker 25s linear infinite', whiteSpace: 'nowrap' }}>
          {Array(2).fill(['✦ Approval-First AI', '✦ Live ROAS Tracking', '✦ Auto Pause Losers', '✦ Scale Winners', '✦ Meta API Direct', '✦ Creative Studio', '✦ Deep Reports', '✦ Zero Ads Manager']).flat().map((t, i) => (
            <span key={i} style={{ fontSize: 13, fontWeight: 700, color: '#dffe95', letterSpacing: '.06em', flexShrink: 0 }}>{t}</span>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: '80px 48px', maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.3)', borderRadius: 100, padding: '6px 18px', fontSize: 12, fontWeight: 800, color: '#dffe95', marginBottom: 16 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: 50, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
            You know what worked.<br />
            <span style={{ background: '#0f1f0a', color: '#dffe95', padding: '2px 16px', borderRadius: 8, display: 'inline-block', fontStyle: 'italic' }}>Selfmade knows why.</span>
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { num: '01', emoji: '🔗', title: 'Connect Meta', desc: 'Link your Facebook ad account in one click via OAuth. Selfmade syncs all your campaigns, ad sets, and performance data in real time.' },
            { num: '02', emoji: '🧠', title: 'AI analyses everything', desc: '5 AI agents run in parallel — audience, creative, funnel, competitive, budget. Full reasoning included with every suggestion.' },
            { num: '03', emoji: '✅', title: 'You approve, we execute', desc: 'Nothing changes without your explicit approval. Click approve and Selfmade calls the Meta API instantly. You stay in full control.' },
          ].map((step, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(168,230,61,0.2)', borderRadius: 24, padding: '32px 40px', display: 'flex', alignItems: 'center', gap: 40, backdropFilter: 'blur(12px)', boxShadow: '0 4px 24px rgba(0,0,0,0.04)' }}>
              <div style={{ width: 64, height: 64, background: 'linear-gradient(135deg, rgba(168,230,61,0.2), rgba(125,214,0,0.1))', border: '1px solid rgba(168,230,61,0.3)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>{step.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#dffe95', letterSpacing: '.1em', marginBottom: 6 }}>{step.num}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0a0a0a', marginBottom: 8 }}>{step.title}</div>
                <div style={{ fontSize: 15, color: '#666', lineHeight: 1.7 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* METRIC BANNER */}
      <div style={{ background: '#dffe95', padding: '28px 48px', display: 'flex', justifyContent: 'center', gap: 80, position: 'relative', zIndex: 1 }}>
        {[['2-3×', 'faster from insight to launch'], ['40%', 'higher ROAS on average'], ['10×', 'faster campaign creation']].map(([val, label]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 38, fontWeight: 900, color: '#dffe95', letterSpacing: '-0.02em' }}>{val}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" style={{ padding: '100px 48px', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.3)', borderRadius: 100, padding: '6px 18px', fontSize: 12, fontWeight: 800, color: '#dffe95', marginBottom: 16 }}>FEATURES</div>
            <h2 style={{ fontSize: 50, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
              From assets to live ads,<br />
              <span style={{ background: '#0f1f0a', color: '#dffe95', padding: '2px 16px', borderRadius: 8, display: 'inline-block', fontStyle: 'italic' }}>in a click.</span>
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              { icon: '📊', title: 'Live KPI Dashboard', desc: 'ROAS, CPA, CTR, Spend updated in real time. No more opening Ads Manager.' },
              { icon: '🎯', title: 'AI Recommendations', desc: 'Claude surfaces what to pause, scale or test — with full reasoning behind every suggestion.' },
              { icon: '🚀', title: 'Launch Ads', desc: 'Create and launch complete Meta campaigns in minutes using the proven M4 Method.' },
              { icon: '📈', title: 'Scale & Insights', desc: 'Spot winning ad sets and scale them into a dedicated Scaling campaign with one click.' },
              { icon: '🎨', title: 'Creative Studio', desc: 'Pick your best ad. Claude generates 6 strategic variation briefs with image prompts.' },
              { icon: '📋', title: 'Deep Reports', desc: 'Breakdown by age, gender, placement, device, time of day, region — all in one place.' },
            ].map((f, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.18)', borderRadius: 20, padding: 28, backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
                <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg, rgba(168,230,61,0.2), rgba(125,214,0,0.1))', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 16 }}>{f.icon}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0a0a0a', marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: '#666', lineHeight: 1.7 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DARK CALLOUT */}
      <section style={{ margin: '0 48px 80px', background: '#0f1f0a', borderRadius: 32, padding: '72px 64px', display: 'flex', gap: 56, alignItems: 'center', position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -100, right: -100, width: 400, height: 400, background: 'radial-gradient(circle, rgba(125,214,0,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ flex: 1, position: 'relative' }}>
          <h2 style={{ fontSize: 42, fontWeight: 900, color: 'white', letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 20px' }}>
            One platform to replace<br />analytics, ad launchers,<br />and <span style={{ color: '#dffe95' }}>agency fees.</span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '0 0 28px' }}>Selfmade replaces your $4k/month agency with AI that works 24/7, shows every decision, and executes only with your approval.</p>
          <Link href="/signup" style={{ background: '#dffe95', color: '#10211f', padding: '14px 30px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none', display: 'inline-block',  }}>Start free trial →</Link>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
          {[
            { q: 'CPL dropped 34% in 3 weeks. Caught creative fatigue before it killed my best campaign.', n: 'Aisha L.', r: 'Real Estate · $12k/mo' },
            { q: 'I replaced my $4k/month agency. Better results, full transparency, I understand every decision.', n: 'Marcus K.', r: 'SaaS Founder · $6k/mo' },
            { q: 'The recommendations are scary accurate. Caught a CPM spike I would have missed for days.', n: 'Sophie R.', r: 'E-Commerce · $18k/mo' },
          ].map((t, i) => (
            <div key={i} style={{ background: 'rgba(125,214,0,0.06)', border: '1px solid rgba(125,214,0,0.12)', borderRadius: 16, padding: '16px 20px' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, marginBottom: 8 }}>"{t.q}"</div>
              <div style={{ fontSize: 12, color: '#dffe95', fontWeight: 700 }}>{t.n} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>· {t.r}</span></div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '100px 48px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(168,230,61,0.3)', borderRadius: 100, padding: '6px 18px', fontSize: 12, fontWeight: 800, color: '#dffe95', marginBottom: 16 }}>PRICING</div>
        <h2 style={{ fontSize: 50, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
          One plan.<br />
          <span style={{ color: '#3a7000', fontStyle: 'italic' }}>Everything included.</span>
        </h2>
        <p style={{ fontSize: 17, color: '#666', marginBottom: 48 }}>No agency. No contracts. Cancel anytime.</p>

        <div style={{ background: 'rgba(255,255,255,0.8)', border: '1.5px solid rgba(125,214,0,0.4)', borderRadius: 32, padding: 48, maxWidth: 460, margin: '0 auto', boxShadow: '0 24px 80px rgba(125,214,0,0.12), 0 4px 20px rgba(0,0,0,0.06)', backdropFilter: 'blur(16px)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#3a7000', letterSpacing: '.1em', marginBottom: 8 }}>SELFMADE PRO</div>
          <div style={{ fontSize: 60, fontWeight: 900, letterSpacing: '-0.04em', color: '#0a0a0a', lineHeight: 1 }}>$99<span style={{ fontSize: 18, fontWeight: 500, color: '#999' }}>/mo</span></div>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 28 }}>7-day free trial · Cancel anytime</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28, textAlign: 'left' }}>
            {['Live KPI Dashboard', 'AI Recommendations', 'Approval-First AI', 'Launch Ads (M4 Method)', 'Scale & Insights', 'Creative Studio', 'Deep Reports', 'Multiple Accounts', 'Activity Log'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#333' }}>
                <span style={{ background: '#dffe95', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0, color: '#10211f' }}>✓</span>
                {f}
              </div>
            ))}
          </div>
          <Link href="/signup" style={{ display: 'block', background: '#dffe95', color: '#10211f', padding: '15px 32px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none', textAlign: 'center',  }}>Start Free Trial →</Link>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '60px 48px 100px', maxWidth: 700, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em' }}>
            Frequently asked<br />
            <span style={{ color: '#3a7000', fontStyle: 'italic' }}>questions.</span>
          </h2>
        </div>
        {[
          { q: 'Does Selfmade change my ads without asking?', a: 'Never. Every recommendation requires your explicit click to execute. We have full API write access but use it only when you approve.' },
          { q: 'What Meta permissions do you need?', a: 'ads_management, ads_read, business_management and pages_read_engagement. ads_management is required to execute approved actions.' },
          { q: 'Do I need Meta ads experience?', a: 'No. Selfmade works for beginners and pros. The M4 Method guides you through everything step by step.' },
          { q: "How is this different from Meta's own tools?", a: 'Meta shows you data. Selfmade tells you what to do with it and executes when you approve.' },
          { q: 'Can I cancel anytime?', a: 'Yes. No contracts, no penalties. Cancel from your billing page and access remains until end of billing period.' },
        ].map((faq, i) => (
          <details key={i} style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(168,230,61,0.2)', borderRadius: 16, padding: '18px 24px', marginBottom: 10, backdropFilter: 'blur(8px)' }}>
            <summary style={{ fontSize: 16, fontWeight: 700, cursor: 'pointer', color: '#0a0a0a', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              {faq.q}
              <span style={{ fontSize: 18, color: '#dffe95', flexShrink: 0, fontWeight: 900 }}>+</span>
            </summary>
            <div style={{ fontSize: 14, color: '#666', lineHeight: 1.7, marginTop: 12 }}>{faq.a}</div>
          </details>
        ))}
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: '80px 48px', textAlign: 'center', background: '#0f1f0a', position: 'relative', overflow: 'hidden', zIndex: 1 }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 700, background: 'radial-gradient(circle, rgba(125,214,0,0.1) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <h2 style={{ fontSize: 54, fontWeight: 900, color: 'white', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16 }}>
            You know what worked.<br />
            <span style={{ color: '#3a7000', fontStyle: 'italic' }}>Let's build.</span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.4)', marginBottom: 40 }}>Join 1,200+ advertisers who replaced agency fees with AI-powered media buying.</p>
          <Link href="/signup" style={{ background: '#dffe95', color: '#10211f', padding: '16px 40px', borderRadius: 100, fontSize: 17, fontWeight: 800, textDecoration: 'none', display: 'inline-block',  }}>Start Free Trial → No card needed</Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#0f1f0a', borderTop: '1px solid rgba(125,214,0,0.08)', padding: '28px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
        <img src="/logo.png" alt="Selfmade" style={{ height: 26 }} />
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>© 2025 Selfmade. All rights reserved.</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Link href="/privacy" style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>Privacy</Link>
          <Link href="/terms" style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>Terms</Link>
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
