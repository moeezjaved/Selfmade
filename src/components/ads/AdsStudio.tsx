'use client'
/**
 * AdsStudio — the AI ads workspace (Lapis-style, our orange). Standalone at /ads-studio, NOT wired into
 * the live product nav yet (separate-from-prod while we build). Entry: the ads audit → this workspace,
 * pre-populated from the same crawl (products, brand, audiences, competitors). Phase 1 = shell + Home
 * (personalized templates) + section screens in our design language. Data wiring lands incrementally.
 */
import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { Monitor, Instagram as IgIcon, Facebook as FbIcon, Linkedin as LiIcon } from 'lucide-react'
import MelloAdsChat from '@/components/ads/MelloAdsChat'
import FacebookAdsCard from '@/components/brief/FacebookAdsCard'
import { useIsMobile } from '@/lib/useIsMobile'
import { celebrate, adReady, competitorsFound } from '@/lib/celebrate'

type StudioTag = { label: string; image?: string | null; kind: 'product' | 'upload' | 'element' | 'discover' | 'template' }
const StudioCtx = createContext<{ addToChat: (t: StudioTag) => void }>({ addToChat: () => {} })

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', LIME = '#ef4a1e', ORANGE = '#e02f06', PAPER = '#fbf4e2', CREAM = '#fbf7ef'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

type Key = 'home' | 'search' | 'ads' | 'competitors' | 'discover' | 'products' | 'calendar' | 'brand' | 'audiences' | 'google'
const NAV: { group: string | null; items: { key: Key; label: string; icon: string; locked?: boolean }[] }[] = [
  { group: null, items: [{ key: 'home', label: 'Home', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' }, { key: 'search', label: 'Search', icon: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 015 12' }, { key: 'ads', label: 'Your Ads', icon: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6' }] },
  { group: 'Insights', items: [{ key: 'competitors', label: 'My Competitors', icon: 'M9 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 7-5m6-4a3 3 0 100-6M22 20c0-3-3-5-7-5' }, { key: 'discover', label: 'Discover', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM16 8l-2 6-6 2 2-6z' }, { key: 'products', label: 'Products', icon: 'M6 7h12l1 13H5zM9 7a3 3 0 016 0' }] },
  { group: 'Tools', items: [{ key: 'calendar', label: 'Calendar', icon: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4' }, { key: 'brand', label: 'Brand Hub', icon: 'M12 2a10 10 0 100 20c1 0 2-1 2-2 0-2-2-2-1-4 1-1 3 0 4-1a5 5 0 00-5-13z' }, { key: 'audiences', label: 'Audiences', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 8v8M8 12h8' }, { key: 'google', label: 'Google Ads', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v12' }, { key: 'google', label: 'ChatGPT Ads', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20', locked: true }] },
]

const Icon = ({ d, size = 19 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>
)

export default function AdsStudio({ embedded = false, section, domainOverride }: { embedded?: boolean; section?: Key; domainOverride?: string } = {}) {
  const isMobile = useIsMobile()
  const [active, setActive] = useState<Key>(section || 'home')
  const [domain, setDomain] = useState((domainOverride || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim())
  const [chatTags, setChatTags] = useState<StudioTag[]>([])
  const addToChat = (t: StudioTag) => { setChatTags((x) => (x.some((y) => y.label === t.label && y.image === t.image) ? x : [...x, t])); setActive('home') }
  useEffect(() => { if (section) setActive(section) }, [section])
  useEffect(() => {
    if (domainOverride) return   // embedded in the app shell → domain comes from the active brand
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: SUB, textAlign: 'center' }}>⚡ 10 credits</div>
          <a href="/hire" style={{ ...primaryBtn, padding: '10px 12px', fontSize: 13, borderRadius: 12, textAlign: 'center', textDecoration: 'none', display: 'block' }}>Hire the team →</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 100, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>YO</div>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Your brand</div><div style={{ fontSize: 12, color: SUB }}>yourstore.com</div></div>
        </div>
      </div>
    </aside>
  )

  return (
    <StudioCtx.Provider value={{ addToChat }}>
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: embedded ? 'auto' : '100dvh', background: '#fff', fontFamily: SANS, color: INK }}>
      <style>{`@keyframes asFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes sfspin{to{transform:rotate(360deg)}}.sf-fact:hover .sf-fact-actions{opacity:1!important}.sf-thumb:hover .sf-disc-over{opacity:1!important}.sf-hrow{scrollbar-width:thin}.sf-hrow::-webkit-scrollbar{height:8px}.sf-hrow::-webkit-scrollbar-thumb{background:rgba(26,20,16,.14);border-radius:8px}.sf-hrow::-webkit-scrollbar-track{background:transparent}@keyframes sfShimmer{0%{background-position:150% center}100%{background-position:-150% center}}.sf-scroll-wrap:hover .sf-scroll-btn{opacity:1}`}</style>
      {!embedded && Sidebar}
      <main style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '24px 18px 60px' : '40px 44px 60px', animation: 'asFade .4s ease' }} key={active}>
          {active === 'home' ? <Home isMobile={isMobile} domain={domain} tags={chatTags} setTags={setChatTags} />
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
      </main>
    </div>
    </StudioCtx.Provider>
  )
}

const H1 = (isMobile: boolean): React.CSSProperties => ({ fontFamily: SERIF, fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.02em', margin: 0, color: INK })

/* Format-selector brand icons (Banner / WhatsApp / Instagram / Facebook / LinkedIn), like the reference. */
function FmtIcon({ fmt }: { fmt: AdFormat }) {
  if (fmt === 'WhatsApp') return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 004.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.18c-.25.7-1.44 1.33-1.99 1.36-.53.04-1.02.23-3.44-.72-2.9-1.14-4.75-4.1-4.9-4.29-.14-.19-1.17-1.56-1.17-2.98 0-1.42.75-2.12 1.01-2.41.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.65.5.25.6.85 2.07.92 2.22.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.72 1.18 1.54 1.91 1.06.94 1.95 1.24 2.23 1.38.28.14.44.12.6-.07.16-.19.69-.8.87-1.08.18-.28.36-.23.6-.14.25.09 1.58.75 1.85.89.28.14.46.21.53.32.07.12.07.68-.18 1.38z"/></svg>
  )
  const I = fmt === 'Banner Ad' ? Monitor : fmt === 'Instagram' ? IgIcon : fmt === 'Facebook' ? FbIcon : fmt === 'LinkedIn' ? LiIcon : null
  return I ? <I size={17} strokeWidth={2} /> : null
}
const primaryBtn: React.CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 20px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: SANS }

/* ── Home ───────────────────────────────────────────────────────────────── */
const ASPECTS = ['Auto', '1:1', '4:5', '9:16', '16:9']
const LANGS = ['English', 'Urdu', 'Hindi', 'Bengali', 'Arabic', 'Spanish', 'French', 'German', 'Portuguese', 'Indonesian']
const CHANNELS: AdFormat[] = ['Banner Ad', 'WhatsApp', 'Instagram', 'Facebook', 'LinkedIn']
type AdFormat = 'Banner Ad' | 'WhatsApp' | 'Instagram' | 'Facebook' | 'LinkedIn'
type PlanPick = { angle: string; caption: string; aspect: string; productImages: string[]; useCompose: boolean; refTags: string[]; baseProduct: string[]; colors: string[]; fonts?: { heading?: string | null; body?: string | null } }
type ChatMsg = { role: 'user' | 'assistant'; text?: string; image?: string | null; caption?: string; error?: string; loading?: boolean; format?: AdFormat; headlines?: string[]; pick?: PlanPick }
type HomeTag = StudioTag
type BrandKitLite = { siteName?: string; logo?: string | null; colors?: { hex: string }[]; fonts?: string[]; facts?: string[]; voice?: any }

function Home({ isMobile, domain, tags, setTags }: { isMobile: boolean; domain: string; tags: HomeTag[]; setTags: React.Dispatch<React.SetStateAction<HomeTag[]>> }) {
  const [kit, setKit] = useState<BrandKitLite | null>(null)
  const [products, setProducts] = useState<{ title: string; image: string | null }[]>([])
  const [format, setFormat] = useState<AdFormat>('Instagram')
  const [input, setInput] = useState('')
  const [aspect, setAspect] = useState('Auto')
  const [lang, setLang] = useState('English')
  const [open, setOpen] = useState<'' | 'aspect' | 'lang' | 'add'>('')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const focusComposer = () => setTimeout(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)

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

    // REMAKE / "Create Similar": a Discover/Competitor ad is attached → use the OLD STUDIO's proven clone
    // engine (reproduces the reference's exact winning layout with the user's product, then vision-verifies
    // and auto-regenerates). Same async path as the Discovery "Remake", so results are consistently good.
    const refAdRaw = tags.find((t) => t.kind === 'discover')?.image
    const hasElement = tags.some((t) => t.kind === 'element')
    if (refAdRaw && !hasElement) {
      try {
        const productImg = tags.find((t) => t.kind === 'product' || t.kind === 'upload')?.image || products.find((p) => p.image)?.image
        if (!productImg) throw new Error('no-product')
        const refAd = refAdRaw.startsWith('/') ? window.location.origin + refAdRaw : refAdRaw   // server fetch needs absolute
        const brandId = (document.cookie.match(/(?:^|; )sf_brand=([^;]+)/) || [])[1]
        const colors = (kit?.colors || []).map((c) => c.hex).slice(0, 4)
        // If the user typed their OWN instruction (beyond the auto-filled "Create an ad like this…"),
        // run it through the plan layer to IMPROVE it into a punchy headline, and bake it into the remake
        // — so typing something (e.g. "make it for Eid, 30% off") is honored, not ignored. No custom text
        // → pure clone (let the reference's own copy adapt to the product).
        const defaultMsg = `create an ad like this for ${(kit?.siteName || 'my product').toLowerCase()}`
        let newHeadline: string | undefined
        if (message && message.toLowerCase().trim() !== defaultMsg) {
          const plan = await fetch('/api/ads-studio/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, format: fmt, language: lang, siteName: kit?.siteName, facts: kit?.facts, voice: kit?.voice, productTitles: products.map((p) => p.title) }) }).then((r) => r.json()).catch(() => null)
          newHeadline = plan?.headline || undefined
        }
        const enq = await fetch('/api/discovery/clone-image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refImageUrl: refAd, productImages: [productImg], brandId: brandId ? decodeURIComponent(brandId) : undefined, brandName: kit?.siteName, colors, logo: kit?.logo || undefined, aspectRatio: aspect !== 'Auto' ? aspect : undefined, imageSize: '2K', newHeadline }),
        }).then((r) => r.json())
        if (!enq?.jobId) throw new Error(enq?.error === 'insufficient_credits' ? 'credits' : 'no-job')
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        const deadline = Date.now() + 6 * 60_000
        let settled = false
        while (Date.now() < deadline) {
          await sleep(2500)
          const s = await fetch(`/api/discovery/clone-image/status?id=${enq.jobId}`).then((r) => r.json()).catch(() => ({}))
          if (s.done && s.url) { setMsgs((m) => replaceLast(m, { role: 'assistant', image: s.url, caption: 'Remade from your reference — your product in their winning layout.', format: fmt })); celebrate(adReady()); settled = true; break }
          if (s.failed) { setMsgs((m) => replaceLast(m, { role: 'assistant', error: s.error || 'The remake failed — your credits were refunded. Try again.', format: fmt })); settled = true; break }
        }
        if (!settled) setMsgs((m) => replaceLast(m, { role: 'assistant', error: 'Still rendering — it’ll land in My Creatives shortly.', format: fmt }))
      } catch (e: any) {
        const msg = e?.message === 'no-product' ? 'Add a product first — tap + and pick one of your products.' : e?.message === 'credits' ? 'You’re out of credits — top up to remake ads.' : 'Couldn’t start the remake — try again.'
        setMsgs((m) => replaceLast(m, { role: 'assistant', error: msg, format: fmt }))
      }
      setTags([]); setBusy(false)
      return
    }

    try {
      const plan = await fetch('/api/ads-studio/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, format: fmt, language: lang, siteName: kit?.siteName, facts: kit?.facts, voice: kit?.voice, productTitles: products.map((p) => p.title) }) }).then((r) => r.json())
      // References: a product tag/upload IS the product; an element/discover/template is a person/style
      // reference to composite ALONGSIDE the product — so always keep the actual product in the mix
      // (e.g. "put Aura in her hand" needs both the doctor element AND the Aura product).
      const productTags = tags.filter((t) => t.kind === 'product' || t.kind === 'upload').map((t) => t.image).filter(Boolean) as string[]
      const refTags = tags.filter((t) => t.kind === 'element' || t.kind === 'discover' || t.kind === 'template').map((t) => t.image).filter(Boolean) as string[]
      const planned = plan.productIndex >= 0 ? products[plan.productIndex]?.image : products[0]?.image
      const baseProduct = productTags.length ? productTags : [planned].filter(Boolean) as string[]
      const productImages = Array.from(new Set([...baseProduct, ...refTags])).slice(0, 3)
      if (!productImages.length) throw new Error('no-product')
      const colors = (kit?.colors || []).map((c) => c.hex).slice(0, 4)
      const fonts = kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined
      const aspectRatio = aspect !== 'Auto' ? aspect : plan.aspect
      // Element tagged (a person) → /compose path (preserves identity + product). Else the studio engine.
      const useCompose = refTags.length > 0
      const pick: PlanPick = { angle: plan.angle, caption: plan.caption, aspect: aspectRatio, productImages, useCompose, refTags, baseProduct, colors, fonts }
      const headlines: string[] = Array.isArray(plan.headlines) && plan.headlines.length ? plan.headlines : (plan.headline ? [plan.headline] : [])
      // Higgsfield-style: offer the improved headline DIRECTIONS to pick from before spending a
      // generation. Multiple options → show the chooser; one (or none) → just generate.
      if (headlines.length > 1) {
        setMsgs((m) => replaceLast(m, { role: 'assistant', headlines, pick, format: fmt }))
        setTags([]); setBusy(false)
        return
      }
      await runGeneration(headlines[0] || plan.headline || message, pick, fmt)
      setTags([])
    } catch {
      setMsgs((m) => replaceLast(m, { role: 'assistant', error: 'Couldn’t generate — make sure your store has product images.', format: fmt }))
    } finally { setBusy(false) }
  }

  // The actual image generation for a chosen headline (used by both the direct path and the chooser).
  // The last chat message must already be a loading placeholder; this replaces it with the result.
  const runGeneration = async (headline: string, pick: PlanPick, fmt: AdFormat) => {
    const endpoint = pick.useCompose ? '/api/ads-studio/compose' : '/api/discovery/generate-ad'
    const reqBody = pick.useCompose
      ? JSON.stringify({ personImages: pick.refTags, productImages: pick.baseProduct, headline, angle: pick.angle, aspectRatio: pick.aspect, colors: pick.colors, fonts: pick.fonts, logo: kit?.logo || undefined, brandName: kit?.siteName })
      : JSON.stringify({ productImages: pick.productImages, newHeadline: headline, angle: pick.angle, aspectRatio: pick.aspect, colors: pick.colors, fonts: pick.fonts, logo: kit?.logo || undefined, imageSize: '2K' })
    let res: Response, d: any
    for (let attempt = 0; ; attempt++) {
      res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody })
      d = await res.json()
      if (res.ok || d.error !== 'pro_model_busy' || attempt >= 3) break
      await new Promise((r) => setTimeout(r, 5000))
    }
    if (!res.ok) {
      const err = d.error === 'insufficient_credits' ? 'You’re out of credits — top up to generate more ads.' : res.status === 401 ? 'Sign in from your ads audit to generate.' : d.error === 'pro_model_busy' ? 'The image model is busy right now — please try again in a moment.' : (d.error || 'Generation failed. Try again.')
      setMsgs((m) => replaceLast(m, { role: 'assistant', error: err, format: fmt }))
    } else {
      setMsgs((m) => replaceLast(m, { role: 'assistant', image: d.url || d.image || null, caption: pick.caption, format: fmt }))
      if (d.url || d.image) celebrate(adReady())
    }
  }

  // User picked one of the suggested headline directions → generate with it.
  const chooseHeadline = async (headline: string, pick: PlanPick, fmt: AdFormat) => {
    if (busy) return
    setBusy(true)
    setMsgs((m) => replaceLast(m, { role: 'assistant', loading: true, format: fmt }))
    try { await runGeneration(headline, pick, fmt) } catch { setMsgs((m) => replaceLast(m, { role: 'assistant', error: 'Couldn’t generate — try again.', format: fmt })) } finally { setBusy(false) }
  }
  const replaceLast = (m: ChatMsg[], next: ChatMsg) => { const c = [...m]; c[c.length - 1] = next; return c }

  // "Create Similar" (Discover/Competitor): attach the reference AND the user's main product AND pre-fill
  // the prompt — so the user just hits Generate. A remake is one click, not "now type something".
  const primeFromReference = (t: StudioTag) => {
    setTags((x) => {
      const next = x.some((y) => y.image === t.image) ? [...x] : [...x, t]
      const prod = products.find((p) => p.image)
      if (prod && !next.some((y) => y.kind === 'product' || y.kind === 'upload')) next.push({ label: prod.title.slice(0, 24), image: prod.image, kind: 'product' })
      return next
    })
    setInput(`Create an ad like this for ${kit?.siteName || 'my product'}`)
    focusComposer()
  }
  // Products row: attach the product + pre-fill, ready to generate in one click.
  const primeFromProduct = (t: StudioTag) => {
    setTags((x) => (x.some((y) => y.image === t.image) ? x : [...x, t]))
    setInput(`Make a scroll-stopping ${format} ad featuring ${t.label}`)
    focusComposer()
  }
  // Elements row (a person/scene reference): attach the element AND the user's product, pre-fill, ready.
  const primeFromElement = (e: { label: string; url: string }) => {
    setTags((x) => {
      const next = x.some((y) => y.image === e.url) ? [...x] : [...x, { label: e.label.slice(0, 24), image: e.url, kind: 'element' as const }]
      const prod = products.find((p) => p.image)
      if (prod && !next.some((y) => y.kind === 'product' || y.kind === 'upload')) next.push({ label: prod.title.slice(0, 24), image: prod.image, kind: 'product' })
      return next
    })
    setInput(`Create an ad with my product and this — for ${kit?.siteName || 'my brand'}`)
    focusComposer()
  }

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
    <div ref={composerRef} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 16, boxShadow: started ? 'none' : '0 20px 50px -34px rgba(0,0,0,.4)' }}>
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
      {!started && <div style={{ textAlign: 'center', paddingTop: isMobile ? 8 : 24 }}><h1 style={{ margin: 0, fontFamily: "'Playfair Display', 'Times New Roman', serif", fontWeight: 500, fontStyle: 'normal', fontSize: isMobile ? 42 : 58, lineHeight: 1.02, letterSpacing: '-0.03em', backgroundImage: 'linear-gradient(100deg, #1a1410 44%, #d8b088 50%, #1a1410 56%)', backgroundSize: '320% auto', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', animation: 'sfShimmer 2.2s ease-out .15s 1 both' }}>Start with an idea</h1></div>}

      {/* format selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', margin: started ? '0 0 16px' : '28px 0 18px' }}>
        {CHANNELS.map((c) => {
          const on = format === c
          return <button key={c} onClick={() => setFormat(c)} style={{ border: `1px solid ${on ? ORANGE : LINE}`, background: on ? '#fdeee9' : '#fff', color: on ? ORANGE : INK, borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: SANS, display: 'flex', alignItems: 'center', gap: 8 }}><FmtIcon fmt={c} />{c}</button>
        })}
      </div>

      {/* conversation — prompts + status are full-width; generated ads render as a row of uniform,
          same-size result cards (like the reference), wrapping onto the next line as more are made. */}
      {started && (
        <div style={{ display: 'flex', flexWrap: 'wrap', flexDirection: 'row', gap: 16, marginBottom: 18, alignItems: 'flex-start' }}>
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ maxWidth: '78%', background: '#fdeee9', color: INK, borderRadius: '16px 16px 4px 16px', padding: '11px 15px', fontSize: 14.5 }}>{m.text}</div>
            </div>
          ) : m.headlines && m.pick ? (
            <div key={i} style={{ flexBasis: '100%', border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 16, maxWidth: 560 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 4 }}>Pick a headline direction ✨</div>
              <div style={{ fontSize: 12.5, color: SUB, marginBottom: 12 }}>I improved your idea into 3 directions — tap one and I’ll build the ad.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.headlines.map((h, hi) => (
                  <button key={hi} onClick={() => chooseHeadline(h, m.pick!, m.format || format)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '11px 14px', fontSize: 14, fontWeight: 600, color: INK, cursor: busy ? 'default' : 'pointer', fontFamily: SANS }}>
                    <span style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', background: '#fdeee9', color: ORANGE, fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{hi + 1}</span>
                    “{h}”
                  </button>
                ))}
              </div>
            </div>
          ) : m.loading ? (
            <div key={i} style={{ flexBasis: '100%', padding: '4px 0' }}><GeneratingCard format={m.format || 'ad'} /></div>
          ) : m.error ? (
            <div key={i} style={{ flexBasis: '100%', border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 16px', fontSize: 14, color: '#b23', background: '#fff5f2', maxWidth: 420 }}>{m.error}</div>
          ) : (
            <div key={i} style={{ width: 236, flex: 'none', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
              <div className="sf-thumb" style={{ aspectRatio: '4 / 5', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {m.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={m.image} alt="" referrerPolicy="no-referrer" className="sf-thumb-img contain" />}
              </div>
              <div style={{ padding: 11 }}>
                {m.caption && <div style={{ fontSize: 12, color: '#43403a', lineHeight: 1.4, marginBottom: 9, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.caption}</div>}
                {/* Route R2 URLs through /api/download (forces an attachment header) so it saves the file
                    in place instead of opening the image in a new tab; data: URLs download directly. */}
                {m.image && <a href={m.image.startsWith('http') ? `/api/download?url=${encodeURIComponent(m.image)}&name=selfmade-ad.png` : m.image} download="selfmade-ad.png" style={{ ...primaryBtn, display: 'inline-block', padding: '6px 13px', fontSize: 12, borderRadius: 8, textDecoration: 'none' }}>Download</a>}
              </div>
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

      {!started && <PersonalizedTemplates isMobile={isMobile} domain={domain} kit={kit} products={products} onUse={(t) => { setTags((x) => [...x, { label: t.title.slice(0, 24), image: t.image, kind: 'template' }]); send(`Make a ${t.title} for my brand`) }} />}
      {!started && <HomeDiscoverRow onTag={primeFromReference} />}
      {!started && <HomeProductsRow products={products} onTag={primeFromProduct} />}
      {!started && <HomeCompetitorsRow domain={domain} onTag={primeFromReference} />}
      {!started && <ElementsRow isMobile={isMobile} domain={domain} onUse={primeFromElement} />}
    </div>
  )
}

/** A CSS-rendered ad template card (our generic templates, brand-fillable). */
/** ChatGPT-style staged progress while a single (long) generation runs — a shimmer result card + a
 *  checklist that advances on a timer, so a 30-60s render feels alive instead of a frozen spinner. */
function GeneratingCard({ format }: { format: string }) {
  const stages = ['Reading your brand kit', 'Writing the concept & headline', 'Designing the layout', `Rendering your ${format} ad in high-res`, 'Polishing the details']
  const [s, setS] = useState(0)
  useEffect(() => { const t = setInterval(() => setS((x) => Math.min(x + 1, stages.length - 1)), 6500); return () => clearInterval(t) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ width: 236, flex: 'none', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
        <div style={{ aspectRatio: '4 / 5', backgroundImage: 'linear-gradient(100deg, #f1ece4 30%, #fbf9f5 50%, #f1ece4 70%)', backgroundSize: '220% 100%', animation: 'sfShimmer 1.5s ease-in-out infinite' }} />
      </div>
      <div style={{ paddingTop: 6, minWidth: 210 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 800, color: INK, marginBottom: 14 }}>
          <span style={{ width: 15, height: 15, border: `2px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .7s linear infinite' }} />
          Mello is designing your {format} ad
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((st, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: i === s ? 700 : 500, color: i <= s ? INK : SUB, opacity: i <= s ? 1 : 0.5, transition: 'opacity .3s, color .3s' }}>
              <span style={{ width: 16, height: 16, flex: 'none', borderRadius: '50%', border: `1.5px solid ${i <= s ? ORANGE : LINE}`, background: i < s ? ORANGE : '#fff', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {i < s ? '✓' : i === s ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE }} /> : ''}
              </span>
              {st}{i === s ? '…' : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

type Template = { title: string; concept: string; image?: string | null; headline?: string; angle?: string; generating?: boolean; failed?: boolean }
function PersonalizedTemplates({ isMobile, domain, kit, products, onUse }: { isMobile: boolean; domain: string; kit: BrandKitLite | null; products: { title: string; image: string | null }[]; onUse: (t: { title: string; image?: string | null }) => void }) {
  const [tpls, setTpls] = useState<Template[] | null>(null)
  const [canGen, setCanGen] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!domain) return
    let on = true
    fetch(`/api/ads-studio/templates?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => { if (!on) return; setTpls(Array.isArray(d.templates) ? d.templates : []); setCanGen(!!d.canGenerate) }).catch(() => on && setTpls([]))
    return () => { on = false }
  }, [domain])

  const withImg = products.filter((p) => p.image)
  const hero = withImg[0]?.image ?? undefined
  // Pick the product each template's brief is actually about (its title/headline/concept name it), so a
  // Product Showcase and a Sale Campaign can feature different products — not always the first one.
  // Falls back to the store's main (first) product with an image.
  const productFor = (i: number): string | undefined => {
    const t = tpls?.[i]
    if (!t || withImg.length <= 1) return hero
    const text = `${t.title} ${t.headline || ''} ${t.angle || ''}`.toLowerCase()
    let best: { image: string | null; score: number } | null = null
    for (const p of withImg) {
      const words = (p.title || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 4)
      const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0)
      if (score > 0 && (!best || score > best.score)) best = { image: p.image, score }
    }
    return best?.image ?? hero
  }
  const genBody = (i: number, force = false) => { const prod = productFor(i); return { domain, index: i, force, productImages: prod ? [prod] : [], colors: (kit?.colors || []).map((c) => c.hex), fonts: kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined, logo: kit?.logo || undefined, brandName: kit?.siteName, productDesc: (kit?.facts || [])[0] } }
  const genOne = async (i: number, force = false) => {
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: true, failed: false } : x))
    // The server now rotates across the Gemini key pool, so one POST usually succeeds; we still retry a
    // couple of times to ride out a busy stretch, then surface a tap-to-retry state (never spin forever).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await fetch('/api/ads-studio/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody(i, force)) }).then((r) => r.json())
        if (d.image) { setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, image: d.image, generating: false, failed: false } : x)); return }
      } catch { /* retry */ }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000))   // busy → wait, then retry
    }
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: false, failed: true } : x))
  }

  // Progressively generate the missing template images — FREE (wow factor), 2 at a time.
  // We generate WITHOUT requiring a product hero image: many templates are graphic/brand-led, and
  // renderAdFree works from brand colours/logo alone — gating on a product photo left stores with no
  // scraped product images stuck on blank cards forever.
  useEffect(() => {
    if (started.current || !tpls || !canGen || !kit) return
    const todo = tpls.map((t, i) => ({ t, i })).filter(({ t }) => !t.image)
    if (!todo.length) return
    started.current = true
    let cursor = 0
    const worker = async () => { while (cursor < todo.length) { await genOne(todo[cursor++].i) } }
    worker(); worker()   // concurrency 2
  }, [tpls, canGen, kit, products, domain])

  if (tpls !== null && tpls.length === 0) return null
  return (
    <div style={{ marginTop: 48 }}>
      <HScroll gap={16} titleSize={isMobile ? 24 : 30} title="Personalized templates" sub="Ad concepts generated from your Brand Kit — free. Tap one and Mello builds it in the chat.">
        {(tpls || Array.from({ length: 6 }, () => null)).map((t, i) => (
          <div key={i} onClick={() => t && !t.generating && !t.failed && onUse({ title: t.title, image: t.image })} style={{ position: 'relative', width: 250, flex: 'none', textAlign: 'left', border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden', cursor: t && !t.generating && !t.failed ? 'pointer' : 'default', fontFamily: SANS }}>
            {/* Title on top, like the reference — no description below. */}
            <div style={{ padding: '11px 14px 9px', fontSize: 14, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t?.title || '…'}</div>
            <div className="sf-thumb" style={{ aspectRatio: '4/5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: 10, position: 'relative' }}>
              {t?.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={t.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" />
              ) : t?.generating ? (
                <>
                  <span style={{ width: 26, height: 26, border: `3px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .8s linear infinite' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>Generating…</span>
                </>
              ) : t?.failed ? (
                <button onClick={(e) => { e.stopPropagation(); genOne(i) }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS, padding: 16 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#fdeee9', color: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>↻</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Tap to retry</span>
                  <span style={{ fontSize: 11, color: SUB }}>Image engine was busy</span>
                </button>
              ) : null}
              {t?.image && !t.generating && (
                <button className="sf-disc-over" onClick={(e) => { e.stopPropagation(); genOne(i, true) }} title="Regenerate" style={{ position: 'absolute', top: 8, right: 8, opacity: 0, transition: 'opacity .15s', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 100, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>↻ Regenerate</button>
              )}
            </div>
          </div>
        ))}
      </HScroll>
    </div>
  )
}

type ElementItem = { id: string; label: string; url: string }
function ElementsRow({ isMobile, domain, onUse }: { isMobile: boolean; domain: string; onUse: (e: ElementItem) => void }) {
  const [els, setEls] = useState<ElementItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!domain) return
    let on = true
    fetch(`/api/ads-studio/elements?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setEls(Array.isArray(d.elements) ? d.elements : [])).catch(() => on && setEls([]))
    return () => { on = false }
  }, [domain])
  const add = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy(true)
      try {
        const d = await fetch('/api/ads-studio/elements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain, label: f.name.replace(/\.[^.]+$/, '').slice(0, 30), dataUrl: String(reader.result) }) }).then((r) => r.json())
        if (Array.isArray(d.elements)) setEls(d.elements)
        else if (d.error) alert(d.error)
      } finally { setBusy(false) }
    }
    reader.readAsDataURL(f)
  }
  const del = async (id: string) => { const d = await fetch('/api/ads-studio/elements', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain, id }) }).then((r) => r.json()).catch(() => null); if (d && Array.isArray(d.elements)) setEls(d.elements) }
  if (els === null) return null
  return (
    <div style={{ marginTop: 40 }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={add} style={{ display: 'none' }} />
      <HScroll gap={12} titleSize={isMobile ? 22 : 26} title="Elements" sub="People & props to drop into your creative. Add a face or scene, then tag it in the chat.">
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ width: 124, height: 124, flex: 'none', border: `1.5px dashed ${LINE}`, borderRadius: 12, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: SUB, fontFamily: SANS }}>
          {busy ? <span style={{ width: 18, height: 18, border: `2px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .7s linear infinite' }} /> : <span style={{ fontSize: 22 }}>＋</span>}
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>{busy ? 'Adding…' : 'Add element'}</span>
        </button>
        {els.map((e) => (
          <div key={e.id} className="sf-thumb" style={{ position: 'relative', width: 124, height: 124, flex: 'none', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onUse(e)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.url} alt={e.label} loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" />
            <div className="sf-disc-over" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,0) 55%)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 7, opacity: 0, transition: 'opacity .15s' }}>
              <button onClick={(ev) => { ev.stopPropagation(); del(e.id) }} title="Remove" style={{ alignSelf: 'flex-end', border: 'none', background: 'rgba(0,0,0,.5)', color: '#fff', borderRadius: 100, width: 22, height: 22, cursor: 'pointer', fontSize: 13 }}>×</button>
              <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.label}</div>
            </div>
          </div>
        ))}
      </HScroll>
    </div>
  )
}

/* ── Horizontal scroll row with side arrow buttons (appear on hover), Lapis-style ── */
function HScroll({ children, gap = 14, title, sub, titleSize = 24 }: { children: React.ReactNode; gap?: number; title?: string; sub?: React.ReactNode; titleSize?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: false })
  const update = () => { const el = ref.current; if (!el) return; setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 }) }
  useEffect(() => { update(); const el = ref.current; if (!el) return; const ro = new ResizeObserver(update); ro.observe(el); return () => ro.disconnect() }, [])
  const go = (dir: number) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.85), behavior: 'smooth' })
  const arrow = (side: 'left' | 'right'): React.CSSProperties => ({ position: 'absolute', top: '50%', [side]: -8, transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,.16)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, lineHeight: 1, color: INK, zIndex: 4, opacity: 0, transition: 'opacity .15s', fontFamily: SANS })
  // Lapis-style header arrows (‹ ›) at the top-right of the section — always visible, greyed at the edges.
  const hdrArrow = (disabled: boolean): React.CSSProperties => ({ width: 34, height: 34, borderRadius: '50%', border: `1px solid ${LINE}`, background: '#fff', cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1, color: disabled ? '#cfcabf' : INK, opacity: disabled ? 0.55 : 1, fontFamily: SANS, flex: 'none', padding: 0 })
  return (
    <div>
      {title && (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: titleSize, fontWeight: 700, margin: '0 0 4px' }}>{title}</h2>
            {sub && <p style={{ color: SUB, fontSize: 14, margin: 0 }}>{sub}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
            <button onClick={() => go(-1)} disabled={edge.start} style={hdrArrow(edge.start)} aria-label="Scroll left">‹</button>
            <button onClick={() => go(1)} disabled={edge.end} style={hdrArrow(edge.end)} aria-label="Scroll right">›</button>
          </div>
        </div>
      )}
      <div className="sf-scroll-wrap" style={{ position: 'relative' }}>
        <div ref={ref} className="sf-hrow" onScroll={update} style={{ display: 'flex', gap, overflowX: 'auto', paddingBottom: 8 }}>{children}</div>
        {!edge.start && <button className="sf-scroll-btn" onClick={() => go(-1)} style={arrow('left')} aria-label="Scroll left">‹</button>}
        {!edge.end && <button className="sf-scroll-btn" onClick={() => go(1)} style={arrow('right')} aria-label="Scroll right">›</button>}
      </div>
    </div>
  )
}

/* ── Home carousels (single-line, Lapis-style): Discover · Products · Competitor ads ── */
function HomeCarousel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 44 }}>
      <HScroll title={title} sub={sub}>{children}</HScroll>
    </div>
  )
}

const overlayBtn = { position: 'absolute' as const, inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,.55), rgba(0,0,0,0) 45%)', display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-end', padding: 9, opacity: 0, transition: 'opacity .15s' }

function HomeDiscoverRow({ onTag }: { onTag: (t: StudioTag) => void }) {
  const [ads, setAds] = useState<DiscoverAd[] | null>(null)
  // Image ads only for now (video comes later) — drop any video-format creatives.
  useEffect(() => { let on = true; fetch('/api/ads-studio/discover?limit=40').then((r) => r.json()).then((d) => on && setAds((Array.isArray(d.ads) ? d.ads : []).filter((a: DiscoverAd) => !/video/i.test(a.format || '')))).catch(() => on && setAds([])); return () => { on = false } }, [])
  if (ads && ads.length === 0) return null
  return (
    <HomeCarousel title="Discover" sub="Trending creative from the community — tap Create Similar and Mello builds your version.">
      {(ads || Array.from({ length: 6 }, () => null)).map((a, i) => a ? (
        <div key={a.id} className="sf-thumb" style={{ position: 'relative', width: 212, flex: 'none', overflow: 'hidden', minHeight: 140 }}>
          {a.thumb /* eslint-disable-next-line @next/next/no-img-element */ && <img src={a.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-nat" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
          <div className="sf-disc-over" style={overlayBtn}>
            <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, marginBottom: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.brand}</div>
            <button onClick={() => onTag({ label: `Like ${a.brand}`.slice(0, 24), image: a.thumb, kind: 'discover' })} style={{ ...primaryBtn, padding: '6px 10px', fontSize: 11.5, borderRadius: 8, width: '100%' }}>✦ Create Similar</button>
          </div>
        </div>
      ) : <div key={i} style={{ width: 212, flex: 'none', aspectRatio: '4/5', borderRadius: 12, background: PAPER }} />)}
    </HomeCarousel>
  )
}

function HomeProductsRow({ products, onTag }: { products: { title: string; image: string | null }[]; onTag: (t: StudioTag) => void }) {
  if (!products.length) return null
  return (
    <HomeCarousel title="Products" sub="Straight from your store — tap one to build an ad around it.">
      {products.slice(0, 24).map((p, i) => (
        <button key={i} onClick={() => onTag({ label: p.title.slice(0, 24), image: p.image, kind: 'product' })} style={{ width: 150, flex: 'none', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', background: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: SANS, padding: 0 }}>
          <div className="sf-thumb" style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{p.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" />}</div>
          <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
        </button>
      ))}
    </HomeCarousel>
  )
}

function HomeCompetitorsRow({ domain, onTag }: { domain: string; onTag: (t: StudioTag) => void }) {
  const [ads, setAds] = useState<{ thumb: string; brand: string }[] | null>(null)
  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        // SAVED competitors only (the brands you've spied) — no fresh discovery scan. Same source as
        // the Brand-Spy "Feed": /api/follows (spied) → /api/discovery/db-search recent per brand.
        const c = (document.cookie.match(/(?:^|; )sf_brand=([^;]+)/) || [])[1]
        const qs = new URLSearchParams({ spied: '1' }); if (c) qs.set('brand', decodeURIComponent(c))
        const f = await fetch(`/api/follows?${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        const pageIds: string[] = Array.isArray(f?.pageIds) ? f.pageIds.map(String) : []
        const seen = new Set<string>()
        if (pageIds.length) {
          const perBrand = await Promise.all(pageIds.slice(0, 8).map((pid) =>
            fetch(`/api/discovery/db-search?q=${encodeURIComponent(pid)}&mode=brand&pageId=${encodeURIComponent(pid)}&sort=recent&country=ALL`).then((r) => r.json()).catch(() => ({}))
          ))
          // Image ads only for now (video later): keep creatives whose asset_type isn't video.
          const flat = perBrand.flatMap((j: any) => (j.ads || j.results || []) as any[])
            .map((a: any) => { const cr = a.creatives?.[0]; const thumb = cr && cr.asset_type !== 'video' ? cr.r2_url : ''; return { thumb: thumb as string, brand: (a.pageName || a.pageId) as string } })
            .filter((x) => x.thumb && !seen.has(x.thumb) && seen.add(x.thumb))
            .slice(0, 24)
          if (flat.length) { if (on) setAds(flat); return }
        }
        // Not spying anyone (or they had no image ads) → discover rivals from the user's website and
        // show THEIR live ads, so the section is never empty once we know the store.
        if (domain) {
          const d = await fetch(`/api/ads-studio/competitors?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).catch(() => null)
          const comps = Array.isArray(d?.competitors) ? d.competitors : []
          const flat2 = comps.flatMap((cc: any) => (Array.isArray(cc.ads) ? cc.ads : []).map((a: any) => ({ thumb: a.thumb as string, brand: cc.name as string })))
            .filter((x: any) => x.thumb && !seen.has(x.thumb) && seen.add(x.thumb))
            .slice(0, 24)
          if (on) setAds(flat2)
          return
        }
        if (on) setAds([])
      } catch { if (on) setAds([]) }
    })()
    return () => { on = false }
  }, [])
  if (ads !== null && ads.length === 0) return null
  return (
    <HomeCarousel title="Competitor ads" sub="The newest ads from the competitors you're spying — tap Create Similar to make your own.">
      {(ads || Array.from({ length: 6 }, () => null)).map((a, i) => a ? (
        <div key={i} className="sf-thumb" style={{ position: 'relative', width: 212, flex: 'none', overflow: 'hidden', minHeight: 140 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-nat" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />
          <div className="sf-disc-over" style={overlayBtn}>
            <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 700, marginBottom: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.brand}</div>
            <button onClick={() => onTag({ label: `Like ${a.brand}`.slice(0, 24), image: a.thumb, kind: 'discover' })} style={{ ...primaryBtn, padding: '6px 10px', fontSize: 11.5, borderRadius: 8, width: '100%' }}>✦ Create Similar</button>
          </div>
        </div>
      ) : <div key={i} style={{ width: 212, flex: 'none', aspectRatio: '4/5', borderRadius: 12, background: PAPER }} />)}
    </HomeCarousel>
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
type OwnAd = { adId: string; title: string; body: string; isActive: boolean; image: string | null; link: string; isVideo: boolean }
function YourAds({ isMobile }: { isMobile: boolean }) {
  const { addToChat } = useContext(StudioCtx)
  const [data, setData] = useState<{ ads: OwnAd[]; pageId: string | null; connected?: boolean } | null>(null)
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  const load = () => fetch('/api/ads-studio/your-ads').then((r) => r.json()).then(setData).catch(() => setData({ ads: [], pageId: null }))
  useEffect(() => { load() }, [])
  const save = async () => {
    if (!link.trim() || saving) return
    setSaving(true)
    try {
      const d = await fetch('/api/ads-studio/your-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: link.trim() }) }).then((r) => r.json())
      if (d.pageId) { setData(null); await load() } else if (d.error) alert(d.error)
    } finally { setSaving(false) }
  }

  const connected = !!(data?.connected || data?.pageId)
  return (
    <div>
      <Header title="Your Ads" isMobile={isMobile} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 18 }}>{connected ? 'Your live Facebook ads — and Mello runs them for you. Just tell it what to do.' : 'Connect Facebook and Mello runs your ads for you — create, launch, scale, pause, all by typing.'}</div>

      {/* Run your ads by chatting — templates + guided launch. Only when connected. */}
      {connected && <div style={{ marginBottom: 22 }}><MelloAdsChat /></div>}

      {data === null ? (
        <div style={{ color: SUB, textAlign: 'center', padding: '48px 0' }}><span style={{ display: 'inline-block', width: 28, height: 28, border: `3px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .8s linear infinite' }} /></div>
      ) : !connected ? (
        // ── Not connected → one clean "Connect your Facebook" card (layperson-friendly, Ad-Studio style) ──
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 20, background: '#fff', padding: isMobile ? '32px 22px' : '48px 40px', textAlign: 'center', maxWidth: 560, margin: '10px auto 0', boxShadow: '0 30px 70px -50px rgba(0,0,0,.4)' }}>
          <div style={{ width: 56, height: 56, borderRadius: 15, background: '#1877F2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}><FbIcon size={30} color="#fff" /></div>
          <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, marginBottom: 10 }}>Connect your Facebook</div>
          <div style={{ color: SUB, fontSize: 15, lineHeight: 1.55, marginBottom: 22, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>Link your ad account once, and Mello shows every campaign here — then you run them just by typing: <i>“scale my best ad”, “pause the slow one”, “launch this creative”.</i></div>
          <a href="/connect/meta" style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', padding: '13px 26px', fontSize: 15 }}><FbIcon size={17} /> Connect Facebook →</a>
          <div style={{ marginTop: 14, fontSize: 12.5, color: SUB }}>Takes a minute · you approve every change · nothing spends without your OK</div>
        </div>
      ) : (
        // ── Connected → the live campaign STATS panel (spend · ROAS · top ads), same source as the brief. ──
        <FacebookAdsCard initial={{ accounts: [] } as any} ctaHref="/reports" ctaLabel="See the full report" />
      )}
    </div>
  )
}

/* ── My Competitors (real ad-DNA data) ──────────────────────────────────── */
type CompAd = { id: string; thumb: string | null; copy: string; format: string | null; active: boolean }
type CompDna = { hooks: string[]; angles: string[]; personas: string[] }
type Comp = { source: 'discovered' | 'spied'; pageId?: string | null; domain?: string | null; name: string; reason?: string; hasAdDna: boolean; adsSource?: 'corpus' | 'live' | null; spyable: boolean; adCount: number; ads: CompAd[]; dna: CompDna | null; checked?: boolean }
type CompSeed = { name: string; category: string; market: string; productForms?: string[]; queries: string[] } | null
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
              <div className="sf-thumb" style={{ aspectRatio: '4 / 5', position: 'relative' }}>
                {a.thumb /* eslint-disable-next-line @next/next/no-img-element */ && <img src={a.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
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

/* ── Brands you're spying (followed brands from Brand Spy) — shown atop My Competitors ── */
type SpiedBrand = { pageId: string; name: string; active: number | null; inactive: number | null; adCount: number }
function SpiedBrands() {
  const [brands, setBrands] = useState<SpiedBrand[] | null>(null)
  useEffect(() => {
    let on = true
    const c = (document.cookie.match(/(?:^|; )sf_brand=([^;]+)/) || [])[1]
    const p = new URLSearchParams({ scope: 'mine' }); if (c) p.set('brand', decodeURIComponent(c))
    fetch(`/api/discovery/brand-spy?${p}`).then((r) => r.json()).then((d) => { if (on) setBrands(Array.isArray(d.brands) ? d.brands : []) }).catch(() => on && setBrands([]))
    return () => { on = false }
  }, [])
  const stop = async (pageId: string) => {
    setBrands((prev) => (prev || []).filter((x) => x.pageId !== pageId))
    await fetch(`/api/discovery/brand-spy?pageId=${encodeURIComponent(pageId)}`, { method: 'DELETE' }).catch(() => {})
  }
  if (!brands || brands.length === 0) return null
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>Brands you&rsquo;re spying</span>
        <span style={{ fontSize: 12, color: SUB }}>{brands.length} tracked · live from the Meta Ad Library</span>
      </div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
        {brands.map((b, i) => (
          <div key={b.pageId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: INK, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.pageId}</div>
            <div style={{ fontSize: 12.5, color: SUB, flex: 'none' }}>{b.active != null ? <><b style={{ color: ORANGE }}>{b.active.toLocaleString()}</b> active · {(b.inactive ?? 0).toLocaleString()} inactive</> : `${(b.adCount || 0).toLocaleString()} ads`}</div>
            <a href={`/discovery/brand-spy/${b.pageId}`} style={{ fontSize: 12, fontWeight: 800, color: ORANGE, background: '#fdeee9', padding: '5px 12px', borderRadius: 999, textDecoration: 'none', flex: 'none' }}>Open &rarr;</a>
            <button onClick={() => stop(b.pageId)} title="Stop spying" style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', background: 'rgba(185,28,28,0.07)', border: 'none', padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: SANS, flex: 'none' }}>Stop</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Competitors({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [comps, setComps] = useState<Comp[] | null>(null)
  const [seed, setSeed] = useState<CompSeed>(null)
  const [q, setQ] = useState('')
  const [step, setStep] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let on = true
    setComps(null); setStep(0)
    const tick = setInterval(() => on && setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 11000)
    fetch(`/api/ads-studio/competitors${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`).then((r) => r.json()).then((d) => { if (!on) return; setComps(Array.isArray(d.competitors) ? d.competitors : []); setSeed(d.seed || null) }).catch(() => on && setComps([]))
    return () => { on = false; clearInterval(tick) }
  }, [domain])

  // Force a fresh discovery pass (bypasses the per-brand cache) — used after a brand adds products, so
  // the search re-runs across ALL current product lines instead of the cached single-line result.
  const refresh = async () => {
    if (!domain || refreshing) return
    setRefreshing(true); setComps(null); setStep(0)
    try {
      const d = await fetch(`/api/ads-studio/competitors?domain=${encodeURIComponent(domain)}&force=1`).then((r) => r.json())
      const found = Array.isArray(d.competitors) ? d.competitors : []
      setComps(found); setSeed(d.seed || null)
      if (found.length) celebrate(competitorsFound(found.length))
    } catch { setComps([]) }
    setRefreshing(false)
  }

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
      <Header title="My Competitors" isMobile={isMobile} action="+ Spy new brand" onAction={() => { window.location.href = '/discovery/brand-spy' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginTop: -8, marginBottom: 14 }}>
        <div style={{ color: SUB, fontSize: 14, flex: 1 }}>
          We found your real rivals{seed?.category ? <> in <b style={{ color: INK }}>{seed.category}</b></> : ''}{seed?.market ? <> — {seed.market}</> : ''} across the web <b style={{ color: INK }}>and the Meta Ad Library</b>, then pulled their <b style={{ color: INK }}>live ads &amp; ad strategy</b>.
          {seed?.productForms && seed.productForms.length > 1 && (
            <span> Searched across <b style={{ color: INK }}>{seed.productForms.length} product lines</b>: {seed.productForms.join(', ')}.</span>
          )}
        </div>
        <button
          onClick={refresh} disabled={refreshing || !domain} title="Re-run discovery across all your current products"
          style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: refreshing || !domain ? 'default' : 'pointer', fontFamily: SANS, opacity: refreshing || !domain ? 0.6 : 1 }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'sfspin .8s linear infinite' : undefined }}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}>
        <Icon d="M11 4a7 7 0 105 12l4 4" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search competitors…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: INK, fontFamily: SANS }} />
      </div>

      <SpiedBrands />

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
        domain ? (
          <div style={{ border: `1px dashed ${LINE}`, borderRadius: 18, background: '#fff', padding: 40, textAlign: 'center', marginTop: 22 }}>
            <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No competitors found yet</div>
            <div style={{ color: SUB, fontSize: 14.5, lineHeight: 1.5, maxWidth: 460, margin: '0 auto 18px' }}>We couldn’t auto-discover rivals for this store. Add one and we’ll pull their live ads.</div>
            <button style={primaryBtn}>Add a competitor</button>
          </div>
        ) : <AddWebsite label="Add your site and we’ll auto-find your real rivals and their live ads." />
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

/* ── Discover (trending ad creatives from our library → Create Similar into chat) ── */
type DiscoverAd = { id: string; brand: string; thumb: string | null; copy: string; format: string }
function Discover({ isMobile }: { isMobile: boolean }) {
  const { addToChat } = useContext(StudioCtx)
  const [ads, setAds] = useState<DiscoverAd[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let on = true
    fetch('/api/ads-studio/discover?limit=24').then((r) => r.json()).then((d) => on && setAds(Array.isArray(d.ads) ? d.ads : [])).catch(() => on && setAds([]))
    return () => { on = false }
  }, [])
  const shown = (ads || []).filter((a) => !q.trim() || a.brand.toLowerCase().includes(q.trim().toLowerCase()) || a.copy.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div>
      <Header title="Discover" isMobile={isMobile} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 14 }}>Trending creative from across the community — hit <b style={{ color: INK }}>Create Similar</b> and Mello builds your version in the chat.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}>
        <Icon d="M11 4a7 7 0 105 12l4 4" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ads by brand, product, style…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: INK, fontFamily: SANS }} />
      </div>
      {ads === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Loading trending ads…</div>
        : shown.length === 0 ? <EmptyState title="Nothing to show yet" body="We couldn’t load trending ads right now — try again shortly." cta="Retry" />
          : (
            // Masonry columns so every ad shows in FULL (no crop) at its natural aspect, filling the
            // column width with no whitespace — the Lapis browse-feed look.
            <div style={{ columnCount: isMobile ? 2 : 4, columnGap: 14, marginTop: 20 }}>
              {shown.map((a) => (
                <div key={a.id} className="sf-thumb" style={{ position: 'relative', overflow: 'hidden', marginBottom: 14, breakInside: 'avoid' }}>
                  {a.thumb /* eslint-disable-next-line @next/next/no-img-element */ && <img src={a.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-nat" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
                  <div className="sf-disc-over" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,.55), rgba(0,0,0,0) 45%)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 10, opacity: 0, transition: 'opacity .15s' }}>
                    <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.brand}</div>
                    <button onClick={() => addToChat({ label: `Like ${a.brand}`.slice(0, 24), image: a.thumb, kind: 'discover' })} style={{ ...primaryBtn, padding: '7px 12px', fontSize: 12, borderRadius: 8, width: '100%' }}>✦ Create Similar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ── Products (real catalog from the store) ─────────────────────────────── */
type StoreProduct = { title: string; image: string | null; price: string | null; url: string }
function Products({ isMobile, domain, hideHeader }: { isMobile: boolean; domain: string; hideHeader?: boolean }) {
  const { addToChat } = useContext(StudioCtx)
  const [data, setData] = useState<{ products: StoreProduct[]; siteName: string } | null>(null)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const useSelected = () => { (data?.products || []).filter((p) => sel[p.url]).forEach((p) => addToChat({ label: p.title.slice(0, 24), image: p.image, kind: 'product' })) }
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
      {hideHeader
        ? (selCount ? <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button style={{ ...primaryBtn, whiteSpace: 'nowrap' }} onClick={useSelected}>Use in chat ({selCount})</button></div> : null)
        : <Header title="Products" isMobile={isMobile} action={selCount ? `Use in chat (${selCount})` : 'Import from Website'} onAction={selCount ? useSelected : undefined} />}
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 14 }}>{domain ? `Detected from ${domain} — select products to generate ads for.` : 'Connect a store to detect your products.'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}>
        <Icon d="M11 4a7 7 0 105 12l4 4" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: INK, fontFamily: SANS }} />
      </div>
      {data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your catalog…</div>
        : products.length === 0 ? (domain ? <EmptyState title="No products found" body="We couldn’t read products from this site — check the URL or try again." cta="Retry" /> : <AddWebsite label="Add your site and we’ll pull your products automatically." />)
          : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 14, marginTop: 20 }}>
              {products.map((p, i) => {
                const on = !!sel[p.url]
                return (
                  <div key={p.url + i} onClick={() => setSel((s) => ({ ...s, [p.url]: !s[p.url] }))} style={{ border: `1px solid ${on ? ORANGE : LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden', cursor: 'pointer', boxShadow: on ? `0 0 0 2px ${ORANGE}22` : 'none' }}>
                    <div className="sf-thumb" style={{ aspectRatio: '1', position: 'relative' }}>
                      {p.image /* eslint-disable-next-line @next/next/no-img-element */ && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />}
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
function Audiences({ isMobile, domain, hideHeader }: { isMobile: boolean; domain: string; hideHeader?: boolean }) {
  const [data, setData] = useState<{ market: string; audiences: Aud[]; signals: string[] } | null>(null)
  useEffect(() => {
    if (!domain) { setData({ market: '', audiences: [], signals: [] }); return }
    let on = true; setData(null)
    fetch(`/api/ads-studio/audiences?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((d) => on && setData({ market: d.market || '', audiences: Array.isArray(d.audiences) ? d.audiences : [], signals: Array.isArray(d.signals) ? d.signals : [] })).catch(() => on && setData({ market: '', audiences: [], signals: [] }))
    return () => { on = false }
  }, [domain])
  return (
    <div>
      {!hideHeader && <Header title="Audiences" isMobile={isMobile} action="Add Audience" />}
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 8 }}>We read your store’s real signals to identify who actually buys — each audience drives its own ads.</div>
      {data?.market && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ffe7df', color: ORANGE, borderRadius: 100, padding: '6px 14px', fontSize: 13, fontWeight: 800, marginBottom: 18 }}>📍 Detected market: {data.market}</div>}
      {data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your store & building audiences…</div>
        : data.audiences.length === 0 ? (domain ? <EmptyState title="Couldn’t build audiences yet" body="We couldn’t read enough from this site — try again in a moment." cta="Retry" /> : <AddWebsite label="Add your site and we’ll work out who actually buys from you." />)
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
function EmptyState({ title, body, cta, onCta }: { title: string; body: string; cta: string; onCta?: () => void }) {
  return (
    <div style={{ border: `1px dashed ${LINE}`, borderRadius: 18, background: '#fff', padding: 40, textAlign: 'center', marginTop: 22 }}>
      <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ color: SUB, fontSize: 14.5, lineHeight: 1.5, maxWidth: 460, margin: '0 auto 18px' }}>{body}</div>
      <button style={primaryBtn} onClick={onCta}>{cta}</button>
    </div>
  )
}

/* ── Brand Kit (derived from the website — no Shopify needed) ────────────── */
type BrandKitData = { siteName: string; logo: string | null; colors: { hex: string; primary: boolean }[]; fonts: string[]; facts: string[]; voice: { tone: string; energy: string; audience: string } | null; visualPages: string[]; empty?: boolean; saved?: boolean; editable?: boolean }
/** Website capture — shown when the active brand has no site yet (e.g. created via Shopify connect), so
 * the studio can learn brand/products/audiences/rivals from the site. Saving reloads with the domain set. */
function AddWebsite({ label }: { label?: string }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const d = v.trim(); if (!d || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/ads-studio/brand-website', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ website: d }) }).then((x) => x.json())
      if (r.website) window.location.reload()
      else { alert(r.error || 'Could not save that website'); setBusy(false) }
    } catch { setBusy(false) }
  }
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', padding: '38px 28px', margin: '22px auto 0', textAlign: 'center', maxWidth: 540 }}>
      <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>What&rsquo;s your website?</div>
      <div style={{ color: SUB, fontSize: 14.5, lineHeight: 1.5, marginBottom: 18 }}>{label || 'Add your site and we’ll learn your brand, products, audiences and competitors from it — automatically. No Shopify needed.'}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="yourstore.com" autoComplete="off" spellCheck={false} style={{ flex: 1, minWidth: 200, border: `1px solid ${LINE}`, borderRadius: 100, padding: '13px 18px', fontSize: 15, outline: 'none', fontFamily: SANS, color: INK }} />
        <button onClick={save} disabled={busy || !v.trim()} style={{ ...primaryBtn, opacity: busy || !v.trim() ? 0.6 : 1 }}>{busy ? 'Learning…' : 'Learn my brand →'}</button>
      </div>
    </div>
  )
}

const BRANDKIT_TABS = { visual: 'Visual Brand Kit', knowledge: 'Knowledge Base', products: 'Products', audiences: 'Audiences' } as const
function BrandKit({ isMobile, domain }: { isMobile: boolean; domain: string }) {
  const [tab, setTab] = useState<'visual' | 'knowledge' | 'products' | 'audiences'>('visual')
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
      <Header title="Brand Hub" isMobile={isMobile} />
      <div style={{ color: SUB, fontSize: 14, marginTop: -8, marginBottom: 18 }}>Everything we know about your brand from {domain || 'your site'} — identity, knowledge, products &amp; audiences. No setup, no Shopify needed.</div>
      <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${LINE}`, marginBottom: 22, flexWrap: 'wrap' }}>
        {(['visual', 'knowledge', 'products', 'audiences'] as const).map((t) => <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 2px', fontSize: 15, fontWeight: 700, color: tab === t ? INK : SUB, borderBottom: tab === t ? `2px solid ${ORANGE}` : '2px solid transparent', background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS }}>{BRANDKIT_TABS[t]}</button>)}
      </div>

      {tab === 'products' ? <Products isMobile={isMobile} domain={domain} hideHeader />
        : tab === 'audiences' ? <Audiences isMobile={isMobile} domain={domain} hideHeader />
        : data === null ? <div style={{ color: SUB, textAlign: 'center', padding: '40px 0' }}>Reading your brand from the site…</div>
        : data.empty ? (domain ? <EmptyState title="Couldn’t read your brand yet" body="We couldn’t read enough from this site — try again shortly." cta="Retry" /> : <AddWebsite />)
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
                    <div key={i} className="sf-thumb" style={{ aspectRatio: '4/3', overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shotUrl(u)} alt="" loading="lazy" referrerPolicy="no-referrer" className="sf-thumb-img" style={{ objectPosition: 'top' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />
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
function Header({ title, isMobile, action, onAction }: { title: string; isMobile: boolean; action?: string; onAction?: () => void }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}><h1 style={H1(isMobile)}>{title}</h1>{action && <button onClick={onAction} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>{action}</button>}</div>
}
function SearchBar({ placeholder }: { placeholder: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 14, padding: '14px 18px' }}><Icon d="M11 4a7 7 0 105 12l4 4" size={18} /><span style={{ color: SUB, fontSize: 15 }}>{placeholder}</span></div>
}
