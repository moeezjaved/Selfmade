'use client'
/**
 * AdsStudio — the AI ads workspace (Lapis-style, our orange). Standalone at /ads-studio, NOT wired into
 * the live product nav yet (separate-from-prod while we build). Entry: the ads audit → this workspace,
 * pre-populated from the same crawl (products, brand, audiences, competitors). Phase 1 = shell + Home
 * (personalized templates) + section screens in our design language. Data wiring lands incrementally.
 */
import { useState, useEffect, useRef } from 'react'
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
  const [domain, setDomain] = useState('')
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('domain')
    const c = document.cookie.match(/sf_scan_domain=([^;]+)/)?.[1]
    const d = (u || (c ? decodeURIComponent(c) : '') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
    if (d) setDomain(d)
  }, [])

  const Sidebar = (
    <aside style={{ width: isMobile ? '100%' : 250, flex: 'none', background: '#fff', borderRight: `1px solid ${LINE}`, padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: isMobile ? 'auto' : '100dvh', boxSizing: 'border-box' }}>
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
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: 'none', background: on ? '#fdeee9' : 'transparent', color: it.locked ? '#bcb3a4' : on ? ORANGE : '#43403a', fontWeight: on ? 800 : 600, fontSize: 14.5, cursor: it.locked ? 'default' : 'pointer', fontFamily: SANS, textAlign: 'left', transition: 'background .15s' }}>
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
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100dvh', background: '#fff', fontFamily: SANS, color: INK }}>
      <style>{`@keyframes asFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes sfspin{to{transform:rotate(360deg)}}.sf-fact:hover .sf-fact-actions{opacity:1!important}`}</style>
      {Sidebar}
      <main style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '24px 18px 60px' : '40px 44px 60px', animation: 'asFade .4s ease' }} key={active}>
          {active === 'home' ? <Home isMobile={isMobile} domain={domain} />
            : active === 'ads' ? <YourAds isMobile={isMobile} />
              : active === 'competitors' ? <Competitors isMobile={isMobile} domain={domain} />
                : active === 'discover' ? <Discover isMobile={isMobile} />
                  : active === 'products' ? <Products isMobile={isMobile} domain={domain} />
                    : active === 'audiences' ? <Audiences isMobile={isMobile} domain={domain} />
                      : active === 'brand' ? <BrandKit isMobile={isMobile} domain={domain} />
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
const ASPECTS = ['Auto', '1:1', '4:5', '9:16', '16:9']
const LANGS = ['English', 'Urdu', 'Hindi', 'Bengali', 'Arabic', 'Spanish', 'French', 'German', 'Portuguese', 'Indonesian']
const CHANNELS: AdFormat[] = ['Banner Ad', 'WhatsApp', 'Instagram', 'Facebook', 'LinkedIn']
type AdFormat = 'Banner Ad' | 'WhatsApp' | 'Instagram' | 'Facebook' | 'LinkedIn'
type ChatMsg = { role: 'user' | 'assistant'; text?: string; image?: string | null; caption?: string; error?: string; loading?: boolean; format?: AdFormat }
type HomeTag = { label: string; image?: string | null; kind: 'product' | 'upload' | 'element' | 'discover' | 'template' }
type BrandKitLite = { siteName?: string; logo?: string | null; colors?: { hex: string }[]; fonts?: string[]; facts?: string[]; voice?: any }

function Home({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [kit, setKit] = useState<BrandKitLite | null>(null)
  const [products, setProducts] = useState<{ title: string; image: string | null }[]>([])
  const [format, setFormat] = useState<AdFormat>('Instagram')
  const [input, setInput] = useState('')
  const [aspect, setAspect] = useState('Auto')
  const [lang, setLang] = useState('English')
  const [open, setOpen] = useState<'' | 'aspect' | 'lang' | 'add'>('')
  const [tags, setTags] = useState<HomeTag[]>([])
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!domain) return
    fetch(`/api/ads-studio/brand-kit?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => !d?.empty && setKit(d)).catch(() => {})
    fetch(`/api/ads-studio/products?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => setProducts(Array.isArray(d.products) ? d.products : [])).catch(() => {})
  }, [domain])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = () => setTags((t) => [...t, { label: f.name.slice(0, 24), image: String(reader.result), kind: 'upload' }])
    reader.readAsDataURL(f); setOpen('')
  }

  const send = async (text?: string) => {
    const message = (text ?? input).trim()
    if (!message || busy) return
    setBusy(true); setInput('')
    const fmt = format
    setMsgs((m) => [...m, { role: 'user', text: message, format: fmt }, { role: 'assistant', loading: true, format: fmt }])
    try {
      const plan = await fetch('/api/ads-studio/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, format: fmt, language: lang, siteName: kit?.siteName, facts: kit?.facts, voice: kit?.voice, productTitles: products.map((p) => p.title) }) }).then((r) => r.json())
      // Product images: tagged refs (product/upload/discover/element) first, else the planned product.
      const tagImgs = tags.map((t) => t.image).filter(Boolean) as string[]
      const planned = plan.productIndex >= 0 ? products[plan.productIndex]?.image : products[0]?.image
      const productImages = (tagImgs.length ? tagImgs : [planned]).filter(Boolean)
      if (!productImages.length) throw new Error('no-product')
      const colors = (kit?.colors || []).map((c) => c.hex).slice(0, 4)
      const fonts = kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined
      const aspectRatio = aspect !== 'Auto' ? aspect : plan.aspect
      const res = await fetch('/api/discovery/generate-ad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productImages, newHeadline: plan.headline, angle: plan.angle, aspectRatio, colors, fonts, logo: kit?.logo || undefined, imageSize: '2K' }) })
      const d = await res.json()
      if (!res.ok) {
        const err = d.error === 'insufficient_credits' ? 'You’re out of credits — top up to generate more ads.' : res.status === 401 ? 'Sign in from your ads audit to generate.' : (d.error || 'Generation failed. Try again.')
        setMsgs((m) => replaceLast(m, { role: 'assistant', error: err, format: fmt }))
      } else {
        setMsgs((m) => replaceLast(m, { role: 'assistant', image: d.url || d.image || null, caption: plan.caption, format: fmt }))
      }
      setTags([])
    } catch {
      setMsgs((m) => replaceLast(m, { role: 'assistant', error: 'Couldn’t generate — make sure your store has product images.', format: fmt }))
    } finally { setBusy(false) }
  }
  const replaceLast = (m: ChatMsg[], next: ChatMsg) => { const c = [...m]; c[c.length - 1] = next; return c }

  const chips = ['Create an Instagram ad campaign', 'Generate ad creatives for my product', 'Design a product launch campaign', 'Make a WhatsApp promotional banner', 'Design a seasonal sale campaign', 'Create a LinkedIn thought-leadership post']
  const started = msgs.length > 0
  const dd = (label: string, val: string, which: 'aspect' | 'lang', opts: string[]) => (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(open === which ? '' : which)} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 14px', fontSize: 13.5, color: INK, cursor: 'pointer' }}>{val === 'Auto' && which === 'aspect' ? 'Aspect Ratio' : val} ▾</button>
      {open === which && (
        <div style={{ position: 'absolute', bottom: 44, left: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 16px 40px -18px rgba(0,0,0,.4)', padding: 6, zIndex: 20, minWidth: 150, maxHeight: 240, overflowY: 'auto' }}>
          {opts.map((o) => <button key={o} onClick={() => { which === 'aspect' ? setAspect(o) : setLang(o); setOpen('') }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: (which === 'aspect' ? aspect : lang) === o ? PAPER : 'transparent', borderRadius: 8, padding: '8px 12px', fontSize: 13.5, cursor: 'pointer', color: INK }}>{o}</button>)}
        </div>
      )}
    </div>
  )

  const composer = (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 16, boxShadow: started ? 'none' : '0 20px 50px -34px rgba(0,0,0,.4)' }}>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {tags.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${LINE}`, borderRadius: 100, padding: '5px 8px 5px 6px', fontSize: 12.5, fontWeight: 600 }}>
              {t.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={t.image} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: 'cover' }} />}
              {t.label}<button onClick={() => setTags((x) => x.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: SUB, fontSize: 14, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={started ? 'Describe changes or a new ad…' : `Describe your ${format} ad…`} rows={started ? 1 : 2} style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: 15.5, color: INK, fontFamily: SANS, background: 'transparent', lineHeight: 1.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        <div style={{ position: 'relative' }}>
          <button onClick={() => setOpen(open === 'add' ? '' : 'add')} style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', fontSize: 20, color: SUB, cursor: 'pointer' }}>+</button>
          {open === 'add' && (
            <div style={{ position: 'absolute', bottom: 48, left: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 16px 40px -18px rgba(0,0,0,.4)', padding: 8, zIndex: 20, width: 240, maxHeight: 300, overflowY: 'auto' }}>
              <button onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '9px 10px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', color: INK }}>⬆ Upload from computer</button>
              {products.length > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: SUB, padding: '8px 10px 4px', textTransform: 'uppercase', letterSpacing: .4 }}>Your products</div>}
              {products.slice(0, 12).map((p, i) => (
                <button key={i} onClick={() => { setTags((t) => [...t, { label: p.title.slice(0, 24), image: p.image, kind: 'product' }]); setOpen('') }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '7px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: INK, textAlign: 'left' }}>
                  {p.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={p.image} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {dd('Aspect', aspect, 'aspect', ASPECTS)}
        {dd('Language', lang, 'lang', LANGS)}
        <button onClick={() => send()} disabled={busy || !input.trim()} style={{ marginLeft: 'auto', width: 40, height: 40, borderRadius: 100, background: busy || !input.trim() ? '#e7c4b8' : ORANGE, color: '#fff', border: 'none', fontSize: 18, cursor: busy || !input.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <span style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,.5)', borderTopColor: '#fff', borderRadius: '50%', animation: 'sfspin .7s linear infinite' }} /> : '↑'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      {!started && <div style={{ textAlign: 'center', paddingTop: isMobile ? 8 : 24 }}><h1 style={{ ...H1(isMobile), fontSize: isMobile ? 40 : 58 }}>Start with an idea</h1></div>}

      {/* format selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', margin: started ? '0 0 16px' : '28px 0 18px' }}>
        {CHANNELS.map((c) => {
          const on = format === c
          const ic: Record<AdFormat, string> = { 'Banner Ad': '🖥', WhatsApp: '💬', Instagram: '📷', Facebook: 'f', LinkedIn: 'in' }
          return <button key={c} onClick={() => setFormat(c)} style={{ border: `1px solid ${on ? ORANGE : LINE}`, background: on ? '#fdeee9' : '#fff', color: on ? ORANGE : INK, borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: SANS, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 13 }}>{ic[c]}</span>{c}</button>
        })}
      </div>

      {/* conversation */}
      {started && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 18 }}>
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '78%', background: '#fdeee9', color: INK, borderRadius: '16px 16px 4px 16px', padding: '11px 15px', fontSize: 14.5 }}>{m.text}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '86%' }}>
              {m.loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: SUB, fontSize: 14 }}><span style={{ width: 15, height: 15, border: `2px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .7s linear infinite' }} />Mello is designing your {m.format} ad…</div>
              ) : m.error ? (
                <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 16px', fontSize: 14, color: '#b23', background: '#fff5f2' }}>{m.error}</div>
              ) : (
                <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', background: '#fff', maxWidth: 340 }}>
                  {m.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={m.image} alt="" style={{ width: '100%', display: 'block' }} />}
                  <div style={{ padding: 12 }}>
                    {m.caption && <div style={{ fontSize: 13, color: '#43403a', lineHeight: 1.45, marginBottom: 10 }}>{m.caption}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {m.image && <a href={m.image} download style={{ ...primaryBtn, padding: '7px 14px', fontSize: 12.5, borderRadius: 8, textDecoration: 'none' }}>Download</a>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {composer}

      {!started && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          {chips.map((c) => <button key={c} onClick={() => send(c)} style={{ border: `1px solid ${LINE}`, background: 'transparent', borderRadius: 100, padding: '9px 15px', fontSize: 13.5, color: '#43403a', cursor: 'pointer', fontFamily: SANS }}>{c} ↗</button>)}
        </div>
      )}

      {!started && <PersonalizedTemplates isMobile={isMobile} domain={domain} onUse={(t) => { setTags((x) => [...x, { label: t.title.slice(0, 24), image: t.image, kind: 'template' }]); send(`Make a ${t.title} for my brand`) }} />}
    </div>
  )
}

/** A CSS-rendered ad template card (our generic templates, brand-fillable). */
type Template = { title: string; concept: string; image?: string | null }
function PersonalizedTemplates({ isMobile, domain, onUse }: { isMobile: boolean; domain: string; onUse: (t: { title: string; image?: string | null }) => void }) {
  const [tpls, setTpls] = useState<Template[] | null>(null)
  useEffect(() => {
    if (!domain) return
    let on = true
    fetch(`/api/ads-studio/templates?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setTpls(Array.isArray(d.templates) ? d.templates : [])).catch(() => on && setTpls([]))
    return () => { on = false }
  }, [domain])
  if (tpls !== null && tpls.length === 0) return null
  const grad = ['#f4ede2', '#e9efe6', '#eef2f8', '#f7f0e0', '#efe7ea', '#eef3ee']
  return (
    <div style={{ marginTop: 48 }}>
      <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 24 : 30, fontWeight: 700, margin: '0 0 4px' }}>Personalized templates</h2>
      <p style={{ color: SUB, fontSize: 14.5, margin: '0 0 20px' }}>Ad concepts generated from your Brand Kit — free. Tap one and Mello builds it in the chat.</p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 16 }}>
        {(tpls || Array.from({ length: 6 }, () => null)).map((t, i) => (
          <button key={i} onClick={() => t && onUse({ title: t.title, image: t.image })} disabled={!t} style={{ textAlign: 'left', border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden', cursor: t ? 'pointer' : 'default', padding: 0, fontFamily: SANS }}>
            <div style={{ aspectRatio: '4/5', background: t?.image ? '#fff' : `linear-gradient(150deg, ${grad[i % 6]}, #fff)`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {t?.image /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={t.image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700, color: INK, padding: 20, textAlign: 'center' }}>{t?.title || ''}</span>}
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{t?.title || '…'}</div>
              {t?.concept && <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.45, maxHeight: 54, overflow: 'hidden' }}>{t.concept}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

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

/* ── My Competitors (real ad-DNA data) ──────────────────────────────────── */
type CompAd = { id: string; thumb: string | null; copy: string; format: string | null; active: boolean }
type CompDna = { hooks: string[]; angles: string[]; personas: string[] }
type Comp = { source: 'discovered' | 'spied'; pageId?: string | null; domain?: string | null; name: string; reason?: string; hasAdDna: boolean; adsSource?: 'corpus' | 'live' | null; spyable: boolean; adCount: number; ads: CompAd[]; dna: CompDna | null; checked?: boolean }
type CompSeed = { name: string; category: string; market: string; queries: string[] } | null
function DnaRow({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: SUB, flex: 'none' }}>{label}</span>
      {items.map((t) => <span key={t} style={{ fontSize: 12, fontWeight: 600, color: INK, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '3px 10px' }}>{t}</span>)}
    </div>
  )
}

function CompCard({ c, isMobile, onSpy }: { c: Comp; isMobile: boolean; onSpy?: (c: Comp) => Promise<void> }) {
  const [spying, setSpying] = useState(false)
  const hasAds = c.ads.length > 0
  const badge = c.adsSource === 'corpus' ? `${c.adCount.toLocaleString()} ads decoded` : `${c.adCount.toLocaleString()} live ad${c.adCount === 1 ? '' : 's'}`
  const spy = async () => { if (spying) return; setSpying(true); try { await onSpy?.(c) } finally { setSpying(false) } }
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: isMobile ? 18 : 24, marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 100, background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 800, color: INK, flex: 'none', overflow: 'hidden' }}>
          {c.domain /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=64`} alt="" style={{ width: 24, height: 24 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} /> : (c.name[0]?.toUpperCase() || 'C')}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: SERIF, fontSize: isMobile ? 17 : 20, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
            {c.source === 'spied' && <span style={{ fontSize: 10, fontWeight: 800, color: SUB, border: `1px solid ${LINE}`, borderRadius: 100, padding: '2px 8px', flex: 'none' }}>SPYING</span>}
          </div>
          <div style={{ fontSize: 12.5, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.domain || (c.adsSource === 'corpus' ? `${c.adCount.toLocaleString()} ads in our index` : '')}</div>
        </div>
        {hasAds
          ? <span style={{ fontSize: 12, fontWeight: 800, color: ORANGE, background: '#ffe7df', borderRadius: 100, padding: '5px 12px', flex: 'none' }}>{badge}</span>
          : <button onClick={spy} disabled={spying} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: spying ? '#c9927f' : ORANGE, border: 'none', borderRadius: 100, padding: '7px 14px', cursor: spying ? 'default' : 'pointer', flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              {spying && <span style={{ width: 11, height: 11, border: '2px solid rgba(255,255,255,.5)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'sfspin .7s linear infinite' }} />}
              {spying ? 'Spying…' : c.checked ? 'Re-check' : 'Spy their ads →'}
            </button>}
      </div>

      {c.reason && <div style={{ fontSize: 13.5, color: '#43403a', lineHeight: 1.5, marginTop: 12 }}>{c.reason}</div>}

      {c.dna && (c.dna.hooks.length + c.dna.angles.length + c.dna.personas.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14, padding: 14, background: CREAM, borderRadius: 12 }}>
          <DnaRow label="Hooks" items={c.dna.hooks} />
          <DnaRow label="Angles" items={c.dna.angles} />
          <DnaRow label="Personas" items={c.dna.personas} />
        </div>
      )}

      {hasAds ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', marginTop: 16, paddingBottom: 6 }}>
          {c.ads.map((a) => (
            <div key={a.id} style={{ width: isMobile ? 150 : 190, flex: 'none', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div style={{ aspectRatio: '4 / 5', background: PAPER, position: 'relative' }}>
                {a.thumb /* eslint-disable-next-line @next/next/no-img-element */ && <img src={a.thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
                {a.active && <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800, color: '#fff', background: '#1f8f4e', borderRadius: 100, padding: '2px 8px' }}>LIVE</span>}
                {a.format === 'video' && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 100, padding: '2px 8px' }}>▶ VIDEO</span>}
              </div>
              {a.copy && <div style={{ fontSize: 11.5, color: '#43403a', lineHeight: 1.4, padding: '9px 11px', maxHeight: 66, overflow: 'hidden' }}>{a.copy}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: SUB, marginTop: 12 }}>
          {spying ? <>Pulling their live creatives from the Meta Ad Library…</>
            : c.checked ? <>No live Meta ads found for this brand right now.</>
              : <>We found this rival{c.domain ? ` (${c.domain})` : ''} — hit <b style={{ color: INK }}>Spy their ads</b> to pull their live creatives from the Meta Ad Library.</>}
        </div>
      )}
    </div>
  )
}

const SCAN_STEPS = ['Reading your store…', 'Pinpointing your exact niche…', 'Searching Google for rival brands…', 'Sweeping the Meta Ad Library (all countries)…', 'Pulling competitors’ live ads…', 'Decoding their ad strategy…']

function Competitors({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [comps, setComps] = useState<Comp[] | null>(null)
  const [seed, setSeed] = useState<CompSeed>(null)
  const [q, setQ] = useState('')
  const [step, setStep] = useState(0)
  useEffect(() => {
    let on = true
    setComps(null); setStep(0)
    const tick = setInterval(() => on && setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 11000)
    fetch(`/api/ads-studio/competitors${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`).then((r) => r.json()).then((d) => { if (!on) return; setComps(Array.isArray(d.competitors) ? d.competitors : []); setSeed(d.seed || null) }).catch(() => on && setComps([]))
    return () => { on = false; clearInterval(tick) }
  }, [domain])

  const spy = async (c: Comp) => {
    const p = new URLSearchParams()
    if (c.name) p.set('name', c.name)
    if (c.domain) p.set('domain', c.domain)
    const d = await fetch(`/api/ads-studio/competitor-ads?${p.toString()}`).then((r) => r.json()).catch(() => null)
    const ads: CompAd[] = Array.isArray(d?.ads) ? d.ads : []
    const key = (x: Comp) => x.pageId || x.domain || x.name
    setComps((prev) => (prev || []).map((x) => key(x) === key(c) ? { ...x, ads, adsSource: ads.length ? 'live' : x.adsSource, adCount: ads.length || x.adCount, spyable: ads.length ? false : x.spyable, checked: true, pageId: d?.pageId || x.pageId } : x))
  }
  const shown = (comps || []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || (c.domain || '').includes(q.trim().toLowerCase()))
  return (
    <div>
      <Header title="My Competitors" isMobile={isMobile} action="Add competitor" />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 14 }}>
        We found your real rivals{seed?.category ? <> in <b style={{ color: INK }}>{seed.category}</b></> : ''}{seed?.market ? <> — {seed.market}</> : ''} across the web <b style={{ color: INK }}>and the Meta Ad Library</b>, then pulled their <b style={{ color: INK }}>live ads &amp; ad strategy</b>.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}>
        <Icon d="M11 4a7 7 0 105 12l4 4" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search competitors…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: INK, fontFamily: SANS }} />
      </div>

      {comps === null ? (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: '38px 28px', marginTop: 20, textAlign: 'center' }}>
          <div style={{ width: 34, height: 34, margin: '0 auto 16px', border: `3px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .8s linear infinite' }} />
          <div style={{ fontFamily: SERIF, fontSize: isMobile ? 18 : 21, fontWeight: 700, marginBottom: 6 }}>{SCAN_STEPS[step]}</div>
          <div style={{ color: SUB, fontSize: 13.5, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>Finding your real rivals across Google and the Meta Ad Library, then decoding their live ads. This takes a minute — worth the wait.</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 18 }}>
            {SCAN_STEPS.map((_, i) => <span key={i} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 100, background: i <= step ? ORANGE : LINE, transition: 'width .3s, background .3s' }} />)}
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 18, background: '#fff', padding: 40, textAlign: 'center', marginTop: 22 }}>
          <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No competitors found yet</div>
          <div style={{ color: SUB, fontSize: 14.5, lineHeight: 1.5, maxWidth: 460, margin: '0 auto 18px' }}>{domain ? 'We couldn’t auto-discover rivals for this store. Add one and we’ll pull their live ads.' : 'Run an ads audit first so we know your store — then we auto-find your rivals and their ads.'}</div>
          <button style={primaryBtn}>Add a competitor</button>
        </div>
      ) : (() => {
        const withAds = shown.filter((c) => c.ads.length > 0)
        const withoutAds = shown.filter((c) => c.ads.length === 0)
        return (
          <>
            {withAds.map((c) => <CompCard key={c.pageId || c.domain || c.name} c={c} isMobile={isMobile} onSpy={spy} />)}
            {withoutAds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '26px 0 4px' }}>
                <div style={{ height: 1, background: LINE, flex: 1 }} />
                <span style={{ fontSize: 12.5, fontWeight: 800, color: SUB, whiteSpace: 'nowrap' }}>{withoutAds.length} competitor{withoutAds.length > 1 ? 's' : ''} without Meta ads</span>
                <div style={{ height: 1, background: LINE, flex: 1 }} />
              </div>
            )}
            {withoutAds.map((c) => <CompCard key={c.pageId || c.domain || c.name} c={c} isMobile={isMobile} onSpy={spy} />)}
          </>
        )
      })()}
      <div style={{ fontSize: 13, color: SUB, marginTop: 18 }}>Rivals discovered from live Google results and the Meta Ad Library in your market, then decoded against our ad-DNA crawl (millions of classified ads).</div>
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

/* ── Products (real catalog from the store) ─────────────────────────────── */
type StoreProduct = { title: string; image: string | null; price: string | null; url: string }
function Products({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [data, setData] = useState<{ products: StoreProduct[]; siteName: string } | null>(null)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!domain) { setData({ products: [], siteName: '' }); return }
    let on = true; setData(null)
    fetch(`/api/ads-studio/products?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setData({ products: Array.isArray(d.products) ? d.products : [], siteName: d.siteName || '' })).catch(() => on && setData({ products: [], siteName: '' }))
    return () => { on = false }
  }, [domain])
  const products = (data?.products || []).filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()))
  const selCount = Object.values(sel).filter(Boolean).length
  return (
    <div>
      <Header title="Products" isMobile={isMobile} action={selCount ? `Generate ads (${selCount})` : 'Import from Website'} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 14 }}>{domain ? `Detected from ${domain} — select products to generate ads for.` : 'Connect a store to detect your products.'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}>
        <Icon d="M11 4a7 7 0 105 12l4 4" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: INK, fontFamily: SANS }} />
      </div>
      {data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your catalog…</div>
        : products.length === 0 ? <EmptyState title={domain ? 'No products found' : 'No store connected'} body={domain ? 'We couldn’t read products from this store — import manually or check the URL.' : 'Open this workspace from your ads audit and we’ll auto-detect your catalog.'} cta="Import from Website" />
          : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 14, marginTop: 20 }}>
              {products.map((p, i) => {
                const on = !!sel[p.url]
                return (
                  <div key={p.url + i} onClick={() => setSel((s) => ({ ...s, [p.url]: !s[p.url] }))} style={{ border: `1px solid ${on ? ORANGE : LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden', cursor: 'pointer', boxShadow: on ? `0 0 0 2px ${ORANGE}22` : 'none' }}>
                    <div style={{ aspectRatio: '1', background: PAPER, position: 'relative' }}>
                      {p.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={p.image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
                      <span style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${on ? ORANGE : LINE}`, background: on ? ORANGE : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 }}>{on ? '✓' : ''}</span>
                    </div>
                    <div style={{ padding: '10px 12px' }}><div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>{p.price && <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{p.price}</div>}</div>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

/* ── Audiences (AI, grounded on real store signals) ─────────────────────── */
type Aud = { name: string; insights: string[] }
function Audiences({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [data, setData] = useState<{ market: string; audiences: Aud[]; signals: string[] } | null>(null)
  useEffect(() => {
    if (!domain) { setData({ market: '', audiences: [], signals: [] }); return }
    let on = true; setData(null)
    fetch(`/api/ads-studio/audiences?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setData({ market: d.market || '', audiences: Array.isArray(d.audiences) ? d.audiences : [], signals: Array.isArray(d.signals) ? d.signals : [] })).catch(() => on && setData({ market: '', audiences: [], signals: [] }))
    return () => { on = false }
  }, [domain])
  return (
    <div>
      <Header title="Audiences" isMobile={isMobile} action="Add Audience" />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 8 }}>We read your store’s real signals to identify who actually buys — each audience drives its own ads.</div>
      {data?.market && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ffe7df', color: ORANGE, borderRadius: 100, padding: '6px 14px', fontSize: 13, fontWeight: 800, marginBottom: 18 }}>📍 Detected market: {data.market}</div>}
      {data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your store & building audiences…</div>
        : data.audiences.length === 0 ? <EmptyState title={domain ? 'Couldn’t build audiences yet' : 'No store connected'} body={domain ? 'We couldn’t read enough from this store — try again in a moment.' : 'Open this workspace from your ads audit and we’ll auto-detect your audiences.'} cta="Add Audience" />
          : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 16 }}>
                {data.audiences.map((s, i) => (
                  <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: isMobile ? 18 : 24 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, marginBottom: 6 }}>Audience {i + 1} · {s.insights.length} insights</div>
                    <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 14 }}>{s.name}</div>
                    {s.insights.map((t, j) => <div key={j} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: '#43403a', lineHeight: 1.5, marginBottom: 12 }}><span style={{ width: 6, height: 6, borderRadius: 100, background: ORANGE, marginTop: 7, flex: 'none' }} />{t}</div>)}
                  </div>
                ))}
              </div>
              {data.signals.length > 0 && <div style={{ fontSize: 12.5, color: SUB, marginTop: 16 }}>Grounded on real signals from your site: {data.signals.join(' · ')}.</div>}
            </>
          )}
    </div>
  )
}
function EmptyState({ title, body, cta }: { title: string; body: string; cta: string }) {
  return (
    <div style={{ border: `1px dashed ${LINE}`, borderRadius: 18, background: '#fff', padding: 40, textAlign: 'center', marginTop: 22 }}>
      <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ color: SUB, fontSize: 14.5, lineHeight: 1.5, maxWidth: 460, margin: '0 auto 18px' }}>{body}</div>
      <button style={primaryBtn}>{cta}</button>
    </div>
  )
}

/* ── Brand Kit (derived from the website — no Shopify needed) ────────────── */
type BrandKitData = { siteName: string; logo: string | null; colors: { hex: string; primary: boolean }[]; fonts: string[]; facts: string[]; voice: { tone: string; energy: string; audience: string } | null; visualPages: string[]; empty?: boolean; saved?: boolean; editable?: boolean }
function BrandKit({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [tab, setTab] = useState<'visual' | 'knowledge'>('visual')
  const [data, setData] = useState<BrandKitData | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const post = async (payload: any) => {
    if (busy) return
    setBusy(true)
    try {
      const d = await fetch('/api/ads-studio/brand-kit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain, ...payload }) }).then((r) => r.json()).catch(() => null)
      if (d && Array.isArray(d.facts)) setData(d)
      else if (d?.error) alert(d.error)
    } finally { setBusy(false) }
  }
  const addFact = () => { const t = window.prompt('Add something we should know about your brand:'); if (t && t.trim()) post({ action: 'addFact', text: t.trim() }) }
  const editFact = (i: number, cur: string) => { const t = window.prompt('Edit this fact:', cur); if (t != null && t.trim()) post({ action: 'editFact', index: i, text: t.trim() }) }
  const delFact = (i: number) => { if (window.confirm('Delete this fact?')) post({ action: 'deleteFact', index: i }) }
  useEffect(() => {
    if (!domain) { setData({ empty: true } as any); return }
    let on = true; setData(null)
    fetch(`/api/ads-studio/brand-kit?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setData(d)).catch(() => on && setData({ empty: true } as any))
    return () => { on = false }
  }, [domain])
  const shotUrl = (u: string) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(u)}?w=640&h=480`
  const facts = data?.facts || []

  return (
    <div>
      <Header title="Brand Kit" isMobile={isMobile} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 18 }}>The visual identity and knowledge we learned from {domain || 'your site'} — no setup, no Shopify needed.</div>
      <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${LINE}`, marginBottom: 22 }}>
        {(['visual', 'knowledge'] as const).map((t) => <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 2px', fontSize: 15, fontWeight: 700, color: tab === t ? INK : SUB, borderBottom: tab === t ? `2px solid ${ORANGE}` : '2px solid transparent', background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS }}>{t === 'visual' ? 'Visual Brand Kit' : 'Knowledge Base'}</button>)}
      </div>

      {data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your brand from the site…</div>
        : data.empty ? <EmptyState title={domain ? 'Couldn’t read your brand yet' : 'No store connected'} body={domain ? 'We couldn’t read enough from this site — try again shortly.' : 'Open this workspace from your ads audit and we’ll learn your brand automatically.'} cta="Retry" />
          : tab === 'visual' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card title="Your logo" sub="We use this across your creatives." action="Change">
                <div style={{ width: 110, height: 110, borderRadius: 12, border: `1px solid ${LINE}`, background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {data.logo /* eslint-disable-next-line @next/next/no-img-element */ && <img src={data.logo} alt="" style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
                </div>
              </Card>
              <Card title="Your visual world" sub="These images shape how we design for you." action="Add">
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12 }}>
                  {(data.visualPages || []).map((u, i) => (
                    <div key={i} style={{ aspectRatio: '4/3', borderRadius: 10, background: PAPER, border: `1px solid ${LINE}`, overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shotUrl(u)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Your visual language" sub={`${data.colors.length} colors · ${data.fonts.length} typefaces extracted from your brand`} action="Add">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {data.colors.map((c) => (
                    <div key={c.hex} style={{ width: 120, height: 120, borderRadius: 12, background: c.hex, border: `1px solid ${LINE}`, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 12 }}>
                      {c.primary && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: lum(c.hex) > 0.6 ? '#00000099' : '#ffffffaa' }}>PRIMARY</span>}
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: lum(c.hex) > 0.6 ? '#000000cc' : '#ffffffdd' }}>{c.hex.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
                {data.fonts.length > 0 && <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>{data.fonts.map((f) => <div key={f} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 18px' }}><div style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>Typeface</div><div style={{ fontSize: 20, fontWeight: 700 }}>{f}</div></div>)}</div>}
              </Card>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: isMobile ? 20 : 26 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>What we know about you{data.saved && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1f8f4e', background: '#e8f6ee', borderRadius: 100, padding: '2px 9px' }}>SAVED</span>}</div>
                    <div style={{ fontSize: 13, color: SUB, marginTop: 2 }}>{facts.length} things we’ve learned{data.saved ? ' — saved & feeding your Company Brain' : ' — sign in from your audit to save & edit'}</div>
                  </div>
                  {data.editable && <button onClick={addFact} disabled={busy} style={{ ...primaryBtn, padding: '8px 16px', fontSize: 13, borderRadius: 8, opacity: busy ? .6 : 1 }}>Add</button>}
                </div>
                <div style={{ marginTop: 18 }}>
                  {(showAll ? facts : facts.slice(0, 8)).map((f, i) => (
                    <div key={i} className="sf-fact" style={{ display: 'flex', gap: 12, padding: '14px 0', borderTop: i ? `1px solid ${LINE}` : 'none', fontSize: 14.5, color: '#37332c', lineHeight: 1.55, alignItems: 'flex-start' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 100, background: ORANGE, marginTop: 8, flex: 'none' }} />
                      <span style={{ flex: 1 }}>{f}</span>
                      {data.editable && (
                        <span className="sf-fact-actions" style={{ display: 'flex', gap: 10, flex: 'none', opacity: 0, transition: 'opacity .15s' }}>
                          <button onClick={() => editFact(i, f)} disabled={busy} title="Edit" style={{ border: 'none', background: 'none', cursor: 'pointer', color: SUB, fontSize: 15, padding: 0, lineHeight: 1 }}>✎</button>
                          <button onClick={() => delFact(i)} disabled={busy} title="Delete" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0392b', fontSize: 15, padding: 0, lineHeight: 1 }}>🗑</button>
                        </span>
                      )}
                    </div>
                  ))}
                  {facts.length > 8 && <button onClick={() => setShowAll((s) => !s)} style={{ marginTop: 14, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>{showAll ? 'Show less' : `Show all ${facts.length}`}</button>}
                </div>
              </div>
              {data.voice && (
                <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: isMobile ? 20 : 26 }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>This is how you sound</div><div style={{ fontSize: 13, color: SUB, marginTop: 2, marginBottom: 16 }}>Your brand voice and personality</div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12 }}>
                    {[['Tone', data.voice.tone], ['Energy', data.voice.energy], ['Audience', data.voice.audience]].map(([k, v]) => (
                      <div key={k} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}><div style={{ fontSize: 11, color: SUB, fontWeight: 700, background: PAPER, display: 'inline-block', borderRadius: 6, padding: '2px 8px', marginBottom: 8 }}>{k}</div><div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{v || '—'}</div></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
    </div>
  )
}
const lum = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; return 0.299 * r + 0.587 * g + 0.114 * b }
function Card({ title, sub, action, children }: { title: string; sub: string; action?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}><span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>{action && <button style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{action}</button>}</div>
      <div style={{ fontSize: 13.5, color: SUB, marginBottom: 16 }}>{sub}</div>
      {children}
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
