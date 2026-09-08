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
// Light tokens (brand voice.ts) — the audit shell now matches the reveal + the restyled theaters.
const INK = '#161c17', SUBINK = '#5f665c', LINE = '#e6e5dc', PAPER = '#faf9f5'
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

  // Website-only scan (no brand/ad-library picked): skip the ads act and go straight to the SEO/AI audit.
  useEffect(() => { if (started && !(started.seed?.pageId || started.seed?.adLibraryUrl)) setAdsDone(true) }, [started])

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
    // Resolve a REAL brand name — never a stray/generic token (that's how "Brand saved: new" happened).
    // Prefer the detected brand/site name; if it's blank or a junk word, Title-Case the domain root.
    const norm = (s: string) => (s || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
    const titleCase = (s: string) => s.replace(/[-_.]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
    const JUNK_NAME = /^(new|home|shop|store|the|page|untitled|brand|website|default|index|main)$/i
    const rawName = String(adsData?.brand?.name || seoData?.siteName || '').trim()
    const brandName = (rawName.length >= 2 && !JUNK_NAME.test(rawName)) ? rawName.slice(0, 80) : titleCase(norm(dom).replace(/\.[a-z.]+$/, ''))
    try { document.cookie = `sf_scan_domain=${encodeURIComponent(dom)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax` } catch { /* ignore */ }
    fetch('/api/audit/lead', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: dom, brandName, report: buildReport(adsData, seoData), adUrls: [] }),
    }).catch(() => {})
    // Ensure a brand exists for THIS store so we can render the real ads (and the audit carries over).
    // This REPLACES onboarding: stamp their Meta Ad Library page (own-ads audit) + follow the competitor
    // they picked, and mark them onboarded (the /api/audit/lead call above sets onboarding_completed).
    ;(async () => {
      const seed = started.seed || {}
      try {
        const list = await fetch('/api/brands', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ brands: [] }))
        let bid: string | null = ((list.brands || []).find((b: any) => norm(b.website) === norm(dom)) || null)?.id || null
        if (!bid) {
          const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: brandName, website: dom, brand_kit: seed.pageId ? { ownMetaPageId: seed.pageId } : {} }) })
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
    <div style={{ background: PAPER, minHeight: '100dvh' }}>
      {/* THE LIVE SCAN — the theaters run so the visitor watches their store get read (ads, then search &
          AI). We keep this "watching it work" moment, then REPLACE it with the clean campaign result the
          instant the scan finishes + the brand is saved (no verbose theater output lingers). */}
      {!seoDone && (
        <>
          {(started.seed.pageId || started.seed.adLibraryUrl) && (
            <ScanTheater embedded seed={started.seed} domain={started.domain} onDone={(d: any) => { setAdsData(d); setAdsDone(true) }} onError={() => { setAdsData(null); setAdsDone(true) }} />
          )}
          {adsDone && (
            <div ref={act2Ref}>
              <ActDivider n={(started.seed.pageId || started.seed.adLibraryUrl) ? 2 : 1} label="Your search & AI visibility" />
              <AuditTheater embedded seedDomain={started.domain} seedRival={started.rival} onDone={(d: any) => { setSeoData(d); setSeoDone(true) }} />
            </div>
          )}
        </>
      )}

      {/* ✨ THE RESULT — the clean campaign reveal (ad + the landing page it opens, side by side; the cost
          framing; a condensed audit summary). Shown once scanning is done AND the brand is saved. */}
      {seoDone && brandId && (
        <div ref={ctaRef}><CampaignReveal domain={started.domain} adsData={adsData} seoData={seoData} /></div>
      )}
      {seoDone && !brandId && !atCap && (
        <div style={{ padding: '90px 24px', textAlign: 'center', color: SUBINK, fontFamily: SERIF, fontSize: 24 }}>Assembling your campaign…</div>
      )}
      {seoDone && atCap && (
        <div style={{ padding: '60px 24px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ maxWidth: 620, width: '100%', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '24px', textAlign: 'center', color: SUBINK, fontSize: 14 }}>
            You&rsquo;re at your plan&rsquo;s brand limit, so we couldn&rsquo;t add this store. <a href="/pricing" style={{ color: ORANGE, fontWeight: 800 }}>Upgrade to add it</a> and we&rsquo;ll build your campaign.
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
        <span style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: INK }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: LINE }} />
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
    }
    // No ads is fine — a store owner with only a website still gets the full search & AI-visibility audit.
    // seed stays {} and the ads act is skipped downstream.
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
        <label style={label}>Your ads <span style={{ fontWeight: 500, color: WSUB }}>· optional</span></label>
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
type Tpl = { title: string; concept?: string; headline?: string; angle?: string; image?: string | null; hasProduct?: boolean; generating?: boolean; failed?: boolean; locked?: boolean }
function AuditAds({ domain, headline, pane }: { domain: string; headline?: boolean; pane?: boolean }) {
  const [tpls, setTpls] = useState<Tpl[] | null>(null)
  const [kit, setKit] = useState<any>(null)
  const [products, setProducts] = useState<{ title: string; image: string | null }[]>([])
  const [productsReady, setProductsReady] = useState(false)   // catalog crawl finished (empty ⇒ service/SaaS, not "still loading")
  const [needCredits, setNeedCredits] = useState(false)
  const [idx, setIdx] = useState(0)   // which of the 5 free ads is open in the carousel
  const kicked = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  // Auto-scroll to the reveal the moment the first real ad lands — make it the moment you can't miss.
  useEffect(() => {
    if (scrolled.current || !tpls || !headline) return
    if (tpls.slice(0, FREE).some((t) => t.image)) { scrolled.current = true; rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  }, [tpls, headline])
  const doneCount = (tpls || []).slice(0, FREE).filter((t) => t.image).length

  useEffect(() => {
    if (!domain) return
    let on = true
    const enc = encodeURIComponent(domain)
    // Concepts + kit load fast.
    Promise.all([
      fetch(`/api/ads-studio/templates?domain=${enc}`).then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch(`/api/ads-studio/brand-kit?domain=${enc}`).then((r) => r.json()).catch(() => null),
    ]).then(([t, k]) => {
      if (!on) return
      // 10 concepts: the first 5 auto-render FREE, the other 5 are offered as a "make more" upsell that
      // spends the founder's credits (genOne handles the paid/402 path). We only ever AUTO-render the 5 free.
      setTpls((Array.isArray(t.templates) ? t.templates : []).slice(0, 10).map((x: any) => ({ ...x })))
      setKit(k && !k.empty ? k : null)
    })
    // The ads MUST use the store's REAL product photos. Read the cached catalog first; if it comes back
    // without images (fresh brand / stale-empty cache), FORCE a live crawl so we always get real products.
    ;(async () => {
      const read = (force?: boolean) => fetch(`/api/ads-studio/products?domain=${enc}${force ? '&force=1' : ''}`).then((r) => r.json()).catch(() => ({ products: [] }))
      let p = await read()
      const hasImg = (x: any) => Array.isArray(x.products) && x.products.some((q: any) => q.image || (q.images || [])[0])
      if (on && !hasImg(p)) p = await read(true)
      if (!on) return
      setProducts(Array.isArray(p.products) ? p.products.map((x: any) => ({ title: x.title || '', image: x.image || (x.images || [])[0] || null })) : [])
      setProductsReady(true)   // crawl done — even if empty (a service/SaaS site with no product catalog)
    })()
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
  const genOne = async (i: number, force?: boolean) => {
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: true, failed: false } : x))
    const prod = productFor(i)
    const body = { domain, index: i, force: !!force, productImages: prod ? [prod] : [], colors: (kit?.colors || []).map((c: any) => c.hex), fonts: kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined, logo: kit?.logo || undefined, brandName: kit?.siteName, productDesc: (kit?.facts || [])[0] }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('/api/ads-studio/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const d = await r.json().catch(() => ({}))
        if (d.image) { setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, image: d.image, hasProduct: !!prod, generating: false, failed: false, locked: false } : x)); return }
        // Out of free credits → send them to the upgrade wall (agreement → payment). Paid users see the note.
        if (r.status === 402 || d.error === 'insufficient_credits') { setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: false, locked: true } : x)); if (!(await requireUpgrade())) setNeedCredits(true); return }
      } catch { /* retry */ }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000))
    }
    setTpls((prev) => prev && prev.map((x, j) => j === i ? { ...x, generating: false, failed: true } : x))
  }

  // Auto-render the FIRST 5 (free) — 2 at a time — once we have the concepts AND the catalog crawl has
  // FINISHED. We wait for `productsReady` (not just "has a photo") so we can tell the store's TYPE:
  //  • products found  → PHYSICAL store: the ad shows the store's real product (never a fabricated one).
  //  • none found      → SERVICE / SaaS / app: no physical product exists, so we render a concept-led ad
  //    (the render engine auto-detects the empty-product case). The brand-kit stays optional.
  useEffect(() => {
    if (kicked.current || !tpls || !productsReady) return
    // Render ads with no image yet, PLUS regenerate any free ad that was cached WITHOUT the real product
    // back when the catalog crawl came up empty (pre product-crawler fix) — now that we have products, we
    // force a one-time (server-side FREE) re-render so the store's real product actually appears in the ad.
    const withProducts = products.some((p) => p.image)
    const todo = tpls.slice(0, FREE).map((t, i) => ({ t, i })).filter(({ t }) => !t.image || (withProducts && !t.hasProduct))
    if (!todo.length) return
    kicked.current = true
    let cursor = 0
    const worker = async () => { while (cursor < todo.length) { const { t, i } = todo[cursor++]; await genOne(i, !!t.image) } }
    worker(); worker()
  }, [tpls, productsReady])   // eslint-disable-line react-hooks/exhaustive-deps

  if (tpls !== null && tpls.length === 0) return null
  const cards = tpls || Array.from({ length: FREE }, () => null)
  const free = cards.slice(0, FREE)
  const paidCards = cards.slice(FREE)                 // the 5 credit-upsell concepts (may be empty)
  const cur = free[Math.min(idx, FREE - 1)] || null
  const allReady = doneCount >= FREE
  const go = (d: number) => setIdx((i) => (i + d + FREE) % FREE)

  // White reveal band — deliberately breaks out of the dark audit page so it reads as THE moment.
  const INK = '#161c17', LINE = '#e6e5dc', SUBINK = '#5f665c'
  const MONO = "'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace"
  const arrow = (side: 'left' | 'right'): React.CSSProperties => ({ position: 'absolute', top: '50%', [side]: 8, transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: `1px solid ${LINE}`, background: 'rgba(255,255,255,.95)', color: INK, fontSize: 21, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px -8px rgba(20,29,21,.55)', fontFamily: 'inherit' })

  // The browseable 5-ad carousel — shared by the standalone reveal and the side-by-side CampaignReveal pane.
  const carousel = (
    <div style={{ maxWidth: pane ? 460 : 360, margin: '0 auto', width: '100%' }}>
      <style>{`@keyframes sfspin{to{transform:rotate(360deg)}}@keyframes sfrise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}.sfrev-slide{animation:sfrise .34s ease both}`}</style>
      <div style={{ position: 'relative', aspectRatio: '4 / 5', background: '#f4f4ef', border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {cur?.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={cur.image} src={cur.image} alt={cur.title || ''} className="sfrev-slide" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : cur?.failed ? (
          <button onClick={() => genOne(idx)} style={genBtn}>↻ Retry</button>
        ) : (
          <div style={{ textAlign: 'center', color: SUBINK }}>
            <div style={{ width: 26, height: 26, border: '2.5px solid rgba(20,29,21,.14)', borderTopColor: ORANGE, borderRadius: '50%', margin: '0 auto 10px', animation: 'sfspin .8s linear infinite' }} />
            <div style={{ fontSize: 12.5, fontFamily: MONO }}>Rendering ad {idx + 1}…</div>
          </div>
        )}
        <span style={{ position: 'absolute', top: 12, left: 12, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '.14em', color: '#fff', background: ORANGE, borderRadius: 100, padding: '3px 10px' }}>FREE</span>
        <button aria-label="Previous ad" onClick={() => go(-1)} style={arrow('left')}>&lsaquo;</button>
        <button aria-label="Next ad" onClick={() => go(1)} style={arrow('right')}>&rsaquo;</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {free.map((t, i) => (
          <button key={i} onClick={() => setIdx(i)} aria-label={`Ad ${i + 1}`} style={{ width: 44, height: 55, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer', border: i === idx ? `2px solid ${ORANGE}` : `1px solid ${LINE}`, background: '#f4f4ef', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {t?.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={t.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : <span style={{ fontFamily: MONO, fontSize: 10, color: SUBINK }}>{i + 1}</span>}
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 14, minHeight: 44 }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{cur?.headline || cur?.title || `Ad ${idx + 1}`}</div>
        {cur?.title && cur?.headline && <div style={{ fontSize: 12.5, color: SUBINK, marginTop: 4, fontFamily: MONO }}>{cur.title}</div>}
      </div>
    </div>
  )
  if (pane) return carousel

  return (
    <div ref={rootRef} style={{ padding: headline ? '40px 20px 14px' : '20px 24px 0', display: 'flex', justifyContent: 'center' }}>
      <style>{`
        @keyframes sfspin{to{transform:rotate(360deg)}}
        @keyframes sfrise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        .sfrev-slide{animation:sfrise .34s ease both}
        @media (prefers-reduced-motion: reduce){.sfrev,.sfrev-slide{animation:none!important}}
      `}</style>
      <div className="sfrev" style={{ maxWidth: 760, width: '100%', background: '#fff', color: INK, border: `1px solid ${LINE}`, borderRadius: 22, padding: 'clamp(22px,4vw,40px)', boxShadow: '0 26px 64px -34px rgba(20,29,21,.5)', fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", animation: headline ? 'sfrise .5s ease both' : undefined }}>

        {/* brand mark + live build progress (real render count = the "we're building it" feel) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <svg viewBox="0 0 100 100" width="24" height="24" aria-hidden style={{ flex: '0 0 auto' }}>
            <g stroke={ORANGE} strokeWidth="18" strokeLinecap="round"><line x1="34" y1="22" x2="18" y2="50" /><line x1="66" y1="22" x2="82" y2="50" /><line x1="34" y1="78" x2="66" y2="78" /></g>
            <g fill={ORANGE}><circle cx="34" cy="22" r="15" /><circle cx="66" cy="22" r="15" /><circle cx="82" cy="50" r="15" /><circle cx="66" cy="78" r="15" /><circle cx="34" cy="78" r="15" /><circle cx="18" cy="50" r="15" /></g>
          </svg>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', textTransform: 'uppercase', color: allReady ? '#2f7d32' : SUBINK }}>
            {allReady ? '● Campaign ready' : `Building your campaign · ${doneCount}/${FREE} ads rendered`}
          </span>
        </div>

        <h2 style={{ fontFamily: SERIF, fontSize: headline ? 'clamp(30px,5vw,50px)' : 30, fontWeight: 400, lineHeight: 1.02, letterSpacing: '-.01em', margin: '0 0 10px' }}>We already built your next campaign.</h2>
        <p style={{ fontSize: 15.5, color: SUBINK, lineHeight: 1.5, margin: '0 0 4px', maxWidth: 560 }}>Five ads, drawn from the winning DNA your rivals run — rendered live on <b style={{ color: INK }}>your real product</b>. Not mockups. Ready to launch.</p>

        {/* value line */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, margin: '18px 0 26px', fontFamily: MONO, fontSize: 12.5, background: '#f3f6ec', border: '1px solid #d3e6b8', borderRadius: 100, padding: '8px 16px' }}>
          <span style={{ color: SUBINK, textDecoration: 'line-through' }}>~$500 in ad creative</span>
          <span style={{ color: ORANGE, fontWeight: 700 }}>→ yours, on us</span>
        </div>

        {/* ── the 5 real ads, browseable ── */}
        {carousel}

        {/* ── make 5 more, from your credits ── */}
        {paidCards.length > 0 && (
          <div style={{ marginTop: 30, borderTop: `1px solid ${LINE}`, paddingTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ fontFamily: SERIF, fontSize: 22 }}>Want {paidCards.length} more? They&rsquo;re queued.</div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: SUBINK }}>uses your credits</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(140px,100%),1fr))', gap: 12 }}>
              {paidCards.map((t, k) => {
                const i = FREE + k
                return (
                  <div key={i} style={{ position: 'relative', aspectRatio: '4 / 5', borderRadius: 14, overflow: 'hidden', border: `1.5px dashed ${t?.image ? ORANGE + '88' : '#cdccc3'}`, background: '#faf9f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center' }}>
                    {t?.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={t.image} alt={t.title || ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : t?.generating ? (
                      <div style={{ width: 22, height: 22, border: '2.5px solid rgba(20,29,21,.14)', borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .8s linear infinite' }} />
                    ) : (
                      <div>
                        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', color: SUBINK, marginBottom: 8 }}>{t?.title || `Concept ${i + 1}`}</div>
                        <button onClick={() => genOne(i)} style={genBtn}>{t?.failed ? '↻ Retry' : 'Generate →'}</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {needCredits && <div style={{ marginTop: 14, fontSize: 13, color: SUBINK }}>Out of credits for the extra renders — <a href="/pricing" style={{ color: ORANGE, fontWeight: 700 }}>top up</a> to make the rest.</div>}
      </div>
    </div>
  )
}
const genBtn: React.CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }

/* ── THE PAGE IT OPENS — the landing page half of the reveal ──
 * We generate a REAL page with the builder (advertorial / listicle / product), using the store's real
 * product photo but NO paid AI images (noAiImages) so it's FREE — the visitor upgrades to AI imagery with
 * credits after they join. Each page is saved as a draft they can open + edit in the builder. Shown in a
 * scrollable browser frame, connected to the ad above ("↑ opens the page"), with 3 designs to flip. */
const LP_DESIGNS = [
  { id: 'advertorial_v1', label: 'Advertorial' },
  { id: 'listicle_v1', label: 'Listicle' },
  { id: 'product_v1', label: 'Product page' },
] as const
type LpState = { html?: string; pageId?: string; generating?: boolean; failed?: boolean }

function LandingPageReveal({ domain, pane }: { domain: string; pane?: boolean }) {
  const [designs, setDesigns] = useState<Record<string, LpState>>({})
  const [active, setActive] = useState(0)
  const [product, setProduct] = useState<{ title: string; image: string | null; price: string | null } | null>(null)
  const [ready, setReady] = useState(false)
  const genStarted = useRef<Set<string>>(new Set())   // dedup: one generation per design id (ref, not stale state)
  const INK2 = '#161c17', SUBINK2 = '#5f665c', LINE2 = '#e6e5dc'
  const MONO = "'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace"
  const host = domain.replace(/^www\./, '')

  // Load the store's top product so the page features a real product photo + name.
  useEffect(() => {
    let on = true
    fetch(`/api/ads-studio/products?domain=${encodeURIComponent(domain)}`).then((r) => r.json()).then((p) => {
      if (!on) return
      const withImg = (p.products || []).filter((x: any) => x.image || (x.images || [])[0])
      const t = withImg[0]
      setProduct(t ? { title: t.title || 'Product', image: t.image || (t.images || [])[0] || null, price: t.price || null } : null)
      setReady(true)
    }).catch(() => { if (on) setReady(true) })
    return () => { on = false }
  }, [domain])

  const gen = async (i: number) => {
    const d = LP_DESIGNS[i]
    if (genStarted.current.has(d.id)) return   // already generating or generated
    genStarted.current.add(d.id)
    setDesigns((prev) => ({ ...prev, [d.id]: { generating: true } }))
    const importedProduct = product ? { title: product.title, image: product.image, images: product.image ? [product.image] : [], price: product.price || undefined, sourceUrl: `https://${host}` } : null
    try {
      const r = await fetch('/api/builder/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: d.id, noAiImages: true, importedProduct }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.previewHtml) { setDesigns((prev) => ({ ...prev, [d.id]: { html: j.previewHtml, pageId: j.pageId } })); return }
      genStarted.current.delete(d.id); setDesigns((prev) => ({ ...prev, [d.id]: { failed: true } }))   // allow retry
    } catch { genStarted.current.delete(d.id); setDesigns((prev) => ({ ...prev, [d.id]: { failed: true } })) }
  }

  // Build the active design once the product crawl is ready (active starts at 0 → first design), and build
  // each other design the first time it's flipped to. The ref guard makes this idempotent.
  useEffect(() => { if (ready) gen(active) }, [active, ready])   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = designs[LP_DESIGNS[active].id]
  const go = (dir: number) => setActive((a) => (a + dir + LP_DESIGNS.length) % LP_DESIGNS.length)

  // Browser frame + design flip — shared by the standalone section and the CampaignReveal pane.
  const frame = (
    <>
      <div style={{ border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${LINE2}`, background: '#f4f4ef' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#e3675b' }} /><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#e9b04e' }} /><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#5fb96a' }} />
          <div style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: SUBINK2, background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 100, padding: '3px 10px', maxWidth: 340, margin: '0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}/{LP_DESIGNS[active].id === 'product_v1' ? 'products/' : ''}{(product?.title || 'landing').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}</div>
        </div>
        <div style={{ position: 'relative', height: pane ? 560 : 520, background: '#faf9f5' }}>
          {cur?.html ? (
            <iframe title={`${LP_DESIGNS[active].label} landing page`} srcDoc={cur.html} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
          ) : cur?.failed ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: SUBINK2 }}>
              <div style={{ fontSize: 13.5 }}>Couldn&rsquo;t build this one.</div>
              <button onClick={() => { setDesigns((s) => { const n = { ...s }; delete n[LP_DESIGNS[active].id]; return n }); setTimeout(() => gen(active), 0) }} style={genBtn}>↻ Retry</button>
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: SUBINK2 }}>
              <div style={{ width: 26, height: 26, border: '2.5px solid rgba(20,29,21,.14)', borderTopColor: ORANGE, borderRadius: '50%', animation: 'sfspin .8s linear infinite' }} />
              <div style={{ fontSize: 12.5, fontFamily: MONO }}>Building your {LP_DESIGNS[active].label.toLowerCase()}…</div>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
        <button aria-label="Previous design" onClick={() => go(-1)} style={{ width: 34, height: 34, borderRadius: '50%', border: `1px solid ${LINE2}`, background: '#fff', color: INK2, fontSize: 19, cursor: 'pointer', fontFamily: 'inherit' }}>&lsaquo;</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {LP_DESIGNS.map((d, i) => (
            <button key={d.id} onClick={() => setActive(i)} aria-label={d.label} style={{ padding: '6px 12px', borderRadius: 100, border: i === active ? `1px solid ${ORANGE}` : `1px solid ${LINE2}`, background: i === active ? ORANGE : '#fff', color: i === active ? '#fff' : SUBINK2, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{d.label}</button>
          ))}
        </div>
        <button aria-label="Next design" onClick={() => go(1)} style={{ width: 34, height: 34, borderRadius: '50%', border: `1px solid ${LINE2}`, background: '#fff', color: INK2, fontSize: 19, cursor: 'pointer', fontFamily: 'inherit' }}>&rsaquo;</button>
      </div>
    </>
  )
  if (pane) return frame

  return (
    <div style={{ padding: '8px 20px 44px', display: 'flex', justifyContent: 'center', fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 760, width: '100%' }}>
        {/* connective thread from the ad above */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE }}>↑ opens the page</div>
        </div>
        <div style={{ background: '#fff', color: INK2, border: `1px solid ${LINE2}`, borderRadius: 22, padding: 'clamp(20px,4vw,34px)', boxShadow: '0 26px 64px -34px rgba(20,29,21,.5)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE }}>The page it opens</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: SUBINK2 }}>{active + 1} of {LP_DESIGNS.length} designs · {LP_DESIGNS[active].label}</div>
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(26px,4vw,40px)', fontWeight: 400, lineHeight: 1.05, margin: '0 0 14px' }}>A landing page, built to match.</h2>

          {frame}

          <div style={{ textAlign: 'center', marginTop: 14, fontFamily: MONO, fontSize: 12.5, color: INK2 }}>
            <span style={{ background: '#f3f6ec', border: '1px solid #d3e6b8', borderRadius: 100, padding: '7px 15px' }}><span style={{ color: SUBINK2, textDecoration: 'line-through' }}>~$2,000 page</span> <span style={{ color: ORANGE, fontWeight: 700 }}>→ built, yours</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── CAMPAIGN REVEAL — the CLEAN one-page result (the approved mockup) shown AFTER the live scan ──
 * The ad and the landing page it opens, side by side; the cost framing; the "5 more" upsell; and a
 * CONDENSED audit summary (4 tiles + top 3 problems) — instead of the verbose scanning theaters. */
function CampaignReveal({ domain, adsData, seoData }: { domain: string; adsData: any; seoData: any }) {
  const INK = '#161c17', SUBINK = '#5f665c', LINE = '#e6e5dc'
  const MONO = "'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace"
  const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  const host = domain.replace(/^www\./, '')
  const cur = seoData?.currency || '$'
  const revLost = Number(seoData?.revenueLostPerYear || 0)
  const sections: any[] = Array.isArray(seoData?.sections) ? seoData.sections : []
  const findings = sections.flatMap((s) => (s.findings || []).map((f: any) => ({ ...f, section: s.name })))
  const health = sections.find((s) => s.key === 'health')?.score ?? seoData?.score ?? null
  const aiScore = sections.find((s) => s.key === 'ai')?.score ?? null
  const sev = (f: any) => (f?.severity === 'high' ? 0 : f?.severity === 'medium' ? 1 : 2)
  const top3 = [...findings].sort((a, b) => sev(a) - sev(b)).slice(0, 3)
  const fmt = (n: number) => n.toLocaleString()
  void adsData

  const label = (t: string) => <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 12 }}>{t}</div>
  const tile = (cap: string, val: React.ReactNode, sub: string, bad?: boolean) => (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 18px' }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: SUBINK }}>{cap}</div>
      <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 400, lineHeight: 1, margin: '8px 0 6px', color: bad ? '#c23b12' : INK }}>{val}</div>
      <div style={{ fontSize: 12, color: SUBINK, lineHeight: 1.35 }}>{sub}</div>
    </div>
  )

  return (
    <div style={{ padding: '44px 20px 90px', display: 'flex', justifyContent: 'center', fontFamily: SANS, color: INK }}>
      <style>{`@keyframes sfspin{to{transform:rotate(360deg)}}@keyframes sfrise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ maxWidth: 1080, width: '100%', animation: 'sfrise .5s ease both' }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <svg viewBox="0 0 100 100" width="22" height="22" aria-hidden><g stroke={ORANGE} strokeWidth="18" strokeLinecap="round"><line x1="34" y1="22" x2="18" y2="50" /><line x1="66" y1="22" x2="82" y2="50" /><line x1="34" y1="78" x2="66" y2="78" /></g><g fill={ORANGE}><circle cx="34" cy="22" r="15" /><circle cx="66" cy="22" r="15" /><circle cx="82" cy="50" r="15" /><circle cx="66" cy="78" r="15" /><circle cx="34" cy="78" r="15" /><circle cx="18" cy="50" r="15" /></g></svg>
            <span style={{ fontFamily: SERIF, fontSize: 22 }}>Selfmade</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.1em', color: '#2f7d32', marginBottom: 14 }}>● Built from {host}</div>
          <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(34px,6vw,64px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-.01em', margin: '0 0 12px' }}>We already built your <span style={{ color: ORANGE, fontStyle: 'italic' }}>next campaign.</span></h1>
          <p style={{ fontSize: 16, color: SUBINK, lineHeight: 1.5, maxWidth: 560, margin: '0 auto' }}>Five scroll-stopping ads, and the landing page they open — made from your real product. No brief, no wait.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(20px,3vw,40px)', alignItems: 'start' }}>
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: 'clamp(18px,2.5vw,28px)', boxShadow: '0 26px 64px -40px rgba(20,29,21,.5)' }}>
            {label('01 · The ads we made')}
            <AuditAds domain={domain} pane />
          </div>
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: 'clamp(18px,2.5vw,28px)', boxShadow: '0 26px 64px -40px rgba(20,29,21,.5)' }}>
            {label('02 · The page it opens')}
            <LandingPageReveal domain={domain} pane />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20, alignItems: 'center', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 'clamp(20px,3vw,32px)', margin: '34px 0 0' }}>
          <div style={{ fontFamily: SERIF, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 400, lineHeight: 1.15 }}>A designer charges about <b>$2,000</b> for this page. An agency about <b>$500</b> for an ad. <span style={{ color: ORANGE, fontStyle: 'italic' }}>Yours is ready.</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: MONO, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', border: `1px solid ${LINE}`, borderRadius: 10 }}><span>Landing pages ×3</span><span><span style={{ color: SUBINK, textDecoration: 'line-through' }}>$2,000</span> <b style={{ color: '#2f7d32' }}>built</b></span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', border: `1px solid ${LINE}`, borderRadius: 10 }}><span>Ad creatives ×5</span><span><span style={{ color: SUBINK, textDecoration: 'line-through' }}>$500</span> <b style={{ color: '#2f7d32' }}>built</b></span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 10, background: '#f3f6ec', border: '1px solid #d3e6b8' }}><span>You paid</span><b style={{ color: ORANGE }}>$0</b></div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: '#faf9f5', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 22px', marginTop: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Want more angles? 5 more ads are ready to generate.</div>
            <div style={{ fontSize: 13, color: SUBINK }}>Spin up fresh variations from your competitors&rsquo; other winning ads — from your credits.</div>
          </div>
          <a href="/hq" style={{ background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 14.5, padding: '12px 22px', borderRadius: 100, textDecoration: 'none', whiteSpace: 'nowrap' }}>Make 5 more ads →</a>
        </div>

        <div style={{ marginTop: 48 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(24px,3.4vw,34px)', fontWeight: 400, margin: 0 }}>And here&rsquo;s what staying the same is costing you.</h2>
            {revLost > 0 && <div style={{ fontFamily: MONO, fontSize: 12, color: '#c23b12' }}>Revenue at stake · −{cur}{fmt(revLost)}/yr</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
            {tile('Revenue at stake', <>−{cur}{revLost >= 1000 ? (revLost / 1000).toFixed(1) + 'k' : fmt(revLost)}</>, 'per year, at current traffic', true)}
            {tile('Website health', health != null ? <>{health}<span style={{ fontSize: 16, color: SUBINK }}>/100</span></> : '—', 'meta, headings, alt text')}
            {tile('AI visibility', aiScore != null ? <>{aiScore}<span style={{ fontSize: 16, color: SUBINK }}>/100</span></> : '—', 'ChatGPT · Gemini · Perplexity')}
            {tile('Problems found', String(findings.length), 'across catalog & search')}
          </div>
          {top3.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {top3.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{f.title}{f.sub ? <span style={{ color: SUBINK, fontWeight: 400 }}> — {f.sub}</span> : ''}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: SUBINK, whiteSpace: 'nowrap' }}>{f.section}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 56 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(30px,4.6vw,48px)', fontWeight: 400, margin: '0 0 12px' }}>Now let&rsquo;s <span style={{ color: ORANGE, fontStyle: 'italic' }}>fix it</span> — together.</h2>
          <p style={{ fontSize: 15, color: SUBINK, maxWidth: 480, margin: '0 auto 22px', lineHeight: 1.5 }}>Your campaign is waiting in your dashboard. Edit any ad, tweak the page, and publish to Shopify in one click.</p>
          <a href="/hq" style={{ display: 'inline-block', background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 15.5, padding: '15px 34px', borderRadius: 3, textDecoration: 'none' }}>Open my dashboard →</a>
          <div style={{ fontSize: 12, color: SUBINK, marginTop: 14, fontFamily: MONO }}>Every image, headline &amp; price is editable · publish to Shopify in one click</div>
        </div>
      </div>
    </div>
  )
}
