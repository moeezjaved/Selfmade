'use client'
/**
 * Onboarding — competitor-first setup, in the light wizard style (matches the Remake wizard):
 *   1. Your brand    — physical / app / service + paste URL → detect-product builds the brand kit.
 *   2. What you sell — niche chips (competitor-suggestion seed + benchmarking).
 *   3. Competitors   — pick up to 3 (search 4.3M crawled brands + the 605K directory);
 *                      on continue we fire crawlOnly express pulls + follow each brand.
 *   4. Where ads come from — the 3 remake sources (Discovery / Chrome extension / Assets) while
 *                      the pulls stream in live.
 *   5. Make your first ad — each competitor's top image + top video, remade with the user's product.
 * Finish → user_profiles.onboarding_completed = true → /discovery (or My Creatives if they cloned).
 *
 * NOTE: presentation only was reskinned from the old dark survey. Every handler / API call / effect
 * below is unchanged; step 1 additionally captures brand_type + a one-line description so the first
 * ad's copy is grounded (esp. for app/service brands).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import CloneModal from '@/app/(dashboard)/discovery/CloneModal'
import CloneVideoModal from '@/app/(dashboard)/discovery/CloneVideoModal'
import RadarSearch from '@/components/motion/RadarSearch'
import HoverScrubVideo from '@/components/discovery/HoverScrubVideo'

// ── Light theme tokens (same palette as the Remake wizard) ──
const SHELL = '#f6f8f5', CARD = '#ffffff', INK = '#161c17', MUTED = '#68756b', FAINT = '#94a096'
const LINE = '#e7ece7', FOREST = '#17251c', LIME = '#dffe95', SELBG = '#f4fbe6', SELBORDER = '#a8cf6f'
const SELTEXT = '#2c4a1f', GREEN = '#3f8f4f'

const STEPS = [
  { t: 'Your brand', s: 'Logo, colors & what you do' },
  { t: 'What you sell', s: 'Pick your category' },
  { t: 'Your competitors', s: 'Choose up to 3 to spy on' },
  { t: 'Where ads come from', s: 'Three sources, one click' },
  { t: 'Make your first ad', s: 'On us' },
]
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/selfmade-save-ads/eekbcgdoonpmhoojoaggpfmfgcplaefi'
const NICHES = ['Beauty & Skincare', 'Supplements', 'Apparel & Fashion', 'Fitness', 'Home & Kitchen', 'Pets', 'Baby & Kids', 'Electronics', 'SaaS', 'Jewelry']
const PROMOS: { key: 'physical' | 'app' | 'service'; icon: string; title: string; desc: string }[] = [
  { key: 'physical', icon: '🧴', title: 'A physical product', desc: 'Something you ship — a bottle, box, gadget, apparel.' },
  { key: 'app', icon: '📱', title: 'An app or website', desc: 'Software, a SaaS tool, or an online platform.' },
  { key: 'service', icon: '🛠️', title: 'A service', desc: 'You do something for people — agency, coaching, salon, clinic.' },
]

type Kit = { brandName?: string; logo?: string | null; colors?: string[]; productImages?: string[] }
type BrandPick = { pageId: string; name: string; picture: string | null; adCount: number | string }

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1 — store
  const [url, setUrl] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [kit, setKit] = useState<Kit | null>(null)
  const [storeName, setStoreName] = useState('')
  const [detectErr, setDetectErr] = useState('')
  // Brand type + one-line description — what powers the FIRST ad's quality (esp. app/service copy).
  const [promo, setPromo] = useState<'physical' | 'app' | 'service'>('physical')
  const [brandDesc, setBrandDesc] = useState('')
  const isService = promo !== 'physical'

  // Step 2 — niche
  const [niche, setNiche] = useState('')

  // Step 3 — competitors
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<BrandPick[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<BrandPick[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Manual add — for a competitor not in our list (paste their Meta Ad Library / Facebook link).
  const [showManual, setShowManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualLink, setManualLink] = useState('')
  const [manualErr, setManualErr] = useState('')

  // Step 4 — pulls
  const [pullCounts, setPullCounts] = useState<Record<string, number>>({})
  const pullsFiredRef = useRef(false)

  // Step 5 — clone your first ad. Per competitor: their top-performing image + video ad.
  type TopAd = { id: string; pageId: string; pageName: string; thumbnailUrl: string | null; videoUrl: string | null; format: string | null; performanceScore?: number | null }
  const [topAds, setTopAds] = useState<Record<string, { image?: TopAd; video?: TopAd }>>({})
  const [loadingAds, setLoadingAds] = useState(false)
  const adsLoadedRef = useRef(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [costs, setCosts] = useState<{ image: number; video: number }>({ image: 100, video: 600 })
  const [cloneImageAd, setCloneImageAd] = useState<TopAd | null>(null)
  const [cloneVideoAd, setCloneVideoAd] = useState<TopAd | null>(null)
  const [videoBuyFor, setVideoBuyFor] = useState<TopAd | null>(null)
  const [buying, setBuying] = useState(false)
  const [showCloneIntro, setShowCloneIntro] = useState(false)   // "how the clone works" explainer (once)
  const cloneIntroShownRef = useRef(false)
  const [cloned, setCloned] = useState<Set<string>>(new Set())  // ad ids the user has kicked off a clone for

  // ── Step 1: detect the store ──
  const detect = async () => {
    const u = url.trim()
    if (!u) return
    setDetecting(true); setDetectErr('')
    try {
      const r = await fetch('/api/discovery/detect-product', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: u.startsWith('http') ? u : `https://${u}` }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not read that site')
      // Service/app brands: use the site's own imagery (screenshots/hero), never Shopify product shots.
      const svcImgs = (d.images || []).filter((x: string) => !(d.productImages || []).includes(x))
      const k: Kit = {
        brandName: d.brandName, logo: d.logo || null, colors: d.colors || [],
        productImages: (isService ? svcImgs : (d.productImages?.length ? d.productImages : d.images)) || [],
      }
      setKit(k); setStoreName(d.brandName || '')
    } catch (e: any) {
      setDetectErr('Could not read that site — you can still continue and add your brand later.')
    } finally { setDetecting(false) }
  }

  // Save the detected brand when leaving step 1 (best-effort — a brand-cap 402 must not block onboarding).
  // Guarded so back/forward or re-onboarding never creates duplicate brands with the same name.
  const brandSavedRef = useRef(false)
  const saveBrand = async () => {
    if (!kit || brandSavedRef.current) return
    brandSavedRef.current = true
    const name = (storeName || kit.brandName || 'My brand').slice(0, 60)
    try {
      const existing = await fetch('/api/brands').then((r) => r.json()).catch(() => ({ brands: [] }))
      if ((existing.brands || []).some((b: any) => (b.name || '').trim().toLowerCase() === name.trim().toLowerCase())) return  // already have it
      await fetch('/api/brands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          website: url.trim(),
          description: brandDesc.trim() || null,
          brand_type: isService ? 'service' : 'physical',
          product_images: (kit.productImages || []).slice(0, 6),
          brand_kit: { colors: kit.colors || [], logo: kit.logo || null, category: promo },
        }),
      })
    } catch { /* best-effort */ }
  }

  // ── Step 3: brand search (crawled pages + 605K directory, merged like the Discovery bar) ──
  useEffect(() => {
    const term = search.trim()
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (term.length < 2) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const [pagesData, dirData] = await Promise.all([
          fetch(`/api/discovery/pages?q=${encodeURIComponent(term)}`).then(r => r.json()).catch(() => ({ pages: [] })),
          fetch(`/api/discovery/brands?q=${encodeURIComponent(term)}`).then(r => r.json()).catch(() => ({ brands: [] })),
        ])
        const crawled = (pagesData.pages || []) as any[]
        const seen = new Set(crawled.map((p) => String(p.pageId)))
        const dir = ((dirData.brands || []) as any[])
          .filter((b) => !seen.has(String(b.pageId)))
          .map((b) => ({ pageId: b.pageId, name: b.name, picture: b.avatar || null, adCount: b.adCount || '—' }))
        setResults([...crawled.map((p) => ({ pageId: p.pageId, name: p.name, picture: p.picture || null, adCount: p.adCount || 0 })), ...dir].slice(0, 8))
      } catch { setResults([]) } finally { setSearching(false) }
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search])

  const togglePick = (b: BrandPick) => setPicked((prev) => {
    if (prev.some((p) => p.pageId === b.pageId)) return prev.filter((p) => p.pageId !== b.pageId)
    if (prev.length >= 3) return prev
    return [...prev, b]
  })

  // Pull the numeric Meta page-id out of a pasted link (Ad Library / page URL) or accept a raw id.
  const extractPageId = (s: string): string | null => {
    const t = s.trim()
    const m = t.match(/view_all_page_id=(\d+)/) || t.match(/page_id=(\d+)/) || t.match(/facebook\.com\/(\d{6,})/) || t.match(/^(\d{6,})$/)
    return m ? m[1] : null
  }
  const addManual = () => {
    setManualErr('')
    const id = extractPageId(manualLink)
    if (!id) { setManualErr('Paste their Meta Ad Library link (it contains the page ID) or the numeric page ID.'); return }
    if (picked.length >= 3) { setManualErr('You can pick up to 3.'); return }
    if (picked.some((p) => p.pageId === id)) { setManualErr('Already added.'); return }
    setPicked((prev) => [...prev, { pageId: id, name: manualName.trim() || `Brand ${id.slice(-4)}`, picture: null, adCount: '—' }])
    setManualName(''); setManualLink(''); setShowManual(false)
  }

  // ── Fire the express pulls + follows when entering step 4 (once) ──
  const firePulls = async () => {
    if (pullsFiredRef.current) return
    pullsFiredRef.current = true
    await Promise.allSettled(picked.flatMap((b) => [
      fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: b.pageId, name: b.name, crawlOnly: true }) }),
      fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: b.pageId, brandName: b.name, action: 'toggle' }) }),
    ]))
  }

  // ── Step 5: load each competitor's top image + top video ad (performance-ranked) + the balance ──
  const loadTopAds = async () => {
    if (adsLoadedRef.current) return
    adsLoadedRef.current = true
    setLoadingAds(true)
    try {
      const bal = await fetch('/api/credits/balance').then((r) => r.json())
      if (typeof bal?.balance === 'number') setBalance(bal.balance)
      const img = bal?.pricing?.image_clone_pro?.credits, vid = bal?.pricing?.video_clone?.credits
      setCosts({ image: img || 100, video: vid || 600 })
    } catch { /* defaults stand */ }
    await Promise.all(picked.map(async (b) => {
      const pick = async (format: string): Promise<TopAd | undefined> => {
        try {
          const j = await fetch(`/api/discovery/db-search?q=${encodeURIComponent(b.pageId)}&mode=brand&pageId=${encodeURIComponent(b.pageId)}&format=${format}&sort=performance&status=ALL`).then((r) => r.json())
          const a = (j?.ads || []).find((x: any) => (format === 'Video' ? x.videoUrl || x.format === 'Video' : x.thumbnailUrl))
          return a ? { id: a.id, pageId: a.pageId, pageName: a.pageName || b.name, thumbnailUrl: a.thumbnailUrl, videoUrl: a.videoUrl, format: a.format, performanceScore: a.performanceScore } : undefined
        } catch { return undefined }
      }
      const [image, video] = await Promise.all([pick('Image'), pick('Video')])
      setTopAds((prev) => ({ ...prev, [b.pageId]: { image, video } }))
    }))
    setLoadingAds(false)
  }

  // Open the remake wizard. We DON'T mark "cloned" on open — only when a generation actually starts
  // (via the modal's onGenerated), so closing without creating never sends the user to an empty My Creatives.
  const openImageClone = (ad: TopAd) => setCloneImageAd(ad)
  const onVideoClick = (ad: TopAd) => {
    if (balance !== null && balance < costs.video) { setVideoBuyFor(ad); return }  // low credit → offer the pack
    setCloneVideoAd(ad)
  }
  const buyLaunchPack = async () => {
    setBuying(true)
    try {
      const r = await fetch('/api/billing/topup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: 'launch' }) })
      const d = await r.json()
      if (d?.url) window.open(d.url, '_blank')
    } catch { /* noop */ } finally { setBuying(false) }
  }
  const subscribeCreator = async () => {
    setBuying(true)
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'starter', cycle: 'monthly' }) })
      const d = await r.json()
      if (d?.url) window.open(d.url, '_blank')
    } catch { /* noop */ } finally { setBuying(false) }
  }
  useEffect(() => {
    if (!videoBuyFor) return
    const t = setInterval(async () => {
      try {
        const bal = await fetch('/api/credits/balance').then((r) => r.json())
        if (typeof bal?.balance === 'number') {
          setBalance(bal.balance)
          if (bal.balance >= costs.video) {
            const ad = videoBuyFor
            setVideoBuyFor(null)
            setCloneVideoAd(ad)  // straight into the clone; cloned is marked on real generation via onGenerated
          }
        }
      } catch { /* keep polling */ }
    }, 4000)
    return () => clearInterval(t)
  }, [videoBuyFor, costs.video])

  // Live pull progress — poll each picked brand's catalog total while on step 4.
  useEffect(() => {
    if (step !== 3 || picked.length === 0) return
    const t = setInterval(async () => {
      await Promise.all(picked.map(async (b) => {
        try {
          const j = await fetch(`/api/discovery/brand-spy/${b.pageId}`).then((r) => r.json())
          const total = j?.summary?.total || 0
          if (total > 0) setPullCounts((prev) => (prev[b.pageId] === total ? prev : { ...prev, [b.pageId]: total }))
        } catch { /* keep polling */ }
      }))
    }, 5000)
    return () => clearInterval(t)
  }, [step, picked])

  const finish = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    await supabase.from('user_profiles').update({ niche: niche || null, onboarding_completed: true }).eq('user_id', user.id)
    if (cloned.size > 0) router.push('/creative-studio')
    else router.push(picked[0] ? `/discovery/brand-spy/${picked[0].pageId}` : '/discovery')
  }

  const seeAllAds = async (pageId: string) => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from('user_profiles').update({ niche: niche || null, onboarding_completed: true }).eq('user_id', user.id)
    } catch { /* best-effort */ }
    router.push(`/discovery/brand-spy/${pageId}`)
  }

  const skipAll = async () => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from('user_profiles').update({ onboarding_completed: true }).eq('user_id', user.id)
    } catch { /* best-effort */ }
    router.push('/discovery')
  }

  const next = async () => {
    if (step === 0 && kit) saveBrand()               // fire-and-forget
    if (step === 2) firePulls()                       // pulls stream while they read step 4
    if (step === 3) {                                 // entering the clone step
      loadTopAds()                                    // fetch each competitor's top ads
      if (!cloneIntroShownRef.current) { cloneIntroShownRef.current = true; setShowCloneIntro(true) }  // "how it works" once
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const canNext = [true, true, picked.length > 0, true, true][step]  // steps 1-2 skippable; ≥1 competitor to advance

  // ── shared styles ──
  const input: React.CSSProperties = { width: '100%', background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit' }
  const chip = (on: boolean): React.CSSProperties => ({
    background: on ? SELBG : '#fff', border: `1.5px solid ${on ? SELBORDER : LINE}`, color: on ? SELTEXT : '#3c473e',
    borderRadius: 100, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  })
  const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: FOREST, color: LIME, border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }
  const btnGhost: React.CSSProperties = { background: '#fff', border: `1.5px solid ${LINE}`, color: '#3c473e', borderRadius: 12, padding: '11px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
  const kicker: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: GREEN, marginBottom: 10 }
  const h2: React.CSSProperties = { fontSize: 27, fontWeight: 800, color: INK, letterSpacing: '-.025em', lineHeight: 1.14, marginBottom: 10 }
  const lead: React.CSSProperties = { fontSize: 14, color: MUTED, lineHeight: 1.6, marginBottom: 20, maxWidth: 600 }
  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#3c473e', marginBottom: 6 }

  return (
    <div style={{ minHeight: '100vh', background: SHELL, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '26px 18px 60px' }}>
      <div style={{ width: '100%', maxWidth: 1240, background: CARD, border: `1px solid ${LINE}`, borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 90px rgba(23,37,28,.16), 0 2px 8px rgba(23,37,28,.05)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px', borderBottom: `1px solid ${LINE}`, background: 'linear-gradient(100deg,#eef7e2 0%,#f2f6ff 55%,#fdf1f6 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', color: INK }}><span style={{ color: GREEN }}>✦</span> Welcome to Selfmade — let’s set you up</div>
          <button onClick={skipAll} style={{ fontSize: 12.5, color: FAINT, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Skip for now ›</button>
        </div>

        <div style={{ display: 'flex', minHeight: 640 }}>
          {/* Rail */}
          <aside className="ob-rail" style={{ width: 288, flexShrink: 0, borderRight: `1px solid ${LINE}`, padding: '26px 18px', background: '#fbfcfa', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: FAINT, textTransform: 'uppercase', margin: '2px 6px 14px' }}>5 quick steps · ~2 minutes</div>
            {STEPS.map((s, i) => {
              const active = i === step, done = i < step
              return (
                <div key={s.t} onClick={() => { if (i <= step) setStep(i) }}
                  style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 12px', borderRadius: 14, cursor: i <= step ? 'pointer' : 'default', border: `1.5px solid ${active ? LINE : 'transparent'}`, background: active ? '#fff' : 'transparent', boxShadow: active ? '0 2px 10px rgba(23,37,28,.05)' : 'none' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, background: active ? FOREST : done ? SELBG : '#eef1ed', color: active ? LIME : done ? GREEN : FAINT, border: done ? '1.5px solid #d8ebb9' : 'none' }}>{done ? '✓' : i + 1}</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? INK : MUTED }}>{s.t}</div>
                    <div style={{ fontSize: 11.5, color: FAINT, marginTop: 1, lineHeight: 1.35 }}>{s.s}</div>
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop: 'auto', padding: '14px 8px 2px', borderTop: `1px solid ${LINE}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>Why we ask</div>
              <div style={{ fontSize: 11.5, color: FAINT, lineHeight: 1.5, marginTop: 3 }}>Everything here powers your remakes — your logo &amp; colors go on every ad, and your competitors feed you winning ideas daily.</div>
            </div>
          </aside>

          {/* Main */}
          <main className="ob-main" style={{ flex: 1, padding: '36px 44px 26px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={kicker}>Step {step + 1} of {STEPS.length}</div>

            {/* ── Step 1: Your brand ── */}
            {step === 0 && <>
              <h2 style={h2}>First, your brand — paste your link and we do the rest</h2>
              <p style={lead}>We grab your <b style={{ color: INK }}>logo, brand colors and product photos</b> automatically, so every ad we make already looks like yours. No design work, ever.</p>

              <div style={{ marginBottom: 14 }}>
                <label style={fieldLabel}>What are you promoting?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PROMOS.map((o) => {
                    const on = promo === o.key
                    return (
                      <button key={o.key} type="button" onClick={() => { setPromo(o.key); setKit(null) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer', border: on ? `2px solid ${SELBORDER}` : `1.5px solid ${LINE}`, background: on ? SELBG : '#fff', fontFamily: 'inherit' }}>
                        <span style={{ fontSize: 21, flexShrink: 0 }}>{o.icon}</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 750, color: on ? SELTEXT : INK }}>{o.title}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>
                        </span>
                        {on && <span style={{ color: GREEN, fontWeight: 900 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {isService && (
                <div style={{ marginBottom: 14 }}>
                  <label style={fieldLabel}>What does it do? <i style={{ fontStyle: 'normal', fontWeight: 500, color: FAINT }}>· one line — your first ad’s words come from this</i></label>
                  <input style={input} placeholder={promo === 'app' ? 'e.g. AI platform that finds winning Facebook ads and remakes them for your brand' : 'e.g. Meta-ads agency for DTC skincare brands'} value={brandDesc} onChange={(e) => setBrandDesc(e.target.value)} />
                </div>
              )}

              <div style={{ marginBottom: 6 }}>
                <label style={fieldLabel}>Your website {isService && <i style={{ fontStyle: 'normal', fontWeight: 500, color: FAINT }}>· optional — for your logo, colors &amp; screenshots</i>}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...input, flex: 1 }} placeholder="yourstore.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} />
                  <button onClick={detect} disabled={detecting || !url.trim()} style={{ ...btnGhost, whiteSpace: 'nowrap', opacity: detecting || !url.trim() ? 0.55 : 1 }}>{detecting ? 'Reading…' : '🔗 Detect'}</button>
                </div>
              </div>
              {detectErr && <div style={{ marginTop: 8, fontSize: 12.5, color: '#b45309' }}>{detectErr}</div>}
              {kit && (
                <div style={{ marginTop: 14, background: SELBG, border: '1px solid #d8ebb9', borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: SELTEXT, marginBottom: 10 }}>🎨 Found your brand kit — used on every ad</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: (kit.productImages || []).length ? 12 : 0 }}>
                    {kit.logo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={kit.logo} alt="" style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'contain', background: '#fff', border: `1px solid ${LINE}` }} />
                      : <div style={{ width: 38, height: 38, borderRadius: 9, background: FOREST, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16 }}>{(storeName || '?')[0]?.toUpperCase()}</div>}
                    <input value={storeName} onChange={(e) => setStoreName(e.target.value)} style={{ ...input, padding: '8px 11px', fontWeight: 700, flex: 1 }} />
                    {(kit.colors || []).slice(0, 4).map((c) => <span key={c} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />)}
                  </div>
                  {(kit.productImages || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                      {(kit.productImages || []).slice(0, 6).map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p} src={p} alt="" style={{ width: 58, height: 58, borderRadius: 9, objectFit: 'cover', flexShrink: 0, border: `1px solid ${LINE}` }} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12.5, color: FAINT }}>No website yet? Just press <b style={{ color: SELTEXT }}>Next</b> — you can add it later.</div>
                <button onClick={next} style={btnPrimary}>Next →</button>
              </div>
            </>}

            {/* ── Step 2: Niche ── */}
            {step === 1 && <>
              <h2 style={h2}>What do you sell?</h2>
              <p style={lead}>One tap. We use this to show you <b style={{ color: INK }}>winning ads from your world</b> — not random ones — and to suggest the right competitors.</p>
              <input style={input} placeholder="e.g. Women’s activewear, hair supplements…" value={niche} onChange={(e) => setNiche(e.target.value)} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {NICHES.map((n) => <button key={n} onClick={() => setNiche(n)} style={chip(niche === n)}>{n}</button>)}
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12.5, color: FAINT }}>Not sure? Pick the closest — you can change it anytime.</div>
                <div style={{ display: 'flex', gap: 9 }}><button onClick={() => setStep(0)} style={btnGhost}>← Back</button><button onClick={next} style={btnPrimary}>Next →</button></div>
              </div>
            </>}

            {/* ── Step 3: Competitors ── */}
            {step === 2 && <>
              <h2 style={h2}>Pick up to 3 competitors to spy on</h2>
              <p style={lead}>We watch them <b style={{ color: INK }}>24/7</b> — every new ad they launch, which ones are winning, and what you should remake next. Search any brand in the world.</p>
              <input style={input} placeholder={`Search 4.3M ads & 600K brands… ${niche ? `try “${niche.split(' ')[0].toLowerCase()}”` : 'e.g. Gymshark, Hims, AG1'}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              {searching && <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED }}>Searching…</div>}
              {results.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 280, overflowY: 'auto' }}>
                  {results.map((b) => {
                    const on = picked.some((p) => p.pageId === b.pageId)
                    return (
                      <button key={b.pageId} onClick={() => togglePick(b)} style={{ display: 'flex', alignItems: 'center', gap: 11, background: on ? SELBG : '#fff', border: on ? `2px solid ${SELBORDER}` : `1.5px solid ${LINE}`, borderRadius: 13, padding: '10px 13px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
                        {b.picture
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={b.picture} alt="" style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
                          : <span style={{ width: 34, height: 34, borderRadius: 9, background: '#eef1ed', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{b.name[0]?.toUpperCase()}</span>}
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', color: INK, fontSize: 13.5, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: FAINT }}>{typeof b.adCount === 'number' && b.adCount > 0 ? `${b.adCount} ads on Meta right now` : 'in our directory'}</span>
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 800, background: on ? SELBG : '#fff', color: on ? SELTEXT : FAINT, border: `1px solid ${on ? '#d8ebb9' : LINE}`, borderRadius: 100, padding: '3px 10px', flexShrink: 0 }}>{on ? '✓ Spying' : '+ Spy'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {picked.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {picked.map((b) => (
                    <span key={b.pageId} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: SELBG, border: `1px solid ${SELBORDER}`, color: SELTEXT, borderRadius: 100, padding: '6px 12px', fontSize: 13, fontWeight: 700 }}>
                      {b.name}
                      <button onClick={() => togglePick(b)} style={{ background: 'none', border: 'none', color: SELTEXT, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Manual add — competitor not in our list. */}
              <div style={{ marginTop: 16 }}>
                {!showManual ? (
                  <button onClick={() => setShowManual(true)} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 13, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    + Can’t find them? Add a competitor manually
                  </button>
                ) : (
                  <div style={{ background: '#fbfcfa', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Add a competitor manually</div>
                    <input style={{ ...input, marginBottom: 8 }} placeholder="Brand name (e.g. Nike)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                    <input style={input} placeholder="Their Meta Ad Library link, or page ID" value={manualLink} onChange={(e) => setManualLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
                    <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Open their <a href="https://www.facebook.com/ads/library" target="_blank" rel="noreferrer" style={{ color: GREEN }}>Ad Library</a> page and paste the URL — it has the page ID.</div>
                    {manualErr && <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>{manualErr}</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={addManual} style={{ ...btnPrimary, padding: '9px 18px' }}>Add</button>
                      <button onClick={() => { setShowManual(false); setManualErr('') }} style={btnGhost}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12.5, color: FAINT }}><b style={{ color: SELTEXT }}>{picked.length}/3 picked.</b> Can’t find one? Paste their Facebook link above.</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  <button onClick={() => setStep(1)} style={btnGhost}>← Back</button>
                  <button onClick={next} disabled={!canNext} style={{ ...btnPrimary, opacity: canNext ? 1 : 0.4, cursor: canNext ? 'pointer' : 'not-allowed' }}>{picked.length > 0 ? `Pull ${picked.length} brand${picked.length > 1 ? 's' : ''} →` : 'Pick a competitor'}</button>
                </div>
              </div>
            </>}

            {/* ── Step 4: Remake sources + live pulls ── */}
            {step === 3 && <>
              <h2 style={h2}>Great ads to remake come from three places</h2>
              <p style={lead}>Any ad you can see, you can remake with your product. While you read this, we’re already <b style={{ color: INK }}>pulling your competitors’ ads</b> in the background.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: '🔎', title: 'Discovery — 4.3M live ads', desc: <>Search every live Meta ad in the world. See one you love? Hover it → <b>Remake</b>.</>, cta: null as any },
                  { icon: '🧩', title: 'Chrome extension — save from anywhere', desc: <>On Instagram, TikTok or the Ad Library and spot a gem? One click saves it to your boards.</>, cta: { label: 'Get the extension', href: CHROME_STORE_URL } },
                  { icon: '📁', title: 'Your own files', desc: <>Upload images or videos you already have — we remake them with your product and branding.</>, cta: null as any },
                ].map((c) => (
                  <div key={c.title} style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '15px 16px', borderRadius: 15, border: `1.5px solid ${LINE}`, background: '#fff' }}>
                    <span style={{ width: 38, height: 38, borderRadius: 11, background: SELBG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{c.title}</div>
                      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, marginTop: 2 }}>{c.desc}</div>
                      {c.cta && <a href={c.cta.href} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 7, fontSize: 12, fontWeight: 750, color: GREEN }}>{c.cta.label} →</a>}
                    </div>
                  </div>
                ))}
              </div>

              {picked.length > 0 && (
                // ── THE HUNT — the money moment of this step. Dark spy-radar panel: the radar sweeps
                // for competitor ads while each brand is a chase track (🐆 sprinting after 🦌); every
                // ad found = prey caught. Reduced-motion users get a calm static version (RadarSearch
                // + the animations are all gated on prefers-reduced-motion).
                <div style={{ marginTop: 16, background: 'radial-gradient(120% 160% at 20% 0%, #16301c 0%, #0e1b12 60%, #0b1610 100%)', border: '1px solid rgba(223,254,149,0.25)', borderRadius: 18, padding: '18px 20px', overflow: 'hidden', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <div style={{ flexShrink: 0, transform: 'scale(0.82)', margin: -18 }}><RadarSearch caption="" /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>🐆 On the hunt — grabbing their winning ads…</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3, marginBottom: 14 }}>Every ad they’ve ever run on Meta, pulled straight into your feed. This keeps running — no need to wait.</div>
                      {picked.map((b, bi) => {
                        const n = pullCounts[b.pageId] || 0
                        const pct = n ? Math.min(92, 18 + (n % 400) / 4.6) : 8
                        return (
                          <div key={b.pageId} style={{ padding: '7px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b.name}</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: n ? LIME : 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>{n ? `${n} ads caught` : 'stalking…'}</span>
                            </div>
                            {/* chase track */}
                            <div style={{ position: 'relative', height: 34, borderRadius: 100, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(223,254,149,0.12)', overflow: 'hidden' }}>
                              {/* savanna ground shimmer */}
                              <div className="ob-anim" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(223,254,149,0.08) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: `ob-shimmer 2.6s linear ${bi * 0.4}s infinite` }} />
                              {/* progress fill */}
                              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'linear-gradient(90deg, rgba(63,143,79,0.55), rgba(223,254,149,0.35))', borderRadius: 100, transition: 'width 1.2s cubic-bezier(.22,1,.36,1)' }} />
                              {/* the deer — always just ahead of the leopard */}
                              <span className="ob-anim" style={{ position: 'absolute', top: '50%', left: `calc(${Math.min(pct + 8, 97)}% )`, transform: 'translate(-50%,-50%)', fontSize: 20, animation: `ob-flee 0.55s ease-in-out ${bi * 0.2}s infinite`, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}>🦌</span>
                              {/* the leopard — sprinting at the progress edge */}
                              <span className="ob-anim" style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%,-50%) scaleX(-1)', fontSize: 24, animation: `ob-pounce 0.55s ease-in-out ${bi * 0.2}s infinite`, transition: 'left 1.2s cubic-bezier(.22,1,.36,1)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.55))' }}>🐆</span>
                              {/* dust kicked up behind the leopard */}
                              <span className="ob-anim" style={{ position: 'absolute', top: '62%', left: `calc(${pct}% - 20px)`, transform: 'translate(-50%,-50%)', fontSize: 12, opacity: 0.7, animation: `ob-dust 0.55s linear ${bi * 0.2}s infinite` }}>💨</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, background: SELBG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '12px 15px', fontSize: 13, color: SELTEXT, lineHeight: 1.5 }}>
                🎁 <b>Your first image ads are free.</b> Want a video ad? Just <b>$6</b> each — or go <b>Creator ($49/mo)</b> for unlimited image ads + 10 videos a month.
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12.5, color: FAINT }}>This keeps running — no need to wait for it.</div>
                <div style={{ display: 'flex', gap: 9 }}><button onClick={() => setStep(2)} style={btnGhost}>← Back</button><button onClick={next} style={btnPrimary}>Show me their best ads →</button></div>
              </div>
            </>}

            {/* ── Step 5: Make your first ad ── */}
            {step === 4 && <>
              <h2 style={h2}>Make your first ad — this one’s on us 🎁</h2>
              <p style={lead}>These are your competitors’ <b style={{ color: INK }}>top-performing ads right now</b>. For each brand we grab their top image and their top video (tap ▶ to preview).</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: SELBG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 14px', marginBottom: 18, fontSize: 13, color: SELTEXT, fontWeight: 600, lineHeight: 1.45 }}>
                <span style={{ fontSize: 18 }}>👇</span><span><b>Tap any ad below to remake it</b> — we open the editor, drop in your product, and build it in ~a minute. Your first image ad is <b>free</b>.</span>
              </div>

              {loadingAds && Object.keys(topAds).length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {picked.map((b) => (
                    <div key={b.pageId} style={{ display: 'flex', gap: 12 }}>
                      {[0, 1].map((i) => <div key={i} style={{ flex: 1, aspectRatio: '16/10', borderRadius: 15, background: '#eef1ed', animation: 'ob-pulse 1.2s infinite' }} />)}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {picked.map((b) => {
                  const t = topAds[b.pageId]
                  const hasAny = t && (t.image || t.video)
                  return (
                    <div key={b.pageId}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                        {b.picture
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={b.picture} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                          : <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#eef1ed', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{b.name[0]?.toUpperCase()}</span>}
                        <span style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{b.name}</span>
                        <span style={{ fontSize: 11.5, color: FAINT }}>top ads</span>
                      </div>
                      {!hasAny ? (
                        <div style={{ background: '#fbfcfa', border: `1px dashed ${LINE}`, borderRadius: 14, padding: 16, fontSize: 12.5, color: MUTED }}>
                          {loadingAds ? 'Finding their best ads…' : `Still pulling ${b.name}’s ads — they’ll be in your feed shortly. Remake another competitor for now.`}
                        </div>
                      ) : (
                        <>
                          <div className="ob-adgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
                            {t?.image && <AdCard ad={t.image} kind="image" cost={costs.image} done={cloned.has(t.image.id)} onClone={() => openImageClone(t.image!)} />}
                            {t?.video && <AdCard ad={t.video} kind="video" cost={costs.video} done={cloned.has(t.video.id)} lowCredit={balance !== null && balance < costs.video} onClone={() => onVideoClick(t.video!)} />}
                          </div>
                          <button onClick={() => seeAllAds(b.pageId)} disabled={saving} style={{ marginTop: 9, background: 'none', border: 'none', color: GREEN, fontSize: 12.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                            Not these? See all {pullCounts[b.pageId] ? `${pullCounts[b.pageId]} ` : ''}{b.name} ads →
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12.5, color: cloned.size > 0 ? SELTEXT : FAINT }}>{cloned.size > 0 ? '🎉 Your ad is generating — it’ll be waiting in My Creatives.' : 'Tap an ad above to make your first one — or skip to browse 4.3M ads.'}</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  <button onClick={() => setStep(3)} style={btnGhost}>← Back</button>
                  {cloned.size > 0
                    ? <button onClick={finish} disabled={saving} style={btnPrimary}>{saving ? 'Opening…' : 'Watch my ad being made →'}</button>
                    : <button onClick={finish} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.6 : 1 }}>{saving ? 'Opening…' : 'Skip for now →'}</button>}
                </div>
              </div>
            </>}
          </main>
        </div>
      </div>

      {/* "How the remake works" explainer — overlays the clone step on first arrival. */}
      {showCloneIntro && step === 4 && (() => {
        const refThumb = picked.map((p) => topAds[p.pageId]?.image?.thumbnailUrl || topAds[p.pageId]?.video?.thumbnailUrl).find(Boolean) || null
        const productImg = (kit?.productImages || [])[0] || kit?.logo || null
        const Panel = ({ src, label, badge, glow }: { src: string | null; label: string; badge?: string; glow?: boolean }) => (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', aspectRatio: '3/4', borderRadius: 13, overflow: 'hidden', background: '#f1f3f0', border: glow ? `2px solid ${SELBORDER}` : `1px solid ${LINE}` }}>
              {src
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: glow ? SELBG : '#f1f3f0' }}>{glow ? '✨' : label === 'Your product' ? '📦' : '🎬'}</div>}
              {badge && <span style={{ position: 'absolute', top: 6, left: 6, background: FOREST, color: LIME, fontSize: 9, fontWeight: 900, padding: '2px 7px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '.04em' }}>{badge}</span>}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: label === 'Your product' || glow ? INK : FAINT, marginTop: 6 }}>{label}</div>
          </div>
        )
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(23,37,28,0.35)', backdropFilter: 'blur(5px)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: 30, position: 'relative', boxShadow: '0 30px 90px rgba(23,37,28,.25)' }}>
              <button onClick={() => setShowCloneIntro(false)} style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderRadius: '50%', background: '#f1f3f0', border: `1px solid ${LINE}`, color: MUTED, cursor: 'pointer', fontSize: 15, zIndex: 2 }}>×</button>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: SELBG, border: `1px solid ${SELBORDER}`, color: SELTEXT, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 100, marginBottom: 16 }}>✦ How it works</span>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: '-.02em', margin: '0 0 8px' }}>Turn any ad into your ad.</h2>
              <p style={{ fontSize: 14, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>Take any competitor ad and rebuild it as a brand-new ad for <b style={{ color: INK }}>your</b> product — same winning structure, your brand.</p>

              {/* Big visual: reference + your product → your new ad (each panel gets full width now) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20 }}>
                <Panel src={refThumb} label="Reference" />
                <span style={{ alignSelf: 'center', color: FAINT, fontSize: 22, fontWeight: 300 }}>+</span>
                <Panel src={productImg} label="Your product" />
                <span style={{ alignSelf: 'center', color: GREEN, fontSize: 22 }}>→</span>
                <Panel src={productImg} label="Your new ad" badge="AI" glow />
              </div>

              {/* The 3 steps as a clean row underneath */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {['Pick a competitor ad you love', 'We drop in your product', 'Get a fresh ad in one click'].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, flex: '1 1 160px', background: '#fbfcfa', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px' }}>
                    <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: FOREST, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 12 }}>{i + 1}</span>
                    <span style={{ fontSize: 12.5, color: INK, lineHeight: 1.3 }}>{t}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 22 }}>
                <button onClick={() => setShowCloneIntro(false)} style={btnPrimary}>Show me their top ads →</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Clone modals — the real Discovery components, mounted in-wizard. */}
      {cloneImageAd && <CloneModal ad={{ id: cloneImageAd.id, pageId: cloneImageAd.pageId, pageName: cloneImageAd.pageName, assetImageUrl: cloneImageAd.thumbnailUrl || undefined }} onClose={() => setCloneImageAd(null)} onGenerated={() => setCloned((s) => new Set(s).add(cloneImageAd.id))} />}
      {cloneVideoAd && <CloneVideoModal sourceAdId={cloneVideoAd.id} sourcePoster={cloneVideoAd.thumbnailUrl || undefined} onClose={() => setCloneVideoAd(null)} onGenerated={() => setCloned((s) => new Set(s).add(cloneVideoAd.id))} />}

      {/* Low-credit → Launch Pack sheet (video clone). */}
      {videoBuyFor && (
        <div onClick={() => setVideoBuyFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(23,37,28,0.35)', backdropFilter: 'blur(4px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: 28, textAlign: 'center', boxShadow: '0 30px 90px rgba(23,37,28,.25)' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🎬</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>Make it a video</div>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: '10px 0 18px' }}>
              Image ads are free — a <b style={{ color: SELTEXT }}>video ad is $6</b>. Pick how you want it, and we’ll open your remake the moment it’s ready.
            </p>
            <button onClick={buyLaunchPack} disabled={buying} style={{ width: '100%', textAlign: 'left', background: '#fbfcfa', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '13px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit', opacity: buying ? 0.6 : 1 }}>
              <span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: INK }}>Pay as you go</span>
                <span style={{ display: 'block', fontSize: 12, color: MUTED }}>$9 → this video + a few more. No subscription.</span>
              </span>
              <span style={{ fontSize: 20, fontWeight: 900, color: GREEN, flexShrink: 0 }}>$9</span>
            </button>
            <button onClick={subscribeCreator} disabled={buying} style={{ width: '100%', textAlign: 'left', background: FOREST, border: 'none', borderRadius: 14, padding: '13px 16px', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit', opacity: buying ? 0.6 : 1 }}>
              <span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: LIME }}>Go Creator</span>
                <span style={{ display: 'block', fontSize: 12, color: 'rgba(223,254,149,0.75)' }}>Unlimited image ads + 10 videos / month</span>
              </span>
              <span style={{ fontSize: 20, fontWeight: 900, color: LIME, flexShrink: 0 }}>$49<span style={{ fontSize: 11, fontWeight: 700 }}>/mo</span></span>
            </button>
            <button onClick={() => setVideoBuyFor(null)} style={{ marginTop: 8, background: 'none', border: 'none', color: FAINT, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Skip for now</button>
            {buying && <div style={{ marginTop: 12, fontSize: 11.5, color: FAINT }}>Complete checkout in the new tab — this page updates automatically.</div>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes ob-pulse{0%,100%{opacity:.5}50%{opacity:1}}
        @keyframes ob-spin{to{transform:rotate(360deg)}}
        @keyframes ob-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
        @keyframes ob-pounce{0%,100%{transform:translate(-50%,-50%) scaleX(-1) translateY(0) rotate(0deg)}30%{transform:translate(-50%,-62%) scaleX(-1) translateY(-3px) rotate(-6deg)}60%{transform:translate(-50%,-44%) scaleX(-1) translateY(2px) rotate(4deg)}}
        @keyframes ob-flee{0%,100%{transform:translate(-50%,-50%) translateY(0)}45%{transform:translate(-50%,-64%) translateY(-3px)}}
        @keyframes ob-dust{0%{opacity:.7;transform:translate(-50%,-50%) scale(.7)}100%{opacity:0;transform:translate(-90%,-50%) scale(1.25)}}
        @media(prefers-reduced-motion:reduce){.ob-anim{animation:none!important}}
        @media(max-width:840px){.ob-rail{display:none!important}}
        @media(max-width:640px){.ob-main{padding:24px 16px 18px!important}.ob-adgrid{grid-template-columns:1fr!important}}
      `}</style>
    </div>
  )
}

/** One competitor ad tile. Video reuses the SAME Discovery component (HoverScrubVideo) — hover-scrub
 * white line + lime play button + progress ring — so it's identical to the grid everywhere. */
function AdCard({ ad, kind, cost, done, lowCredit, onClone }: {
  ad: { id: string; thumbnailUrl: string | null; videoUrl: string | null }
  kind: 'image' | 'video'; cost: number; done?: boolean; lowCredit?: boolean; onClone: () => void
}) {
  const [videoDead, setVideoDead] = useState(false)
  const showVideo = kind === 'video' && !!ad.videoUrl && !videoDead
  return (
    <div onClick={onClone}
      style={{ position: 'relative', aspectRatio: '4/5', borderRadius: 15, overflow: 'hidden', background: '#0f1a12', border: `1.5px solid ${LINE}`, cursor: 'pointer' }}>
      {showVideo
        ? <HoverScrubVideo src={ad.videoUrl!} poster={ad.thumbnailUrl || undefined} onError={() => setVideoDead(true)} />
        : ad.thumbnailUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ad.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No preview</div>}

      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10 }}>
        <span style={{ background: 'rgba(8,16,15,0.78)', color: kind === 'video' ? '#dffe95' : 'white', fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '.04em' }}>{kind === 'video' ? '🎬 Video' : '🖼 Image'}</span>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, background: 'linear-gradient(transparent, rgba(8,16,15,0.94))', zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: done ? 'rgba(223,254,149,0.18)' : '#dffe95', color: done ? '#dffe95' : '#17251c', fontSize: 13, fontWeight: 800, padding: '10px 0', borderRadius: 11, border: done ? '1px solid #dffe95' : 'none' }}>
          {done ? '✓ Remaking your ad…' : kind === 'video' ? `Remake as video · $${Math.round(cost / 100)}` : '✨ Remake this — Free'}
        </div>
      </div>
    </div>
  )
}
