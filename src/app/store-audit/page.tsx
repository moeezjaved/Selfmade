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

const FOREST = '#141d15', ORANGE = '#ff5a2c', PAPER = '#e9e1cf', INK = '#22281b', SUB = 'rgba(255,255,255,.82)'
// Brand-orange treatment for the input screen (matches the landing's accent; no more off-brand green).
const ORANGE_BG = 'linear-gradient(162deg,#ff6a3d 0%,#e8431a 100%)'
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

export default function StoreAuditPage() {
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

      {/* Email gate → then CTA. Both theaters' own CTAs are suppressed in embedded mode. */}
      {seoDone && (
        <div ref={ctaRef} style={{ padding: '48px 24px 90px', display: 'flex', justifyContent: 'center' }}>
          {!captured
            ? <EmailGate domain={started.domain} adsData={adsData} seoData={seoData} onDone={() => setCaptured(true)} />
            : (
              <div style={{ maxWidth: 620, width: '100%', background: '#0f150f', border: `1px solid ${ORANGE}44`, borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>Your report is on its way ✉️</div>
                <div style={{ fontSize: 14.5, color: SUB, marginTop: 12, lineHeight: 1.55 }}>
                  We just emailed your full audit and the ads we made you. Create your free account to claim them — Selfmade&rsquo;s AI marketing team makes the moves, you approve each one.
                </div>
                <a href="/signup?ref=store-audit" style={{ display: 'inline-block', marginTop: 20, background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 15.5, padding: '15px 34px', borderRadius: 3, textDecoration: 'none' }}>
                  Claim my ads — hire the team →
                </a>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 12 }}>Free to start · you approve every move · cancel anytime</div>
              </div>
            )}
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

  const field: React.CSSProperties = { width: '100%', padding: '15px 16px', fontSize: 15.5, borderRadius: 8, border: '1.5px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.16)', color: '#fff', outline: 'none', fontFamily: 'inherit' }
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)', marginBottom: 8, display: 'block' }
  const ResultList = ({ rows, onPick }: { rows: BrandRow[]; onPick: (r: BrandRow) => void }) => (
    rows.length ? (
      <div style={{ marginTop: 6, background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.18)' }}>
        {rows.map(r => (
          <button key={r.pageId} onClick={() => onPick(r)} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', borderTop: '1px solid rgba(0,0,0,.06)', color: INK, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontSize: 11.5, color: 'rgba(0,0,0,.45)' }}>{r.adCount ? `${r.adCount.toLocaleString()} ads` : ''}{r.crawled ? ' · ready' : ''}</span>
          </button>
        ))}
      </div>
    ) : null
  )
  const Chip = ({ name, onClear }: { name: string; onClear: () => void }) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.5)', color: '#fff', borderRadius: 100, padding: '7px 8px 7px 14px', fontSize: 14, fontWeight: 600 }}>
      {name}<button onClick={onClear} style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.3)', color: '#fff', cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: ORANGE_BG, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      {/* white placeholders so they read on the orange fields */}
      <style>{`input::placeholder{color:rgba(255,255,255,.72)}`}</style>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={{ fontSize: 13, fontStyle: 'italic', color: '#fff', fontFamily: SERIF, opacity: .9 }}>free · one scan · no login</div>
        <h1 style={{ fontFamily: SERIF, fontSize: 46, fontWeight: 700, lineHeight: 1.02, margin: '10px 0 12px', letterSpacing: '-.02em' }}>Audit your whole store.</h1>
        <p style={{ fontSize: 15.5, color: SUB, lineHeight: 1.55, marginBottom: 26 }}>Your ads and your search &amp; AI visibility — one scan, one report. See where you stand on Facebook, Google, and ChatGPT/Gemini, and where rivals are winning.</p>

        <label style={label}>Your store website</label>
        <input value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="yourstore.com" autoFocus style={field} />

        <div style={{ height: 18 }} />
        <label style={label}>Your ads</label>
        {brand ? <Chip name={brand.name} onClear={() => { setBrand(null); setBrandQ('') }} /> : showLink ? (
          <div>
            <input value={adLink} onChange={e => setAdLink(e.target.value)} placeholder="Paste your Facebook Ad Library link" style={field} />
            <button onClick={() => { setShowLink(false); setAdLink('') }} style={linkBtn}>← search my brand instead</button>
          </div>
        ) : (
          <div>
            <input value={brandQ} onChange={e => setBrandQ(e.target.value)} placeholder="Search your brand name…" style={field} />
            <ResultList rows={brandResults} onPick={(r) => { setBrand({ pageId: r.pageId, name: r.name }); setBrandResults([]) }} />
            <button onClick={() => setShowLink(true)} style={linkBtn}>or paste your Facebook Ad Library link →</button>
          </div>
        )}

        <div style={{ height: 18 }} />
        <label style={label}>Top competitor <span style={{ textTransform: 'none', fontWeight: 600, color: 'rgba(255,255,255,.45)' }}>· optional</span></label>
        {comp ? <Chip name={comp.name} onClear={() => { setComp(null); setCompQ('') }} /> : (
          <div>
            <input value={compQ} onChange={e => setCompQ(e.target.value)} placeholder="Search a rival brand…" style={field} />
            <ResultList rows={compResults} onPick={(r) => { setComp({ pageId: r.pageId, name: r.name }); setCompResults([]) }} />
            <input value={rival} onChange={e => setRival(e.target.value)} placeholder="…or their website for the search head-to-head — e.g. rival.com" style={{ ...field, marginTop: 8, fontSize: 14 }} />
          </div>
        )}

        {error && <div style={{ marginTop: 16, background: '#3a1a12', border: '1px solid #7a3', borderColor: '#a5462c', color: '#ffd9cc', borderRadius: 8, padding: '11px 14px', fontSize: 13.5 }}>{error}</div>}

        <button onClick={submit} style={{ marginTop: 22, width: '100%', background: '#fff', color: '#e8431a', fontWeight: 800, fontSize: 16, padding: '16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>Scan my store →</button>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.72)', marginTop: 14, lineHeight: 1.5 }}>Reads only what&rsquo;s public — no account, no card. Competitor optional; we&rsquo;ll pick a real one if you skip it.</div>

        {/* Just starting out — no store yet. The audit needs a live site to read, so send them to build one. */}
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,.25)', fontSize: 13.5, color: 'rgba(255,255,255,.9)', lineHeight: 1.5 }}>
          No website yet — just starting out?{' '}
          <a href="/signup?ref=store-audit-new" style={{ color: '#fff', fontWeight: 800, textDecoration: 'underline' }}>Build your store with Selfmade →</a>
        </div>
      </div>
    </div>
  )
}

const linkBtn: React.CSSProperties = { marginTop: 8, background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline', opacity: .92 }

/* Email gate — unlocks the full report + emails it (and starts the nurture drip). Built from the two
 * theaters' real result data so the email is personalised (revenue-at-stake, top leak, rival formula). */
function EmailGate({ domain, adsData, seoData, onDone }: { domain: string; adsData: any; seoData: any; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const buildReport = () => {
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

  const submit = async () => {
    const e = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/audit/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, domain, brandName: adsData?.brand?.name || seoData?.siteName, report: buildReport() }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j?.error === 'valid_email_required' ? 'Enter a valid email.' : 'Something went wrong — try again.'); setBusy(false); return }
      onDone()
    } catch { setErr('Network error — try again.'); setBusy(false) }
  }

  const lost = seoData?.revenueLostPerYear && seoData.revenueLostPerYear > 0
    ? `${seoData.currency || '$'}${Math.round(seoData.revenueLostPerYear).toLocaleString()}/yr` : null

  return (
    <div style={{ maxWidth: 560, width: '100%', background: '#0f150f', border: `1px solid ${ORANGE}55`, borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontStyle: 'italic', color: ORANGE, fontFamily: SERIF }}>your full report is ready</div>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1.1, marginTop: 8 }}>See everything — and the ads we made you.</div>
      <div style={{ fontSize: 14.5, color: SUB, marginTop: 12, lineHeight: 1.55 }}>
        {lost ? <>You&rsquo;re leaving about <b style={{ color: '#fff' }}>{lost}</b> on the table. </> : null}
        Enter your email and we&rsquo;ll send your full audit plus the ads we generated from your rivals&rsquo; winning DNA — free.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
        <input value={email} onChange={(ev) => setEmail(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && submit()} placeholder="you@store.com" autoFocus
          style={{ flex: 1, minWidth: 200, padding: '14px 16px', fontSize: 15.5, borderRadius: 8, border: '1.5px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)', color: '#fff', outline: 'none', fontFamily: 'inherit' }} />
        <button onClick={submit} disabled={busy} style={{ background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 15.5, padding: '14px 24px', borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap' }}>{busy ? 'Sending…' : 'Send my report →'}</button>
      </div>
      {err && <div style={{ fontSize: 13, color: '#ffb37a', marginTop: 10 }}>{err}</div>}
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 12 }}>No spam · unsubscribe anytime · we never share your email.</div>
    </div>
  )
}
