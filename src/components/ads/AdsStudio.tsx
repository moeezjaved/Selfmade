'use client'
/**
 * AdsStudio — the AI ads workspace (Lapis-style, our orange). Standalone at /ads-studio, NOT wired into
 * the live product nav yet (separate-from-prod while we build). Entry: the ads audit → this workspace,
 * pre-populated from the same crawl (products, brand, audiences, competitors). Phase 1 = shell + Home
 * (personalized templates) + section screens in our design language. Data wiring lands incrementally.
 */
import { useState } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', LIME = '#ef4a1e', ORANGE = '#e02f06', PAPER = '#fbf4e2', CREAM = '#fbf7ef'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

type Key = 'home' | 'search' | 'ads' | 'competitors' | 'discover' | 'products' | 'calendar' | 'brand' | 'audiences' | 'google'
const NAV: { group: string | null; items: { key: Key; label: string; icon: string; locked?: boolean }[] }[] = [
  { group: null, items: [{ key: 'home', label: 'Home', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' }, { key: 'search', label: 'Search', icon: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 015 12' }, { key: 'ads', label: 'Your Ads', icon: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6' }] },
  { group: 'Insights', items: [{ key: 'competitors', label: 'My Competitors', icon: 'M9 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 7-5m6-4a3 3 0 100-6M22 20c0-3-3-5-7-5' }, { key: 'discover', label: 'Discover', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM16 8l-2 6-6 2 2-6z' }, { key: 'products', label: 'Products', icon: 'M6 7h12l1 13H5zM9 7a3 3 0 016 0' }] },
  { group: 'Tools', items: [{ key: 'calendar', label: 'Calendar', icon: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4' }, { key: 'brand', label: 'Brand Kit', icon: 'M12 2a10 10 0 100 20c1 0 2-1 2-2 0-2-2-2-1-4 1-1 3 0 4-1a5 5 0 00-5-13z' }, { key: 'audiences', label: 'Audiences', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 8v8M8 12h8' }, { key: 'google', label: 'Google Ads', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v12' }, { key: 'google', label: 'ChatGPT Ads', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20', locked: true }] },
]

const Icon = ({ d, size = 19 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>
)

export default function AdsStudio() {
  const isMobile = useIsMobile()
  const [active, setActive] = useState<Key>('home')

  const Sidebar = (
    <aside style={{ width: isMobile ? '100%' : 250, flex: 'none', background: CREAM, borderRight: `1px solid ${LINE}`, padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: isMobile ? 'auto' : '100dvh', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 16px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: SERIF, fontWeight: 800, fontSize: 18 }}>S</div>
        <span style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 17, color: INK }}>Selfmade</span>
      </div>
      {NAV.map((sec, si) => (
        <div key={si} style={{ marginTop: sec.group ? 14 : 0 }}>
          {sec.group && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: SUB, opacity: .7, padding: '4px 10px 6px' }}>{sec.group}</div>}
          {sec.items.map((it, ii) => {
            const on = active === it.key && !it.locked
            return (
              <button key={`${it.key}-${ii}`} onClick={() => !it.locked && setActive(it.key)} disabled={it.locked}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: 'none', background: on ? '#fff' : 'transparent', color: it.locked ? '#bcb3a4' : on ? ORANGE : '#43403a', fontWeight: on ? 800 : 600, fontSize: 14.5, cursor: it.locked ? 'default' : 'pointer', fontFamily: SANS, textAlign: 'left', boxShadow: on ? '0 4px 14px -8px rgba(0,0,0,.25)' : 'none', transition: 'background .15s' }}>
                <Icon d={it.icon} />{it.label}{it.locked && <span style={{ marginLeft: 'auto', fontSize: 11 }}>🔒</span>}
              </button>
            )
          })}
        </div>
      ))}
      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: SUB, textAlign: 'center', marginBottom: 12 }}>⚡ 10 credits</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 100, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>YO</div>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Your brand</div><div style={{ fontSize: 12, color: SUB }}>yourstore.com</div></div>
        </div>
      </div>
    </aside>
  )

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100dvh', background: PAPER, fontFamily: SANS, color: INK }}>
      <style>{`@keyframes asFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      {Sidebar}
      <main style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '24px 18px 60px' : '40px 44px 60px', animation: 'asFade .4s ease' }} key={active}>
          {active === 'home' ? <Home isMobile={isMobile} />
            : active === 'ads' ? <YourAds isMobile={isMobile} />
              : active === 'competitors' ? <Competitors isMobile={isMobile} />
                : active === 'discover' ? <Discover isMobile={isMobile} />
                  : active === 'products' ? <Products isMobile={isMobile} />
                    : active === 'audiences' ? <Audiences isMobile={isMobile} />
                      : active === 'brand' ? <BrandKit isMobile={isMobile} />
                        : active === 'calendar' ? <Gated title="Content Calendar" blurb="Plan and generate content across every platform — powered by AI that knows your brand." items={['AI content planning with themes, copy & creative prompts', 'Multi-platform: posts, stories, reels, carousels, email', 'Auto-generated creatives per post', 'Day / week / month views', 'Export as ZIP']} />
                          : active === 'google' ? <Gated title="Google Ads" blurb="Generate high-performing Google Ads campaigns — keywords, ad copy and bid strategy, powered by AI." items={['AI keyword research tailored to your brand', 'Campaign generation with ad groups & keywords', 'Ad copy: headlines & descriptions optimized for Google']} />
                            : <Search isMobile={isMobile} />}
        </div>
        {active === 'home' && !isMobile && (
          <aside style={{ width: 300, flex: 'none', borderLeft: `1px solid ${LINE}`, background: '#fff', padding: '40px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}><span style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700 }}>History</span><span style={{ color: SUB, cursor: 'pointer' }}>✕</span></div>
            <div style={{ textAlign: 'center', color: SUB, marginTop: 60 }}><div style={{ fontSize: 30, marginBottom: 12 }}>💬</div><div style={{ fontSize: 14 }}>No conversations yet</div><div style={{ fontSize: 14, color: ORANGE, fontWeight: 700, marginTop: 8, cursor: 'pointer' }}>Start a new chat</div></div>
          </aside>
        )}
      </main>
    </div>
  )
}

const H1 = (isMobile: boolean): React.CSSProperties => ({ fontFamily: SERIF, fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.02em', margin: 0, color: INK })
const primaryBtn: React.CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 20px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: SANS }

/* ── Home ───────────────────────────────────────────────────────────────── */
function Home({ isMobile }: { isMobile: boolean }) {
  const channels = ['Banner Ad', 'WhatsApp', 'Instagram', 'Facebook', 'LinkedIn']
  const chips = ['Create an Instagram ad campaign', 'Generate ad creatives for my product', 'Design a product launch campaign', 'Make a WhatsApp promotional banner', 'Design a seasonal sale campaign', 'Create a LinkedIn thought-leadership post']
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', paddingTop: isMobile ? 8 : 24 }}>
        <h1 style={{ ...H1(isMobile), fontSize: isMobile ? 40 : 58 }}>Start with an idea</h1>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', margin: '28px 0 18px' }}>
        {channels.map((c) => <button key={c} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 600, color: INK, cursor: 'pointer', fontFamily: SANS }}>{c}</button>)}
      </div>
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 18, boxShadow: '0 20px 50px -34px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize: 15.5, color: SUB, minHeight: 44 }}>A vibrant summer-sale banner with tropical colors and palm leaves…</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', fontSize: 20, color: SUB, cursor: 'pointer' }}>+</button>
          <button style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 14px', fontSize: 13.5, color: INK, cursor: 'pointer' }}>Aspect Ratio ▾</button>
          <button style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 14px', fontSize: 13.5, color: INK, cursor: 'pointer' }}>English ▾</button>
          <button style={{ marginLeft: 'auto', width: 40, height: 40, borderRadius: 100, background: ORANGE, color: '#fff', border: 'none', fontSize: 18, cursor: 'pointer' }}>↑</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }}>
        {chips.map((c) => <button key={c} style={{ border: `1px solid ${LINE}`, background: 'transparent', borderRadius: 100, padding: '9px 15px', fontSize: 13.5, color: '#43403a', cursor: 'pointer', fontFamily: SANS }}>{c} ↗</button>)}
      </div>

      <div style={{ marginTop: 48 }}>
        <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 24 : 30, fontWeight: 700, margin: '0 0 4px' }}>Personalized templates</h2>
        <p style={{ color: SUB, fontSize: 14.5, margin: '0 0 20px' }}>These match your Brand Kit and company style.</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 16 }}>
          <TemplateCard label="Product Showcase" variant="showcase" />
          <TemplateCard label="Social Media Story" variant="story" />
          <TemplateCard label="Sale Campaign" variant="sale" />
        </div>
      </div>
    </div>
  )
}

/** A CSS-rendered ad template card (our generic templates, brand-fillable). */
function TemplateCard({ label, variant }: { label: string; variant: 'showcase' | 'story' | 'sale' }) {
  const bg = variant === 'showcase' ? 'linear-gradient(160deg,#eef1e8,#e3e9dc)' : variant === 'story' ? 'linear-gradient(160deg,#1f9b8e,#37b0a0)' : 'linear-gradient(160deg,#ff5a1f,#ffd21e)'
  const fg = variant === 'showcase' ? '#2f3a24' : '#fff'
  const head = variant === 'showcase' ? 'YOUR HEALTHY ALTERNATIVE' : variant === 'story' ? 'BREAK UP WITH YOUR BAD HABIT' : 'BIGGEST EVER SALE — 50% OFF'
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden', boxShadow: '0 12px 30px -20px rgba(0,0,0,.3)' }}>
      <div style={{ padding: '14px 16px 0', fontSize: 13.5, fontWeight: 800, color: INK }}>{label}</div>
      <div style={{ margin: 14, borderRadius: 12, aspectRatio: '4 / 5', background: bg, color: fg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '22px 16px', textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 13, letterSpacing: '.14em' }}>BRAND</div>
        <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: variant === 'sale' ? 24 : 22, lineHeight: 1.05, textShadow: variant === 'sale' ? '0 2px 0 rgba(0,0,0,.25)' : 'none' }}>{head}</div>
        <div style={{ background: variant === 'showcase' ? '#2f3a24' : variant === 'story' ? '#0e3d38' : '#111', color: '#fff', borderRadius: 8, padding: '9px 18px', fontSize: 12.5, fontWeight: 800 }}>{variant === 'sale' ? 'SHOP THE SALE' : variant === 'story' ? 'Swipe-Up ↗' : 'SHOP NOW'}</div>
      </div>
    </div>
  )
}

/* ── Your Ads ───────────────────────────────────────────────────────────── */
function YourAds({ isMobile }: { isMobile: boolean }) {
  return (
    <div>
      <Header title="Your Ads" isMobile={isMobile} action="Create New Ad" />
      <SearchBar placeholder="Search your ads…" />
      <div style={{ fontSize: 15, fontWeight: 800, margin: '26px 0 12px' }}>Recent</div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 16 }}>
        {['Break free from vaping', 'Study smarter, stress less', 'Elevate your wellness ritual', 'Breathe better, feel better'].map((t, i) => (
          <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 10px 26px -18px rgba(0,0,0,.3)' }}>
            <div style={{ aspectRatio: '1', background: `linear-gradient(150deg, ${['#e7efe4', '#f1ece3', '#e9efe6', '#efe7ea'][i]}, #fff)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 800, fontSize: 15, color: INK, textAlign: 'center', padding: 14 }}>{t}</div>
            <div style={{ padding: 12 }}><div style={{ fontSize: 13, fontWeight: 700 }}>Product ad</div><div style={{ fontSize: 12, color: SUB, marginBottom: 10 }}>Aug 24, 2026</div><div style={{ display: 'flex', gap: 8 }}><button style={{ ...primaryBtn, padding: '7px 14px', fontSize: 12.5, borderRadius: 8 }}>Download</button><button style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Share</button></div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── My Competitors ─────────────────────────────────────────────────────── */
function Competitors({ isMobile }: { isMobile: boolean }) {
  return (
    <div>
      <Header title="My Competitors" isMobile={isMobile} />
      <SearchBar placeholder="Search competitors…" />
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: isMobile ? 18 : 26, marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 100, background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 800 }}>R</div>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700 }}>Rival Brand</div>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: ORANGE, background: '#ffe7df', borderRadius: 100, padding: '4px 12px' }}>we found this</span>
        </div>
        <div style={{ fontSize: 14.5, color: '#43403a', lineHeight: 1.5, margin: '14px 0 16px' }}>Auto-discovered from your category. We write how they position against you and pull their <b>real running ads</b> from the Meta ad library + our ad-DNA crawl — the angles, hooks and offers actually winning in your niche.</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} style={{ aspectRatio: '4/5', borderRadius: 12, background: `linear-gradient(150deg, ${['#f4ede2', '#efe7ea', '#e9efe6', '#eef2f8'][i]}, #fff)`, border: `1px solid ${LINE}` }} />)}
        </div>
      </div>
      <div style={{ fontSize: 13, color: SUB, marginTop: 16 }}>Powered by our ad-DNA crawl (millions of classified ads) — deeper than a generic scrape.</div>
    </div>
  )
}

/* ── Discover ───────────────────────────────────────────────────────────── */
function Discover({ isMobile }: { isMobile: boolean }) {
  return (
    <div>
      <Header title="Discover" isMobile={isMobile} />
      <SearchBar placeholder="Search ads by brand, product, style…" />
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>{['Industry', 'Theme', 'Brand'].map((f) => <button key={f} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 16px', fontSize: 13.5, cursor: 'pointer' }}>{f} ▾</button>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 14, marginTop: 20 }}>
        {Array.from({ length: 8 }, (_, i) => <div key={i} style={{ aspectRatio: '3/4', borderRadius: 12, background: `linear-gradient(150deg, ${['#f4ede2', '#efe7ea', '#e9efe6', '#eef2f8', '#f7f0e0', '#eef3ee'][i % 6]}, #fff)`, border: `1px solid ${LINE}` }} />)}
      </div>
    </div>
  )
}

/* ── Products ───────────────────────────────────────────────────────────── */
function Products({ isMobile }: { isMobile: boolean }) {
  const names = ['Orange Flavour', 'Niko Armani', 'Lucien Da Vinci', 'Maple Pepper', 'White Cranberry', 'Stick Base', 'Flavour 8-Pack', 'Mint Flavour', 'Pink Journey Pack', 'Strawberry']
  return (
    <div>
      <Header title="Products" isMobile={isMobile} action="Import from Website" />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 14 }}>Detected from your store — select products to generate ads for.</div>
      <SearchBar placeholder="Search products…" />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 14, marginTop: 20 }}>
        {names.map((n, i) => (
          <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
            <div style={{ aspectRatio: '1', background: `linear-gradient(150deg, ${['#f7ecd8', '#eceee9', '#efe6df', '#f0ece2', '#f6e9ea'][i % 5]}, #fff)`, position: 'relative' }}><span style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${LINE}`, background: '#fff' }} /></div>
            <div style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>{n}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Audiences ──────────────────────────────────────────────────────────── */
function Audiences({ isMobile }: { isMobile: boolean }) {
  const segs = [
    { name: 'Urban buyers', insights: ['Young urban adults in major cities, 18–30, mobile-first and social.', 'Spend on delivery & convenience, follow local creators on IG/TikTok.', 'Value modern, discreet, well-designed products.', 'Shop online, comfortable with fast checkout and strong social proof.'] },
    { name: 'Value seekers', insights: ['Budget-conscious but will pay for things that clearly help them.', 'Research via reviews, Reels and community groups before buying.', 'Respond to bundles, guarantees and limited-time offers.', 'Prefer cash-on-delivery or familiar local payment.'] },
  ]
  return (
    <div>
      <Header title="Audiences" isMobile={isMobile} action="Add Audience" />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 18 }}>We identify your target audiences from your store — each drives a tailored set of ads.</div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 16 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: isMobile ? 18 : 24 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, marginBottom: 6 }}>Audience {i + 1}</div>
            <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 14 }}>{s.name}</div>
            {s.insights.map((t, j) => <div key={j} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: '#43403a', lineHeight: 1.5, marginBottom: 12 }}><span style={{ width: 6, height: 6, borderRadius: 100, background: ORANGE, marginTop: 7, flex: 'none' }} />{t}</div>)}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Brand Kit ──────────────────────────────────────────────────────────── */
function BrandKit({ isMobile }: { isMobile: boolean }) {
  return (
    <div>
      <Header title="Brand Kit" isMobile={isMobile} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 18 }}>The visual identity and knowledge we use for your brand.</div>
      <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${LINE}`, marginBottom: 20 }}>{['Visual Brand Kit', 'Knowledge Base'].map((t, i) => <div key={t} style={{ padding: '8px 0', fontSize: 15, fontWeight: 700, color: i === 0 ? INK : SUB, borderBottom: i === 0 ? `2px solid ${ORANGE}` : 'none' }}>{t}</div>)}</div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 16, fontWeight: 800 }}>Your logo</span><button style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Change</button></div>
        <div style={{ fontSize: 13.5, color: SUB, marginBottom: 14 }}>We use this across your creatives.</div>
        <div style={{ width: 120, height: 120, borderRadius: 12, border: `1px dashed ${LINE}`, background: PAPER }} />
      </div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 16, fontWeight: 800 }}>Your visual world</span><button style={{ ...primaryBtn, padding: '7px 16px', fontSize: 13, borderRadius: 8 }}>Add</button></div>
        <div style={{ fontSize: 13.5, color: SUB, marginBottom: 14 }}>These images shape how we design for you.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>{[0, 1, 2].map((i) => <div key={i} style={{ aspectRatio: '4/3', borderRadius: 10, background: PAPER, border: `1px solid ${LINE}` }} />)}</div>
      </div>
    </div>
  )
}

/* ── Gated tool (Calendar / Google Ads) ─────────────────────────────────── */
function Gated({ title, blurb, items }: { title: string; blurb: string; items: string[] }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 20 }}>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 20, background: '#fff', padding: 32, boxShadow: '0 24px 60px -40px rgba(0,0,0,.4)' }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, margin: '0 0 8px' }}>{title}</h1>
        <p style={{ color: SUB, fontSize: 15, lineHeight: 1.5, margin: '0 0 22px' }}>{blurb}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>{items.map((t) => <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14.5 }}><span style={{ color: '#1f8f4e' }}>✓</span>{t}</div>)}</div>
        <button style={primaryBtn}>Unlock — from $19/mo</button>
      </div>
    </div>
  )
}

/* ── Search (overlay-style panel) ───────────────────────────────────────── */
function Search({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto 0' }}>
      <SearchBar placeholder="Search by headline, prompt, or description…" />
      <div style={{ textAlign: 'center', color: SUB, marginTop: 60 }}><div style={{ fontSize: 30 }}>🔎</div><div style={{ fontSize: 15, fontWeight: 700, marginTop: 10, color: INK }}>Start typing to search your ads</div></div>
    </div>
  )
}

/* ── shared bits ────────────────────────────────────────────────────────── */
function Header({ title, isMobile, action }: { title: string; isMobile: boolean; action?: string }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}><h1 style={H1(isMobile)}>{title}</h1>{action && <button style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>{action}</button>}</div>
}
function SearchBar({ placeholder }: { placeholder: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}><Icon d="M11 4a7 7 0 105 12l4 4" size={18} /><span style={{ color: SUB, fontSize: 15 }}>{placeholder}</span></div>
}
