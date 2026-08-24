'use client'
/**
 * AuditLanding — the marketing sections below the /audit hero (Ryze /seo-style): what's included, get
 * found on Google & AI, the 30-day timeline, FAQ, and a final CTA. Orange accent bands like our landing,
 * scroll-reveal animations, clear CTAs that scroll back to the scan input. Mobile responsive.
 */
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', LIME = '#ef4a1e', PAPER = '#fbf4e2', ORANGE = '#e02f06'
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
    { head: 'Site fixes', items: ['Title tags', 'Meta descriptions', 'Image alt text', 'Schema markup', 'Internal links', 'Broken links'] },
    { head: 'Content', items: ['Blogs written for you', 'Programmatic SEO pages', 'Buyer-intent articles', 'FAQ + answer pages', 'Published to your store'] },
    { head: 'AI & backlinks', items: ['Cited in ChatGPT & Perplexity', 'llms.txt + schema', 'Competitor content gaps', 'Backlink-gap analysis'] },
    { head: 'Reporting', items: ['Daily rank tracking', 'AI search citations', 'Revenue banked per fix', 'Weekly wins summary'] },
  ]
  const brands = [['Google', '/logos/google.svg'], ['Bing', '/logos/bing.svg'], ['ChatGPT', '/logos/openai.svg'], ['Claude', '/logos/claude.svg'], ['Perplexity', '/logos/perplexity.svg'], ['Shopify', '/logos/shopify.svg']] as const
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
      <section style={{ background: '#fff', padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={wrap}>
          <Reveal><h2 style={H2}>What&rsquo;s included.</h2></Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4,1fr)', gap: isMobile ? 30 : 26, marginTop: isMobile ? 30 : 44 }}>
            {included.map((col, ci) => (
              <Reveal key={col.head} delay={ci * 90}>
                <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: INK, marginBottom: 16 }}>{col.head}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {col.items.map((it) => (
                    <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: LIME, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon d="M20 6 9 17l-5-5" /></span>
                      <span style={{ fontSize: 14.5, color: '#3a352c' }}>{it}</span>
                    </div>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Agents at work — orange, live animation */}
      <AgentsAtWork isMobile={isMobile} />

      {/* Get found on Google & AI */}
      <section style={{ background: '#fff', padding: isMobile ? '52px 0' : '76px 0' }}>
        <div style={{ ...wrap, textAlign: 'center' }}>
          <Reveal><h2 style={{ ...H2, fontSize: isMobile ? 26 : 38 }}>Get found on Google, ChatGPT &amp; Perplexity</h2></Reveal>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: isMobile ? 26 : 54, marginTop: isMobile ? 30 : 44 }}>
            {brands.map(([name, src], i) => (
              <Reveal key={name} delay={i * 60}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 15, background: '#fff', boxShadow: '0 8px 22px -12px rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    { /* eslint-disable-next-line @next/next/no-img-element */ }
                    <img src={src} alt={name} width={30} height={30} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                  </div>
                  <div style={{ fontSize: 13.5, color: SUB, fontWeight: 600 }}>{name}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 30-day timeline — white, one clear connected path */}
      <section style={{ background: '#fff', padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={wrap}>
          <Reveal><h2 style={H2}>From scan to first rankings &mdash; in 30 days.</h2></Reveal>
          <Reveal delay={60}><p style={{ fontSize: isMobile ? 15.5 : 17, color: SUB, margin: '12px 0 0', maxWidth: 620, lineHeight: 1.5 }}>Here&rsquo;s exactly what happens after you scan — step by step, nothing hidden.</p></Reveal>
          <div style={{ position: 'relative', marginTop: isMobile ? 34 : 50, maxWidth: 820 }}>
            {/* the path */}
            <div style={{ position: 'absolute', left: isMobile ? 15 : 19, top: 8, bottom: 8, width: 2, background: `linear-gradient(${LIME}, ${LIME}33)` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 22 }}>
              {timeline.map((t, i) => (
                <Reveal key={i} delay={i * 70}>
                  <div style={{ display: 'flex', gap: isMobile ? 16 : 24, alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative', zIndex: 1, width: isMobile ? 32 : 40, height: isMobile ? 32 : 40, borderRadius: 100, background: LIME, color: '#fff', fontFamily: SERIF, fontWeight: 800, fontSize: isMobile ? 15 : 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxShadow: '0 0 0 5px #fff' }}>{i + 1}</div>
                    <div style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: isMobile ? '14px 16px' : '18px 24px', boxShadow: '0 14px 34px -24px rgba(0,0,0,.4)' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: LIME, marginBottom: 4 }}>{t.when}</div>
                      <div style={{ fontFamily: SERIF, fontSize: isMobile ? 19 : 23, fontWeight: 700, color: INK }}>{t.title}</div>
                      <div style={{ fontSize: 14.5, color: SUB, marginTop: 4, lineHeight: 1.5 }}>{t.body}</div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ — orange, white cards */}
      <section style={{ background: ORANGE, padding: isMobile ? '54px 0' : '84px 0' }}>
        <div style={{ ...wrap, maxWidth: 820 }}>
          <Reveal><h2 style={{ ...H2, color: '#fff', textAlign: 'center', marginBottom: isMobile ? 26 : 40 }}>Frequently asked questions</h2></Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {faqs.map(([q, a], i) => <Faq key={i} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* Final CTA — orange */}
      <section style={{ background: ORANGE, color: '#fff', padding: isMobile ? '54px 22px' : '88px 40px', textAlign: 'center' }}>
        <Reveal>
          <h2 style={{ fontFamily: SERIF, color: '#fff', fontSize: isMobile ? 32 : 52, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.02, margin: '0 0 14px' }}>Let AI run your company.</h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.92)', margin: '0 0 26px', maxWidth: 560, marginInline: 'auto', lineHeight: 1.5 }}>SEO, ads, content, and your store — one AI team that finds what&rsquo;s broken and fixes it, with your sign-off. Start with a free scan.</p>
          <button onClick={cta} style={{ background: '#fff', color: LIME, border: 'none', borderRadius: 100, padding: '16px 34px', fontSize: 17, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>Scan my store — free →</button>
        </Reveal>
      </section>
    </div>
  )
}

/** Three columns of AI agents working live — on orange, with a wave of status changes. */
function AgentsAtWork({ isMobile }: { isMobile: boolean }) {
  const [tick, setTick] = useState(0)
  const [pages, setPages] = useState(0)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setTick(99); setPages(1000); return }
    const t = setInterval(() => setTick((n) => n + 1), 950)
    const p = setInterval(() => setPages((n) => (n >= 1000 ? 0 : Math.min(1000, n + 137))), 950)
    return () => { clearInterval(t); clearInterval(p) }
  }, [])

  const content = [
    ['BLOG', 'How AI is changing SEO in 2026'], ['BLOG', 'Programmatic SEO: a complete guide'], ['REDDIT', '10 best SEO tools for agencies'],
    ['GUEST', 'Schema markup for ecommerce'], ['BLOG', 'Core Web Vitals fixes that ship'], ['PR', 'AI Overviews: what changed in Q1'],
  ]
  const links = [['forbes.com', 'DA 95'], ['wsj.com', 'DA 94'], ['techcrunch.com', 'DA 93'], ['businessinsider.com', 'DA 92'], ['axios.com', 'DA 89'], ['fortune.com', 'DA 88']]
  const STATES = ['Queued', 'Drafting', 'Published']
  const CYCLE = content.length + 3           // fill the wave, hold, then restart so all 3 columns keep moving
  const w = tick % CYCLE
  const stateFor = (i: number) => STATES[Math.min(STATES.length - 1, Math.max(0, w - i))]
  const liveFor = (i: number) => w - i >= 2
  const shown = (i: number) => w >= i

  const card: React.CSSProperties = { background: '#fff', borderRadius: 20, padding: isMobile ? 20 : 26, boxShadow: '0 24px 60px -30px rgba(0,0,0,.4)' }
  const kicker: React.CSSProperties = { fontFamily: SERIF, fontSize: isMobile ? 26 : 32, fontWeight: 700, color: INK, letterSpacing: '-.02em', lineHeight: 1.02, margin: '0 0 12px' }
  const bullet: React.CSSProperties = { display: 'flex', gap: 10, fontSize: 14.5, color: '#3a352c', marginBottom: 8 }
  const dot = <span style={{ width: 5, height: 5, borderRadius: 9, background: LIME, marginTop: 8, flex: 'none' }} />
  const rowBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderBottom: `1px solid ${LINE}` }
  const tag: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: SUB, width: 52, flex: 'none' }
  const pill = (label: string, on: boolean) => (
    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 100, flex: 'none', transition: 'all .4s ease', background: on ? INK : '#efe9df', color: on ? '#fff' : SUB }}>{label}</span>
  )

  return (
    <section style={{ background: ORANGE, padding: isMobile ? '54px 0' : '90px 0' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '0 22px' : '0 40px' }}>
        <Reveal><div style={{ textAlign: 'center', color: '#fff', marginBottom: isMobile ? 30 : 52 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', opacity: .85, marginBottom: 12 }}>While you sleep</div>
          <h2 style={{ fontFamily: SERIF, color: '#fff', fontSize: isMobile ? 30 : 46, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Your agents are already working.</h2>
        </div></Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: isMobile ? 26 : 30 }}>
          {/* Programmatic SEO */}
          <Reveal delay={0}><div style={card}>
            <h3 style={kicker}>Programmatic SEO</h3>
            <div style={bullet}>{dot}Builds 1000+ pages so people find you</div>
            <div style={bullet}>{dot}All live on your site — no work from you</div>
            <div style={{ marginTop: 18, background: PAPER, borderRadius: 14, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: SUB, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Pages generated</div>
              <div style={{ fontFamily: SERIF, fontSize: isMobile ? 40 : 52, fontWeight: 800, color: LIME, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{pages.toLocaleString()}+</div>
              <div style={{ fontSize: 12.5, color: SUB }}>from live keyword research</div>
            </div>
          </div></Reveal>
          {/* Technical / content */}
          <Reveal delay={100}><div style={card}>
            <h3 style={kicker}>Technical SEO fixes</h3>
            <div style={bullet}>{dot}Scans and fixes your pages 24/7</div>
            <div style={{ marginTop: 16 }}>
              {content.map(([t, title], i) => (
                <div key={i} style={{ ...rowBox, opacity: shown(i) ? 1 : 0.35, transition: 'opacity .5s ease' }}>
                  <span style={tag}>{t}</span>
                  <span style={{ fontSize: 13.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                  {pill(stateFor(i), stateFor(i) === 'Published')}
                </div>
              ))}
            </div>
          </div></Reveal>
          {/* Backlinks */}
          <Reveal delay={200}><div style={card}>
            <h3 style={kicker}>DA 40+ backlinks</h3>
            <div style={bullet}>{dot}Guest posts, PR, Reddit — real authority</div>
            <div style={{ marginTop: 16 }}>
              {links.map(([site, da], i) => (
                <div key={i} style={{ ...rowBox, opacity: shown(i) ? 1 : 0.35, transition: 'opacity .5s ease' }}>
                  <span style={{ fontSize: 13.5, color: INK, fontWeight: 600 }}>{site}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: SUB }}>{da}</span>
                  {pill(liveFor(i) ? 'Live' : 'Pending', liveFor(i))}
                </div>
              ))}
            </div>
          </div></Reveal>
        </div>
      </div>
    </section>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Reveal>
      <div style={{ background: open ? '#fff' : 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 16, overflow: 'hidden', transition: 'background .25s' }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
          <span style={{ fontSize: 16.5, fontWeight: 700, color: open ? INK : '#fff' }}>{q}</span>
          <span style={{ color: open ? LIME : '#fff', fontSize: 24, lineHeight: 1, transform: open ? 'rotate(45deg)' : 'none', transition: 'transform .25s, color .25s', flex: 'none' }}>+</span>
        </button>
        <div style={{ maxHeight: open ? 260 : 0, overflow: 'hidden', transition: 'max-height .3s ease' }}>
          <div style={{ fontSize: 15, color: '#5a5248', lineHeight: 1.6, padding: '0 22px 20px', maxWidth: 720 }}>{a}</div>
        </div>
      </div>
    </Reveal>
  )
}