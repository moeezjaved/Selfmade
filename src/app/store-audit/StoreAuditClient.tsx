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
    try { document.cookie = `sf_scan_domain=${encodeURIComponent(started.domain)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax` } catch { /* ignore */ }
    fetch('/api/audit/lead', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: started.domain, brandName: adsData?.brand?.name || seoData?.siteName, report: buildReport(adsData, seoData), adUrls: [] }),
    }).catch(() => {})
  }, [seoDone])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) return <InputScreen onStart={setStarted} />

  return (
    <div style={{ background: FOREST, minHeight: '100dvh' }}>
      {/* Act 1 — your ads. Its own crawl-wait gate decides when ads are ready; onDone fires only then. */}
      <ScanTheater embedded seed={started.seed} onDone={(d: any) => { setAdsData(d); setAdsDone(true) }} />

      {/* Act 2 — your search & AI visibility. Mounts only after the ads act has truly finished. */}
      {adsDone && (
        <div ref={act2Ref}>
          <ActDivider n={2} label="Your search & AI visibility" />
          <AuditTheater embedded seedDomain={started.domain} seedRival={started.rival} onDone={(d: any) => { setSeoData(d); setSeoDone(true) }} />
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

  return (
    <div style={{ minHeight: '100dvh', background: '#fff', color: WINK, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`input::placeholder{color:${WSUB};opacity:.7}`}</style>
      <div style={{ width: '100%', maxWidth: 540 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: WORANGE, marginBottom: 12, textAlign: 'center' }}>{domain ? `Auditing ${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` : 'Free · one scan · saved to your account'}</div>
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
