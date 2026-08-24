'use client'
/**
 * AuditLanding — the marketing sections below the /audit hero (Ryze /seo-style): what's included, get
 * found on Google & AI, the 30-day timeline, FAQ, and a final CTA. Orange accent bands like our landing,
 * scroll-reveal animations, clear CTAs that scroll back to the scan input. Mobile responsive.
 */
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', LIME = '#ef4a1e', PAPER = '#fbf4e2', CREAM = '#f4efe1', ORANGE = '#e02f06'
const SERIF = 'Fraunces, Georgia, serif'

/** Fade-up on scroll. */
function Reveal({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setSeen(true)), { threshold: 0.15 })
    io.observe(el); return () => io.disconnect()
  }, [])
  return <div ref={ref} style={{ ...style, opacity: seen ? 1 : 0, transform: seen ? 'none' : 'translateY(24px)', transition: `opacity .6s ease ${delay}ms, transform .6s cubic-bezier(.2,.8,.2,1) ${delay}ms` }}>{children}</div>
}

const Icon = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>

export default function AuditLanding({ onScan }: { onScan?: () => void }) {
  const isMobile = useIsMobile()
  const cta = () => { onScan?.(); const el = document.getElementById('audit-top'); el?.scrollIntoView({ behavior: 'smooth' }) }

  const included = [
    { head: 'Site fixes', tint: '#fbe9e3', items: ['Title tags', 'Meta descriptions', 'Image alt text', 'Schema markup', 'Internal links', 'Broken links'] },
    { head: 'Content', tint: '#efe7f3', items: ['Blogs written for you', 'Programmatic SEO pages', 'Buyer-intent articles', 'FAQ + answer pages', 'Published to your store'] },
    { head: 'AI & backlinks', tint: '#e3f0ea', items: ['Cited in ChatGPT & Perplexity', 'llms.txt + schema', 'Competitor content gaps', 'Backlink-gap analysis'] },
    { head: 'Reporting', tint: '#faf3dc', items: ['Daily rank tracking', 'AI search citations', 'Revenue banked per fix', 'Weekly wins summary'] },
  ]
  const brands = [['Google', '#4285F4'], ['Bing', '#008373'], ['ChatGPT', '#10a37f'], ['Claude', '#d97757'], ['Perplexity', '#20808d'], ['Shopify', '#95BF47']] as const
  const timeline = [
    { when: 'Day 0', title: 'Plug in', body: 'Enter your domain — the agents scan everything and connect your store in one click.' },
    { when: 'Day 0', title: 'An audit that ranks', body: 'Findings ranked by traffic potential and revenue — not a 40-slide deck.' },
    { when: 'Days 1–7', title: 'First fixes ship', body: 'Titles, metas, schema, alt text, broken links — patched and live with your sign-off.' },
    { when: 'Every week', title: 'New pages + backlinks', body: 'Blog + programmatic pages published, competitor gaps closed, ranks climbing.' },
    { when: 'Ongoing', title: 'Revenue banked', body: 'We attribute real organic revenue to every fix. Stay if it works — cancel in one email.' },
  ]
  const faqs = [
    ['What does the SEO agent actually do?', 'It scans your site, fixes the technical + on-page issues (titles, metas, alt text, schema), writes and publishes content, gets you cited in AI answers, and tracks your ranks — all with your approval on every change.'],
    ['How fast will I see results?', 'The technical fixes ship in the first week. Content and rankings compound over 1–3 months — we bank the real organic revenue against each fix so you see it in your orders.'],
    ['Does it work for AI search (ChatGPT, Perplexity)?', 'Yes — we really ask the assistants for your category, see if you come up, and publish the answer content + structured data that gets you cited.'],
    ['What platforms do you support?', 'Shopify first-class (products, collections, pages, blog), plus WordPress and more via publishing connectors.'],
    ['Do I approve every change?', 'Yes. Every fix is drafted for you to review — nothing touches your live store until you approve it.'],
  ]

  const H2: React.CSSProperties = { fontFamily: SERIF, fontSize: isMobile ? 30 : 46, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.02, margin: 0, color: INK }
  const wrap: React.CSSProperties = { maxWidth: 1120, margin: '0 auto', padding: isMobile ? '0 22px' : '0 40px' }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: PAPER }}>
      {/* Stats band — orange, like the landing trust strip */}
      <section style={{ background: ORANGE, color: '#fff', padding: isMobile ? '44px 0' : '64px 0' }}>
        <div style={wrap}>
          <Reveal><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', opacity: .85, marginBottom: 22 }}>What your agents do for you</div></Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: isMobile ? 22 : 32 }}>
            {[['Every SEO gap', 'found & fixed'], ['100s of pages', 'written + published'], ['ChatGPT & Perplexity', 'citations earned'], ['Real revenue', 'banked per fix']].map(([big, sub], i) => (
              <Reveal key={i} delay={i * 80}><div><div style={{ fontFamily: SERIF, fontSize: isMobile ? 22 : 30, fontWeight: 700, lineHeight: 1.05 }}>{big}</div><div style={{ fontSize: 13.5, opacity: .85, marginTop: 4 }}>{sub}</div></div></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section style={{ padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={wrap}>
          <Reveal><h2 style={H2}>What&rsquo;s included.</h2></Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4,1fr)', gap: isMobile ? 30 : 26, marginTop: isMobile ? 30 : 44 }}>
            {included.map((col, ci) => (
              <Reveal key={col.head} delay={ci * 90}>
                <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: INK, marginBottom: 16 }}>{col.head}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {col.items.map((it) => (
                    <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: col.tint, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon d="M20 6 9 17l-5-5" /></span>
                      <span style={{ fontSize: 14.5, color: '#3a352c' }}>{it}</span>
                    </div>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Get found on Google & AI */}
      <section style={{ background: CREAM, padding: isMobile ? '52px 0' : '76px 0' }}>
        <div style={{ ...wrap, textAlign: 'center' }}>
          <Reveal><h2 style={{ ...H2, fontSize: isMobile ? 26 : 38 }}>Get found on Google, ChatGPT &amp; Perplexity</h2></Reveal>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: isMobile ? 26 : 54, marginTop: isMobile ? 30 : 44 }}>
            {brands.map(([name, col], i) => (
              <Reveal key={name} delay={i * 60}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fff', boxShadow: '0 8px 22px -12px rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 22, fontWeight: 700, color: col }}>{name[0]}</div>
                  <div style={{ fontSize: 13.5, color: SUB, fontWeight: 600 }}>{name}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 30-day timeline */}
      <section style={{ padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={wrap}>
          <Reveal><h2 style={H2}>From scan to first rankings &mdash; in 30 days.</h2></Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: isMobile ? 30 : 44, maxWidth: 820 }}>
            {timeline.map((t, i) => (
              <Reveal key={i} delay={i * 70}>
                <div style={{ display: 'flex', gap: isMobile ? 14 : 26, border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: isMobile ? '16px 18px' : '22px 26px', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: isMobile ? 66 : 92, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: LIME, paddingTop: 3 }}>{t.when}</div>
                  <div><div style={{ fontFamily: SERIF, fontSize: isMobile ? 19 : 23, fontWeight: 700, color: INK }}>{t.title}</div><div style={{ fontSize: 14.5, color: SUB, marginTop: 4, lineHeight: 1.5 }}>{t.body}</div></div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: CREAM, padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={{ ...wrap, maxWidth: 860 }}>
          <Reveal><h2 style={{ ...H2, textAlign: 'center', marginBottom: isMobile ? 26 : 40 }}>Frequently asked questions</h2></Reveal>
          {faqs.map(([q, a], i) => <Faq key={i} q={q} a={a} />)}
        </div>
      </section>

      {/* Final CTA — orange */}
      <section style={{ background: ORANGE, color: '#fff', padding: isMobile ? '54px 22px' : '88px 40px', textAlign: 'center' }}>
        <Reveal>
          <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 30 : 48, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.02, margin: '0 0 14px' }}>See what&rsquo;s broken — free.</h2>
          <p style={{ fontSize: 17, opacity: .9, margin: '0 0 26px', maxWidth: 520, marginInline: 'auto' }}>Your search health, catalog, and whether AI even mentions you — in ~30 seconds. No login.</p>
          <button onClick={cta} style={{ background: '#fff', color: LIME, border: 'none', borderRadius: 100, padding: '16px 34px', fontSize: 17, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>Audit my SEO — free →</button>
        </Reveal>
      </section>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Reveal>
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 4px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{q}</span>
          <span style={{ color: LIME, fontSize: 22, transform: open ? 'rotate(45deg)' : 'none', transition: 'transform .2s', flex: 'none' }}>+</span>
        </button>
        {open && <div style={{ fontSize: 15, color: SUB, lineHeight: 1.6, padding: '0 4px 20px', maxWidth: 720 }}>{a}</div>}
      </div>
    </Reveal>
  )
}
