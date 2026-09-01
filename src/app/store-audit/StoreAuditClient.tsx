'use client'
/**
 * /store-audit — the ONE combined free audit: your ads AND your search/AI visibility, in a single flow,
 * one report, nothing dropped.
 *
 *   Input (website + your ads via brand-pick/link + one competitor)
 *     → Act 1  <ScanTheater embedded>   the full ads audit — its crawl-wait gate is intact, so it only
 *                                       advances once real ads actually show (never "report comes later")
 *     → Act 2  <AuditTheater embedded>  mounts after Act 1 finishes — the full SEO/GEO audit
 *     → one shared CTA at the bottom
 *
 * Both theaters run in `embedded` mode: their own input screens + conversion CTAs are suppressed, findings
 * are preserved verbatim. The standalone /scan and /audit routes are untouched (rollback).
 */
import { useEffect, useRef, useState } from 'react'
import { requireUpgrade } from '@/lib/ui/requireUpgrade'

const FOREST = '#141d15', ORANGE = '#ff5a2c', SUB = 'rgba(255,255,255,.82)'
const SERIF = "'Instrument Serif','Iowan Old Style',Georgia,serif"

type BrandRow = { pageId: string; name: string; adCount: number; crawled: boolean }
type Seed = { pageId?: string; adLibraryUrl?: string; name?: string; competitors?: { pageId: string; name: string }[] }
type Started = { seed: Seed; domain: string; rival: string }

// Pull a page id out of a Meta Ad Library link (or accept a bare id).
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  if (/^\d{5,}$/.test(t)) return t
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  return m ? m[1] : null
}

// Lazy client-only imports so the heavy theaters don't bloat the input screen's first paint.
import dynamic from 'next/dynamic'
const ScanTheater = dynamic(() => import('@/components/scan/ScanTheater'), { ssr: false })
const AuditTheater = dynamic(() => import('@/components/audit/AuditTheater'), { ssr: false })

export default function StoreAuditClient() {
  const [started, setStarted] = useState<Started | null>(null)
  const [adsDone, setAdsDone] = useState(false)
  const [seoDone, setSeoDone] = useState(false)
  const [adsData, setAdsData] = useState<any>(null)
  const [seoData, setSeoData] = useState<any>(null)
  const [captured, setCaptured] = useState(false)
  const [brandId, setBrandId] = useState<string | null>(null)   // the brand we render the real ads under
  const [atCap, setAtCap] = useState(false)                     // at the plan's brand limit → can't add this store
  const act2Ref = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)

  // Gently bring the next act / final CTA into view as each finishes, so the single scroll reads as one report.
  useEffect(() => { if (adsDone) setTimeout(() => act2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }, [adsDone])
  useEffect(() => { if (seoDone) setTimeout(() => ctaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }, [seoDone])

  // Signup-first: the founder is already logged in (the page is gated), so on completion we AUTO-save the
  // report under their account — no email gate. This starts the nurture drip (converted when they go paid)
  // and drops the scan-domain cookie so "Open dashboard" seeds their brand + the audit carries over.
  useEffect(() => {
    if (!seoDone || captured || !started) return
    setCaptured(true)
    const dom = started.domain
    try { document.cookie = `sf_scan_domain=${encodeURIComponent(dom)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax` } catch { /* ignore */ }
    fetch('/api/audit/lead', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: dom, brandName: adsData?.brand?.name || seoData?.siteName, report: buildReport(adsData, seoData), adUrls: [] }),
    }).catch(() => {})
    // Ensure a brand exists for THIS store so we can render the real ads (and the audit carries over).
    // This REPLACES onboarding: stamp their Meta Ad Library page (own-ads audit) + follow the competitor
    // they picked, and mark them onboarded (the /api/audit/lead call above sets onboarding_completed).
    ;(async () => {
      const norm = (s: string) => (s || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
      const seed = started.seed || {}
      try {
        const list = await fetch('/api/brands', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ brands: [] }))
        let bid: string | null = ((list.brands || []).find((b: any) => norm(b.website) === norm(dom)) || null)?.id || null
        if (!bid) {
          const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: adsData?.brand?.name || seoData?.siteName || norm(dom), website: dom, brand_kit: seed.pageId ? { ownMetaPageId: seed.pageId } : {} }) })
          const j = await r.json().catch(() => ({}))
          if (r.ok && j.brand?.id) bid = j.brand.id
          else if (r.status === 402) setAtCap(true)
        }
        if (bid) {
          try { document.cookie = `sf_brand=${bid}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax` } catch { /* ignore */ }
          try { document.cookie = `sm_onb=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax` } catch { /* ignore */ }   // onboarded (audit = onboarding)
          // Follow the competitor they picked (or typed a site for) so the rival is tracked from day one.
          const rival = (seed.competitors || [])[0]
          try {
            if (rival?.pageId) await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: String(rival.pageId), brandName: rival.name, action: 'follow', brandId: bid, spied: true }) })
            else if (started.rival) { const sp = await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: started.rival, brand: bid }) }).then((x) => x.json()).catch(() => null); if (sp?.pageId) await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: String(sp.pageId), action: 'follow', brandId: bid, spied: true }) }) }
          } catch { /* best-effort */ }
          setBrandId(bid)
        }
      } catch { /* best-effort */ }
    })()
  }, [seoDone])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) return <InputScreen onStart={setStarted} />

  return (
    <div style={{ background: FOREST, minHeight: '100dvh' }}>
      {/* Act 1 — your ads. Its own crawl-wait gate decides when ads are ready; onDone fires only then.
          onError: if the ads pull blips out (after auto-retries), we STILL run the SEO/AI half + show the
          rest — a transient ads hiccup never dead-ends the whole audit. */}
      <ScanTheater embedded seed={started.seed} onDone={(d: any) => { setAdsData(d); setAdsDone(true) }} onError={() => { setAdsData(null); setAdsDone(true) }} />

      {/* Act 2 — your search & AI visibility. Mounts only after the ads act has truly finished. */}
      {adsDone && (
        <div ref={act2Ref}>
          <ActDivider n={2} label="Your search & AI visibility" />
          <AuditTheater embedded seedDomain={started.domain} seedRival={started.rival} onDone={(d: any) => { setSeoData(d); setSeoDone(true) }} />
        </div>
      )}

      {/* The ads we made you — 5 REAL renders (free) + 5 more you can generate with credits. */}
      {seoDone && brandId && <AuditAds domain={started.domain} />}
      {seoDone && atCap && (
        <div style={{ padding: '10px 24px 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ maxWidth: 620, width: '100%', background: '#0f150f', border: `1px solid ${ORANGE}44`, borderRadius: 16, padding: '20px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
            You&rsquo;re at your plan&rsquo;s brand limit, so we couldn&rsquo;t add this store. <a href="/pricing" style={{ color: '#fff', fontWeight: 800 }}>Upgrade to add it</a> and we&rsquo;ll render your ads.
          </div>
        </div>
      )}

      {/* Signup-first: they're logged in, the full report is already shown above. Save it + open the app. */}
      {seoDone && (
        <div ref={ctaRef} style={{ padding: '48px 24px 90px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ maxWidth: 620, width: '100%', background: '#0f150f', border: `1px solid ${ORANGE}44`, borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontStyle: 'italic', color: ORANGE, fontFamily: SERIF }}>your report is saved to your account</div>
            <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1.1, marginTop: 8 }}>Now let&rsquo;s fix it — together.</div>
            <div style={{ fontSize: 14.5, color: SUB, marginTop: 12, lineHeight: 1.55 }}>
              Everything above is saved to your dashboard. Open it and Selfmade&rsquo;s AI marketing team starts on the highest-impact fixes — you approve every move.
            </div>
            <a href="/hq" style={{ display: 'inline-block', marginTop: 20, background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 15.5, padding: '15px 34px', borderRadius: 3, textDecoration: 'none' }}>
              Open my dashboard →
            </a>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 12 }}>Your audit + the moves we drafted are waiting · you approve every move</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActDivider({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ padding: '34px 24px 6px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1100, width: '100%', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flex: 'none' }}>{n}</span>
        <span style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: '#fff' }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.14)' }} />
      </div>
    </div>
  )
}

/* ───────────────────────── Input screen ───────────────────────── */
function InputScreen({ onStart }: { onStart: (s: Started) => void }) {
  const [domain, setDomain] = useState('')
  const [focus, setFocus] = useState<string | null>(null)       // which capability the visitor came in for (nav → audit)
  const [rival, setRival] = useState('')
  // "Your ads" — brand-pick from our DB, or paste a Meta Ad Library link.
  const [brandQ, setBrandQ] = useState('')
  const [brandResults, setBrandResults] = useState<BrandRow[]>([])
  const [brand, setBrand] = useState<{ pageId?: string; adLibraryUrl?: string; name: string } | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [adLink, setAdLink] = useState('')
  // Competitor — brand-pick (powers the ads teardown; the SEO audit auto-picks a rival if none typed).
  const [compQ, setCompQ] = useState('')
  const [compResults, setCompResults] = useState<BrandRow[]>([])
  const [comp, setComp] = useState<{ pageId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Carry the domain the founder typed on the landing ("See your ads") through signup into this screen.
  useEffect(() => { try { const m = document.cookie.match(/(?:^|; )sf_scan_domain=([^;]+)/); if (m) setDomain((d) => d || decodeURIComponent(m[1])) } catch { /* ignore */ } }, [])
  useEffect(() => { try { setFocus(new URLSearchParams(window.location.search).get('focus')) } catch { /* ignore */ } }, [])

  // Debounced brand search (public endpoint the /scan picker already uses).
  useEffect(() => {
    if (brand || brandQ.trim().length < 2) { setBrandResults([]); return }
    const t = setTimeout(() => { fetch(`/api/scan/brands?q=${encodeURIComponent(brandQ.trim())}`).then(r => r.json()).then(j => setBrandResults(Array.isArray(j.results) ? j.results.slice(0, 6) : [])).catch(() => setBrandResults([])) }, 220)
    return () => clearTimeout(t)
  }, [brandQ, brand])
  useEffect(() => {
    if (comp || compQ.trim().length < 2) { setCompResults([]); return }
    const t = setTimeout(() => { fetch(`/api/scan/brands?q=${encodeURIComponent(compQ.trim())}`).then(r => r.json()).then(j => setCompResults(Array.isArray(j.results) ? j.results.slice(0, 6) : [])).catch(() => setCompResults([])) }, 220)
    return () => clearTimeout(t)
  }, [compQ, comp])

  const submit = () => {
    const d = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d || !d.includes('.')) { setError('Enter your store website, like yourstore.com'); return }
    // Resolve "your ads": a picked brand, or a pasted ad-library link.
    let seed: Seed = {}
    if (brand?.pageId) seed = { pageId: brand.pageId, name: brand.name }
    else if (brand?.adLibraryUrl) seed = { adLibraryUrl: brand.adLibraryUrl, name: brand.name }
    else if (showLink && adLink.trim()) {
      const pid = extractPageId(adLink)
      if (!pid) { setError('That doesn’t look like a Facebook Ad Library link.'); return }
      seed = { pageId: pid, name: d }
    } else { setError('Add your ads — search your brand or paste your Facebook Ad Library link.'); return }
    if (comp?.pageId) seed.competitors = [{ pageId: comp.pageId, name: comp.name }]
    onStart({ seed, domain: d, rival: rival.trim() })
  }

  // Clean, white, centered treatment — matches /get-started (the founder just signed up; premium, calm).
  const WINK = '#1a1410', WSUB = '#6f665a', WLINE = 'rgba(26,20,16,.14)', WORANGE = '#e02f06'
  const WSERIF = "'Playfair Display','Times New Roman',serif"
  const field: React.CSSProperties = { width: '100%', padding: '14px 20px', fontSize: 15, borderRadius: 100, border: `1px solid ${WLINE}`, background: '#fff', color: WINK, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: WINK, marginBottom: 7, display: 'block' }
  const ResultList = ({ rows, onPick }: { rows: BrandRow[]; onPick: (r: BrandRow) => void }) => (
    rows.length ? (
      <div style={{ marginTop: 6, background: '#fff', border: `1px solid ${WLINE}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 30px rgba(26,20,16,.1)' }}>
        {rows.map(r => (
          <button key={r.pageId} onClick={() => onPick(r)} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 16px', background: 'transparent', border: 'none', borderTop: `1px solid ${WLINE}`, color: WINK, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontSize: 11.5, color: WSUB }}>{r.adCount ? `${r.adCount.toLocaleString()} ads` : ''}{r.crawled ? ' · ready' : ''}</span>
          </button>
        ))}
      </div>
    ) : null
  )
  const Chip = ({ name, onClear }: { name: string; onClear: () => void }) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f6f0e6', border: `1px solid ${WLINE}`, color: WINK, borderRadius: 100, padding: '8px 8px 8px 16px', fontSize: 14, fontWeight: 600 }}>
      {name}<button onClick={onClear} style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(26,20,16,.1)', color: WINK, cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  )
  const wlink: React.CSSProperties = { marginTop: 8, background: 'none', border: 'none', color: WORANGE, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'none' }
  const focusLabel = focus ? ({ marketer: 'AI marketing', ads: 'Paid ads', seo: 'SEO', geo: 'AI visibility', shopify: 'Shopify autopilot' } as Record<string, string>)[focus] : null

  return (
    <div style={{ minHeight: '100dvh', background: '#fff', color: WINK, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`input::placeholder{color:${WSUB};opacity:.7}`}</style>
      <div style={{ width: '100%', maxWidth: 540 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: WORANGE, marginBottom: 12, textAlign: 'center' }}>{domain ? `Auditing ${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` : `Free · ${focusLabel ? focusLabel + ' audit' : 'one scan'} · saved to your account`}</div>
        <h1 style={{ fontFamily: WSERIF, fontSize: 44, fontWeight: 500, lineHeight: 1.05, margin: '0 0 10px', letterSpacing: '-.02em', textAlign: 'center' }}>Audit your whole store.</h1>
        <p style={{ fontSize: 15.5, color: WSUB, lineHeight: 1.5, margin: '0 0 28px', textAlign: 'center' }}>Your ads and your search &amp; AI visibility — one scan, one report. See where you stand on Facebook, Google, and ChatGPT/Gemini, and where rivals are winning.</p>

        <label style={label}>Your store website</label>
        <input value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="yourstore.com" autoFocus style={field} />

        <div style={{ height: 18 }} />
        <label style={label}>Your ads</label>
        {brand ? <Chip name={brand.name} onClear={() => { setBrand(null); setBrandQ('') }} /> : showLink ? (
          <div>
            <input value={adLink} onChange={e => setAdLink(e.target.value)} placeholder="Paste your Facebook Ad Library link" style={field} />
            <button onClick={() => { setShowLink(false); setAdLink('') }} style={wlink}>← search my brand instead</button>
          </div>
        ) : (
          <div>
            <input value={brandQ} onChange={e => setBrandQ(e.target.value)} placeholder="Search your brand name…" style={field} />
            <ResultList rows={brandResults} onPick={(r) => { setBrand({ pageId: r.pageId, name: r.name }); setBrandResults([]) }} />
            <button onClick={() => setShowLink(true)} style={wlink}>or paste your Facebook Ad Library link →</button>
          </div>
        )}

        <div style={{ height: 18 }} />
        <label style={label}>Top competitor <span style={{ fontWeight: 600, color: WSUB }}>· optional</span></label>
        {comp ? <Chip name={comp.name} onClear={() => { setComp(null); setCompQ('') }} /> : (
          <div>
            <input value={compQ} onChange={e => setCompQ(e.target.value)} placeholder="Search a rival brand…" style={field} />
            <ResultList rows={compResults} onPick={(r) => { setComp({ pageId: r.pageId, name: r.name }); setCompResults([]) }} />
            <input value={rival} onChange={e => setRival(e.target.value)} placeholder="…or their website for the search head-to-head — e.g. rival.com" style={{ ...field, marginTop: 8, fontSize: 14 }} />
          </div>
        )}

        {error && <div style={{ marginTop: 16, background: '#fdeee9', border: `1px solid ${WORANGE}55`, color: '#8a2c10', borderRadius: 12, padding: '11px 16px', fontSize: 13.5 }}>{error}</div>}

        <button onClick={submit} style={{ marginTop: 24, width: '100%', background: WORANGE, color: '#fff', fontWeight: 800, fontSize: 15.5, padding: '15px 22px', borderRadius: 100, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Scan my store →</button>
        <div style={{ fontSize: 12.5, color: WSUB, marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>Reads only what&rsquo;s public. Competitor optional; we&rsquo;ll pick a real one if you skip it. Your report saves to your account.</div>

        {/* Just starting out — no store yet. The audit needs a live site to read, so send them into the app. */}
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${WLINE}`, fontSize: 13.5, color: WSUB, lineHeight: 1.5, textAlign: 'center' }}>
          No website yet — just starting out?{' '}
          <a href="/hq" style={{ color: WORANGE, fontWeight: 800, textDecoration: 'none' }}>Start building with Selfmade →</a>
        </div>
      </div>
    </div>
  )
}

/* Build the report snapshot from the two theaters' real result data — stored on the lead so the nurture
 * emails are personalised (revenue-at-stake, top leak, rival formula, AI-visibility gaps). */
function buildReport(adsData: any, seoData: any) {
  const findings: any[] = Array.isArray(seoData?.sections) ? seoData.sections.flatMap((s: any) => s?.findings || []) : []
  const topLeak = findings.find((f: any) => f?.severity === 'high')?.title || findings[0]?.title
  const dist = adsData?.winners?.dist || {}
  const hook = dist.hook_type?.[0]?.label, angle = dist.angle?.[0]?.label
  const reads = seoData?.ai?.reads || []
  return {
    score: seoData?.score, category: seoData?.category, currency: seoData?.currency,
    revenueLostPerYear: seoData?.revenueLostPerYear,
    topLeak, leaks: findings.slice(0, 5).map((f: any) => f?.title).filter(Boolean),
    rivalName: adsData?.rivalToRemake?.brand || adsData?.winners?.examples?.[0]?.brand,
    rivalFormula: hook && angle ? `${hook} hook × ${angle} angle` : undefined,
    aiMissing: reads.filter((r: any) => !r.mentioned).length, aiTotal: reads.length,
  }
}

/* ── The ads we made you — 5 REAL renders (free) + 5 you can generate with credits ──
 * Reuses /api/ads-studio/templates: 10 brand-grounded concepts, the first 5 renders per brand are FREE,
 * the rest charge image_studio_pro. The prompt/brief for all 10 is written server-side; the founder just
 * watches the first 5 appear and taps Generate on any of the other 5. */
const FREE = 5
type Tpl = { title: string; concept?: string; headline?: string; angle?: string; image?: string | null; generating?: boolean; failed?: boolean; locked?: boolean }
function AuditAds({ domain }: { domain: string }) {
  const [tpls, setTpls] = useState<Tpl[] | null>(null)
  const [kit, setKit] = useState<any>(null)
  const [products, setProducts] = useState<{ title: string; image: string | null }[]>([])
  const [needCredits, setNeedCredits] = useState(false)
  const kicked = useRef(false)

  useEffect(() => {
    if (!domain) return
    let on = true
    Promise.all([
      fetch(`/api/ads-studio/templates?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch(`/api/ads-studio/brand-kit?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/ads-studio/products?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).catch(() => ({ products: [] })),
    ]).then(([t, k, p]) => {
      if (!on) return
      setTpls((Array.isArray(t.templates) ? t.templates : []).slice(0, 10).map((x: any) => ({ ...x })))
      setKit(k && !k.empty ? k : null)
      setProducts(Array.isArray(p.products) ? p.products.map((x: any) => ({ title: x.title || '', image: x.image || (x.images || [])[0] || null })) : [])
    })
    return () => { on = false }
  }, [domain])

  const withImg = products.filter((p) => p.image)
  const productFor = (i: number): string | undefined => {
    const t = tpls?.[i]
    if (!t || withImg.length <= 1) return withImg[0]?.image ?? undefined
    const text = `${t.title} ${t.headline || ''} ${t.angle || ''}`.toLowerCase()
    let best: { image: string | null; score: number } | null = null
    for (const p of withImg) {
      const words = (p.title || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 4)
      const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0)
      if (score > 0 && (!best || score > best.score)) best = { image: p.image, score }
    }
    return best?.image ?? withImg[0]?.image ?? undefined
  }
  const genOne = async (i: number) => {
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: true, failed: false } : x))
    const prod = productFor(i)
    const body = { domain, index: i, productImages: prod ? [prod] : [], colors: (kit?.colors || []).map((c: any) => c.hex), fonts: kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined, logo: kit?.logo || undefined, brandName: kit?.siteName, productDesc: (kit?.facts || [])[0] }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('/api/ads-studio/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const d = await r.json().catch(() => ({}))
        if (d.image) { setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, image: d.image, generating: false, failed: false, locked: false } : x)); return }
        // Out of free credits → send them to the upgrade wall (agreement → payment). Paid users see the note.
        if (r.status === 402 || d.error === 'insufficient_credits') { setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: false, locked: true } : x)); if (!(await requireUpgrade())) setNeedCredits(true); return }
      } catch { /* retry */ }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000))
    }
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: false, failed: true } : x))
  }

  // Auto-render the FIRST 5 (free) — 2 at a time. The other 5 wait for a tap (they cost credits).
  useEffect(() => {
    if (kicked.current || !tpls || !kit) return
    const todo = tpls.slice(0, FREE).map((t, i) => ({ t, i })).filter(({ t }) => !t.image)
    if (!todo.length) return
    kicked.current = true
    let cursor = 0
    const worker = async () => { while (cursor < todo.length) await genOne(todo[cursor++].i) }
    worker(); worker()
  }, [tpls, kit])   // eslint-disable-line react-hooks/exhaustive-deps

  if (tpls !== null && tpls.length === 0) return null
  const cards = tpls || Array.from({ length: 10 }, () => null)
  return (
    <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'center' }}>
      <style>{`@keyframes sfspin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: 1100, width: '100%' }}>
        <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>The ads we made you</h2>
        <p style={{ fontSize: 15, color: SUB, margin: '0 0 20px', maxWidth: 640, lineHeight: 1.5 }}>Built from the winning DNA your rivals use, with your product. The first 5 are on us — tap <b style={{ color: '#fff' }}>Generate</b> on any of the others to make it with your credits.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(210px,100%),1fr))', gap: 16 }}>
          {cards.map((t, i) => {
            const paid = i >= FREE
            return (
              <div key={i} style={{ background: '#0f150f', border: `1px solid ${t?.image ? ORANGE + '55' : 'rgba(255,255,255,.12)'}`, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ position: 'relative', aspectRatio: '4 / 5', background: '#161d16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t?.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={t.image} alt={t.title || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : t?.generating ? (
                    <div style={{ textAlign: 'center', color: SUB }}>
                      <div style={{ width: 26, height: 26, border: '2.5px solid rgba(255,255,255,.2)', borderTopColor: ORANGE, borderRadius: '50%', margin: '0 auto 10px', animation: 'sfspin 0.8s linear infinite' }} />
                      <div style={{ fontSize: 12.5 }}>Rendering…</div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,.5)', marginBottom: 8 }}>{t?.title || `Concept ${i + 1}`}</div>
                      {t?.failed ? (
                        <button onClick={() => genOne(i)} style={genBtn}>↻ Retry</button>
                      ) : paid ? (
                        <button onClick={() => genOne(i)} style={genBtn}>Generate →</button>
                      ) : (
                        <div style={{ fontSize: 12, color: SUB }}>Queued…</div>
                      )}
                      {paid && !t?.failed && <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 8 }}>uses your credits</div>}
                    </div>
                  )}
                  <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 9.5, fontWeight: 800, letterSpacing: '.14em', color: '#fff', background: paid ? 'rgba(0,0,0,.5)' : ORANGE, borderRadius: 100, padding: '3px 9px' }}>{paid ? 'CREDITS' : 'FREE'}</span>
                </div>
                <div style={{ padding: '11px 13px 13px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{t?.headline || t?.title || `Ad concept ${i + 1}`}</div>
                  {t?.title && <div style={{ fontSize: 11.5, color: SUB, marginTop: 3 }}>{t.title}</div>}
                </div>
              </div>
            )
          })}
        </div>
        {needCredits && <div style={{ marginTop: 14, fontSize: 13, color: SUB }}>Out of credits for the extra renders — <a href="/pricing" style={{ color: '#fff', fontWeight: 700 }}>top up</a> to make the rest.</div>}
      </div>
    </div>
  )
}
const genBtn: React.CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }
