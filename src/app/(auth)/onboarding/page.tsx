'use client'
/**
 * Onboarding — competitor-first setup (reworked from the old 5-question survey):
 *   1. Your store   — paste URL → detect-product builds the brand kit + product photos live.
 *   2. Your niche   — one line + chips; doubles as the competitor-suggestion seed.
 *   3. Competitors  — pick up to 3 (search 4.3M crawled brands + the 605K directory);
 *                     on continue we fire crawlOnly express pulls (Free cap = 3/day = exact fit)
 *                     and follow each brand (alerts + Following feed).
 *   4. Clone sources — educate the 3 ways to feed the clone machine (Discovery / Chrome
 *                     extension / Assets upload) while the pulls stream in live.
 * Finish → user_profiles.onboarding_completed = true → /discovery.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const LIME = '#dffe95'
const BG = '#10211f'
const PANEL = '#152928'
const STEPS = ['Your store', 'Your niche', 'Your competitors', 'Clone sources']
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/selfmade-save-ads/eekbcgdoonpmhoojoaggpfmfgcplaefi'

const NICHES = ['Beauty & Skincare', 'Supplements', 'Apparel & Fashion', 'Fitness', 'Home & Kitchen', 'Pets', 'Baby & Kids', 'Electronics', 'SaaS', 'Jewelry']

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
      const k: Kit = { brandName: d.brandName, logo: d.logo || null, colors: d.colors || [], productImages: (d.productImages?.length ? d.productImages : d.images) || [] }
      setKit(k); setStoreName(d.brandName || '')
    } catch (e: any) {
      setDetectErr('Could not read that site — you can still continue and add your brand later.')
    } finally { setDetecting(false) }
  }

  // Save the detected brand when leaving step 1 (best-effort — a brand-cap 402 must not block onboarding).
  const saveBrand = async () => {
    if (!kit) return
    try {
      await fetch('/api/brands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: (storeName || kit.brandName || 'My brand').slice(0, 60),
          website: url.trim(),
          product_images: (kit.productImages || []).slice(0, 6),
          brand_kit: { colors: kit.colors || [], logo: kit.logo || null },
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
    // Land ON their first competitor's ads (Brand Spy) — not the generic Discovery feed. If the crawl
    // is still running it shows the live pull screen ("pulling their ads…"), which is the right story.
    router.push(picked[0] ? `/discovery/brand-spy/${picked[0].pageId}` : '/discovery')
  }

  const next = async () => {
    if (step === 0 && kit) saveBrand()               // fire-and-forget
    if (step === 2) firePulls()                       // pulls stream while they read step 4
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const canNext = [true, true, picked.length > 0, true][step]  // steps 1-2 skippable; ≥1 competitor to advance

  const chip = (on: boolean): React.CSSProperties => ({
    background: on ? 'rgba(223,254,149,0.12)' : '#1c3533', border: `1.5px solid ${on ? LIME : 'rgba(223,254,149,0.12)'}`,
    color: on ? LIME : 'rgba(255,255,255,0.75)', borderRadius: 100, padding: '8px 15px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
  })
  const h2: React.CSSProperties = { fontSize: 28, fontWeight: 900, color: 'white', marginBottom: 8, letterSpacing: '-.02em' }
  const em: React.CSSProperties = { fontFamily: 'Georgia,serif', fontStyle: 'italic', color: LIME }
  const sub: React.CSSProperties = { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }
  const input: React.CSSProperties = { width: '100%', background: '#0d1b1a', border: '1.5px solid rgba(223,254,149,0.15)', borderRadius: 12, padding: '13px 15px', fontSize: 15, color: 'white', outline: 'none', fontFamily: 'inherit' }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: PANEL, borderBottom: '1px solid rgba(223,254,149,0.13)', padding: '0 40px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: LIME, fontFamily: 'Georgia,serif', fontStyle: 'italic' }}>Selfmade</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ height: 8, borderRadius: 100, background: i === step ? LIME : i < step ? 'rgba(223,254,149,0.4)' : 'rgba(255,255,255,0.08)', width: i === step ? 24 : 8, transition: 'all .3s' }} />
          ))}
        </div>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Step {step + 1} of {STEPS.length}</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', background: LIME, width: `${((step + 1) / STEPS.length) * 100}%`, transition: 'width .5s' }} />
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ width: '100%', maxWidth: 600, background: PANEL, border: '1px solid rgba(223,254,149,0.13)', borderRadius: 24, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: 1.5, background: `linear-gradient(90deg,transparent,${LIME},transparent)` }} />
          <div style={{ padding: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', color: LIME, marginBottom: 14 }}>Step {step + 1} of {STEPS.length} — {STEPS[step]}</div>

            {/* ── Step 1: Your store ── */}
            {step === 0 && <>
              <h2 style={h2}>Paste your store link —<br /><em style={em}>we&apos;ll do the rest.</em></h2>
              <p style={sub}>We grab your logo, colors and product photos automatically — they become the ingredients for every ad you clone.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...input, flex: 1 }} placeholder="yourstore.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} />
                <button onClick={detect} disabled={detecting || !url.trim()} style={{ background: LIME, color: BG, border: 'none', borderRadius: 12, padding: '0 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: detecting || !url.trim() ? 0.55 : 1 }}>
                  {detecting ? 'Reading…' : 'Detect'}
                </button>
              </div>
              {detectErr && <div style={{ marginTop: 10, fontSize: 12.5, color: '#ffb4b4' }}>{detectErr}</div>}
              {kit && (
                <div style={{ marginTop: 18, background: '#0d1b1a', border: `1.5px solid rgba(223,254,149,0.25)`, borderRadius: 16, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    {kit.logo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={kit.logo} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: 'white' }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 10, background: LIME, color: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>{(storeName || '?')[0]?.toUpperCase()}</div>}
                    <input value={storeName} onChange={(e) => setStoreName(e.target.value)} style={{ ...input, padding: '8px 11px', fontSize: 15, fontWeight: 700, flex: 1 }} />
                    {(kit.colors || []).slice(0, 4).map((c) => <span key={c} style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1.5px solid rgba(255,255,255,0.25)', flexShrink: 0 }} />)}
                  </div>
                  {(kit.productImages || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                      {(kit.productImages || []).slice(0, 6).map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p} src={p} alt="" style={{ width: 62, height: 62, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }} />
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 12, color: LIME }}>✓ Brand kit ready — your product photos will be swapped into the ads you clone.</div>
                </div>
              )}
              <div style={{ marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>No store yet? Just hit Next — you can add products any time in My Creatives.</div>
            </>}

            {/* ── Step 2: Niche ── */}
            {step === 1 && <>
              <h2 style={h2}>What do you<br /><em style={em}>sell?</em></h2>
              <p style={sub}>We use this to suggest the right competitors and benchmark your ads.</p>
              <input style={input} placeholder="e.g. Women's activewear, hair supplements…" value={niche} onChange={(e) => setNiche(e.target.value)} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {NICHES.map((n) => <button key={n} onClick={() => setNiche(n)} style={chip(niche === n)}>{n}</button>)}
              </div>
            </>}

            {/* ── Step 3: Competitors ── */}
            {step === 2 && <>
              <h2 style={h2}>Pick up to 3 competitors<br /><em style={em}>to spy on.</em></h2>
              <p style={sub}>We&apos;ll pull their complete Meta ad history — every ad they&apos;re running worldwide — into your feed, ready to clone.</p>
              <input style={input} placeholder={`Search 4.3M ads & 600K brands… ${niche ? `try “${niche.split(' ')[0].toLowerCase()}”` : 'e.g. Gymshark, Hims, AG1'}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              {searching && <div style={{ marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.4)' }}>Searching…</div>}
              {results.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 250, overflowY: 'auto' }}>
                  {results.map((b) => {
                    const on = picked.some((p) => p.pageId === b.pageId)
                    return (
                      <button key={b.pageId} onClick={() => togglePick(b)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: on ? 'rgba(223,254,149,0.1)' : '#0d1b1a', border: `1.5px solid ${on ? LIME : 'rgba(255,255,255,0.07)'}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        {b.picture
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={b.picture} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
                          : <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1c3533', color: LIME, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{b.name[0]?.toUpperCase()}</span>}
                        <span style={{ flex: 1, color: 'white', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{typeof b.adCount === 'number' && b.adCount > 0 ? `${b.adCount} ads` : ''}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: on ? LIME : 'rgba(255,255,255,0.3)' }}>{on ? '✓ Added' : '+ Add'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {picked.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {picked.map((b) => (
                    <span key={b.pageId} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(223,254,149,0.12)', border: `1px solid ${LIME}`, color: LIME, borderRadius: 100, padding: '6px 12px', fontSize: 13, fontWeight: 700 }}>
                      {b.name}
                      <button onClick={() => togglePick(b)} style={{ background: 'none', border: 'none', color: LIME, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', alignSelf: 'center' }}>{picked.length}/3</span>
                </div>
              )}

              {/* Manual add — competitor not in our list. */}
              <div style={{ marginTop: 16 }}>
                {!showManual ? (
                  <button onClick={() => setShowManual(true)} style={{ background: 'none', border: 'none', color: LIME, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    + Can&apos;t find them? Add a competitor manually
                  </button>
                ) : (
                  <div style={{ background: '#0d1b1a', border: '1px solid rgba(223,254,149,0.18)', borderRadius: 14, padding: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'white', marginBottom: 8 }}>Add a competitor manually</div>
                    <input style={{ ...input, padding: '10px 12px', fontSize: 14, marginBottom: 8 }} placeholder="Brand name (e.g. Nike)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                    <input style={{ ...input, padding: '10px 12px', fontSize: 14 }} placeholder="Their Meta Ad Library link, or page ID" value={manualLink} onChange={(e) => setManualLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>Open their <a href="https://www.facebook.com/ads/library" target="_blank" rel="noreferrer" style={{ color: LIME }}>Ad Library</a> page and paste the URL — it has the page ID.</div>
                    {manualErr && <div style={{ fontSize: 12, color: '#ffb4b4', marginTop: 6 }}>{manualErr}</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={addManual} style={{ background: LIME, color: BG, border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
                      <button onClick={() => { setShowManual(false); setManualErr('') }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>}

            {/* ── Step 4: Clone sources + live pulls ── */}
            {step === 3 && <>
              <h2 style={h2}>Three ways to feed<br /><em style={em}>the clone machine.</em></h2>
              <p style={sub}>Any ad you can see, you can clone with your product — from your competitors, from anywhere on the internet, or from your own files.</p>

              {picked.length > 0 && (
                <div style={{ background: '#0d1b1a', border: '1px solid rgba(223,254,149,0.2)', borderRadius: 14, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: LIME, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>⚡ Pulling your competitors&apos; ads now…</div>
                  {picked.map((b) => (
                    <div key={b.pageId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13.5, color: 'white' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: pullCounts[b.pageId] ? LIME : 'rgba(255,255,255,0.25)', animation: pullCounts[b.pageId] ? undefined : 'sm-pulse 1.2s infinite' }} />
                      <span style={{ flex: 1 }}>{b.name}</span>
                      <span style={{ color: pullCounts[b.pageId] ? LIME : 'rgba(255,255,255,0.4)', fontWeight: 700 }}>
                        {pullCounts[b.pageId] ? `${pullCounts[b.pageId]} ads found` : 'crawling…'}
                      </span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Keep going — this finishes in the background and lands in your feed.</div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: '🔎', title: 'Competitor ads — Discovery', desc: 'Search 4.3M live Meta ads worldwide (or by country). Hover any ad → Clone.', cta: null },
                  { icon: '🧩', title: 'Any ad, anywhere — Chrome extension', desc: 'See a great ad on Instagram, TikTok or the Ad Library? Hover → Save. It lands in your boards, ready to clone.', cta: { label: 'Get the extension', href: CHROME_STORE_URL } },
                  { icon: '📁', title: 'Your own files — Assets', desc: 'Upload videos or images you already have. Clone them with your product, add captions, remix hooks.', cta: null },
                ].map((c) => (
                  <div key={c.title} style={{ display: 'flex', gap: 12, background: '#1c3533', border: '1px solid rgba(223,254,149,0.1)', borderRadius: 14, padding: '14px 15px' }}>
                    <span style={{ fontSize: 24 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: 'white' }}>{c.title}</div>
                      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 3, lineHeight: 1.45 }}>{c.desc}</div>
                      {c.cta && <a href={c.cta.href} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12.5, fontWeight: 800, color: LIME }}>{c.cta.label} →</a>}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16, background: 'rgba(223,254,149,0.07)', border: `1px dashed rgba(223,254,149,0.35)`, borderRadius: 14, padding: '12px 15px', fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
                🎁 <b style={{ color: LIME }}>Your free credits cover ~5 image clones.</b> Want a video clone? The <b style={{ color: LIME }}>$9 Launch Pack</b> (900 credits) covers your first AI video — one click, no subscription.
              </div>
            </>}
          </div>

          {/* Nav */}
          <div style={{ padding: '16px 36px', borderTop: '1px solid rgba(223,254,149,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {STEPS.map((_, i) => <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 100, background: i === step ? LIME : i < step ? 'rgba(223,254,149,0.4)' : 'rgba(255,255,255,0.08)', transition: 'all .3s' }} />)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && <button onClick={() => setStep((s) => s - 1)} style={{ background: 'none', border: '1.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', padding: '10px 22px', borderRadius: 100, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>← Back</button>}
              {step < STEPS.length - 1
                ? <button onClick={next} disabled={!canNext} style={{ background: canNext ? LIME : 'rgba(223,254,149,0.2)', color: canNext ? BG : 'rgba(255,255,255,0.3)', border: 'none', padding: '10px 28px', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: canNext ? 'pointer' : 'not-allowed' }}>
                  {step === 2 && picked.length > 0 ? `Pull ${picked.length} brand${picked.length > 1 ? 's' : ''} →` : 'Next →'}
                </button>
                : <button onClick={finish} disabled={saving} style={{ background: LIME, color: BG, border: 'none', padding: '10px 28px', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Opening…' : 'See their ads →'}</button>
              }
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes sm-pulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
    </div>
  )
}
