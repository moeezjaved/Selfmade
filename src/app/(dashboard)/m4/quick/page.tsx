'use client'
/**
 * Quick Launch — the dead-simple way to put an ad live on Meta. We ask ONLY what's genuinely needed to run
 * ads, PRE-FILL everything we can (Facebook Page, destination URL, country) and GENERATE what we can
 * (the ad copy) so the founder mostly just confirms + sets a budget. Launches a single Advantage+
 * (auto-targeted) campaign via the SAME battle-tested /api/m4/launch engine — no interests to pick, no
 * pixel wrangling. The full 8-step wizard stays at /m4 as "Advanced".
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a', LINE = 'rgba(20,18,15,.12)', INSET = '#f7f6f4', ORANGE = '#e02f06', GOOD = '#12a150'
const SANS = 'Inter, system-ui, sans-serif'

type Creative = { id: string; image_url: string | null; media_type?: string | null; prompt?: string | null; brand_name?: string | null }
type Page = { id: string; name: string; website?: string; instagram?: { id: string } | null }

// Country name → Meta geo ISO-2 (the launch engine sends these as geo_locations.countries).
const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['PK', 'Pakistan'],
  ['IN', 'India'], ['AE', 'UAE'], ['SA', 'Saudi Arabia'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'],
  ['SE', 'Sweden'], ['ES', 'Spain'], ['IT', 'Italy'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['NG', 'Nigeria'],
  ['ZA', 'South Africa'], ['PH', 'Philippines'], ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'],
]
const toCode = (c?: string): string => {
  if (!c) return ''
  const s = c.trim(); if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  const hit = COUNTRIES.find(([, name]) => name.toLowerCase() === s.toLowerCase())
  return hit ? hit[0] : ''
}
const CTAS = ['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'GET_OFFER', 'BOOK_TRAVEL', 'SUBSCRIBE', 'CONTACT_US']

export default function QuickLaunch() {
  const [creatives, setCreatives] = useState<Creative[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [pageId, setPageId] = useState('')
  const [primaryText, setPrimaryText] = useState('')
  const [headline, setHeadline] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')
  const [url, setUrl] = useState('')
  const [country, setCountry] = useState('')
  const [budget, setBudget] = useState('10')
  const [prefilling, setPrefilling] = useState(true)
  const [busy, setBusy] = useState<'' | 'uploading' | 'launching'>('')
  const [result, setResult] = useState<{ ok: boolean; msg: string; note?: string; href?: string; hrefLabel?: string } | null>(null)
  const copyEdited = useRef(false)

  // Load creatives, the connected Page(s), and auto-detect the brand → pre-fill URL/country, then generate copy.
  useEffect(() => {
    // A specific creative can arrive via ?img=<url> (e.g. "Run on Facebook" from a single ad) — pre-select it,
    // injecting a synthetic entry when it isn't in the recent list so that exact ad is what gets launched.
    let wantImg = ''
    try { wantImg = new URLSearchParams(window.location.search).get('img') || '' } catch { /* SSR-safe */ }

    fetch('/api/creatives?limit=60').then((r) => r.json()).then((d) => {
      let list: Creative[] = (Array.isArray(d.creatives) ? d.creatives : []).filter((c: Creative) => c.image_url && c.media_type !== 'video')
      if (wantImg) {
        const hit = list.find((c) => c.image_url === wantImg)
        if (hit) { setPicked(hit.id) }
        else { const synth: Creative = { id: '_img', image_url: wantImg, media_type: 'image' }; list = [synth, ...list]; setPicked('_img') }
      }
      setCreatives(list)
    }).catch(() => { if (wantImg) { setCreatives([{ id: '_img', image_url: wantImg, media_type: 'image' }]); setPicked('_img') } else setCreatives([]) })

    fetch('/api/m4/pages').then((r) => r.json()).then((d) => {
      const ps: Page[] = Array.isArray(d.pages) ? d.pages : []
      setPages(ps)
      if (ps[0]) { setPageId(ps[0].id); if (ps[0].website && !url) setUrl(ps[0].website) }
    }).catch(() => {})

    ;(async () => {
      try {
        const d = await fetch('/api/m4/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json())
        if (d?.website && !url) setUrl(String(d.website))
        if (d?.country) setCountry(toCode(d.country) || '')
        // Generate the ad copy from what we detected — the founder can edit it.
        if (d?.product || d?.description) {
          const cp = await fetch('/api/m4/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: d.product || '', description: d.description || '', targetCustomer: d.targetCustomer || '', type: 'main', tone: 'benefit' }) }).then((r) => r.json()).catch(() => null)
          if (cp && !copyEdited.current) { if (cp.primaryText) setPrimaryText(cp.primaryText); if (cp.headline) setHeadline(cp.headline) }
        }
      } catch { /* prefill is best-effort */ }
      finally { setPrefilling(false) }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = creatives?.find((c) => c.id === picked) || null
  const page = pages.find((p) => p.id === pageId) || null
  const missing: string[] = []
  if (!chosen) missing.push('an ad')
  if (!pageId) missing.push('a Facebook Page')
  if (!url.trim()) missing.push('a destination URL')
  if (!headline.trim() || !primaryText.trim()) missing.push('ad copy')
  if (!country) missing.push('a country')
  const ready = missing.length === 0 && !busy

  const launch = async () => {
    if (!chosen?.image_url || !ready) return
    setResult(null)
    try {
      setBusy('uploading')
      const up = await fetch('/api/m4/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: chosen.image_url }) }).then((r) => r.json())
      if (!up?.hash) { setBusy(''); setResult({ ok: false, msg: up?.error || 'Couldn’t prepare that creative for Meta — try another.' }); return }

      setBusy('launching')
      const body = {
        campaignName: `Quick Launch — ${chosen.brand_name || 'Ad'}`,
        creatives: [{ id: chosen.id, name: chosen.brand_name || 'Your ad', pack: 1, type: 'image', hash: up.hash }],
        interests: [],                       // Advantage+ auto-targeting — no manual interests
        budget: String(parseFloat(budget) || 10),
        objective: 'OUTCOME_SALES',          // engine auto-downgrades to Traffic if the account has no Pixel
        pageId,
        instagramActorId: page?.instagram?.id || '',
        websiteUrl: url.trim(),
        headline: headline.trim().slice(0, 40),
        primaryText: primaryText.trim().slice(0, 300),
        cta,
        location: country || 'US',
      }
      const r = await fetch('/api/m4/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      setBusy('')
      if (!r.ok || d.error) {
        setResult({ ok: false, msg: d.error || 'Launch failed — try again.', href: d.needsReconnect ? '/settings' : (r.status === 402 ? '/upgrade' : d.tosUrl || undefined), hrefLabel: 'Fix it →' })
        return
      }
      setResult({ ok: true, msg: (d.broad_adsets || 0) ? `Your ad is set up on ${d.account || 'Meta'} — paused for your review.` : 'Campaign created — check your Meta account is ready to run ads.', note: d.note, href: '/reports', hrefLabel: 'Review & turn it on →' })
    } catch { setBusy(''); setResult({ ok: false, msg: 'Something went wrong — try again.' }) }
  }

  const label = (t: string) => <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginBottom: 6, fontWeight: 600 }}>{t}</span>
  const input: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 15, fontFamily: SANS, color: INK, background: '#fff', boxSizing: 'border-box' }
  const heading = (n: string, t: string) => <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, margin: '30px 0 12px' }}>{n} · {t}</div>

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 22px 70px', fontFamily: SANS, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }}>Launch an ad</h1>
          <p style={{ margin: '6px 0 0', color: SUB, fontSize: 14.5 }}>We pre-filled everything we could and wrote your copy — just confirm and set a budget. {prefilling && <span style={{ color: ORANGE, fontWeight: 700 }}>Setting things up…</span>}</p>
        </div>
      </div>

      {heading('1', 'Pick your ad')}
      {creatives === null ? <div style={{ color: FAINT, fontSize: 14 }}>Loading your creatives…</div>
        : creatives.length === 0 ? <div style={{ border: `1.5px dashed ${LINE}`, borderRadius: 14, padding: 24, textAlign: 'center', color: SUB, fontSize: 14 }}>No creatives yet. <Link href="/ads-workspace" style={{ color: ORANGE, fontWeight: 700 }}>Make an ad first →</Link></div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
            {creatives.map((c) => (
              <button key={c.id} onClick={() => setPicked(c.id)} style={{ position: 'relative', padding: 0, border: `2px solid ${c.id === picked ? ORANGE : LINE}`, borderRadius: 12, overflow: 'hidden', background: INSET, cursor: 'pointer', aspectRatio: '4/5' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {c.id === picked && <span style={{ position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>✓</span>}
              </button>
            ))}
          </div>
        )}

      {heading('2', 'Your ad copy')}
      <div style={{ display: 'grid', gap: 12 }}>
        <label>{label('Primary text (what people read)')}<textarea value={primaryText} onChange={(e) => { copyEdited.current = true; setPrimaryText(e.target.value) }} rows={3} placeholder={prefilling ? 'Writing your copy…' : 'Say why they should care…'} style={{ ...input, resize: 'vertical', lineHeight: 1.45 }} /></label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: 2, minWidth: 220 }}>{label('Headline (≤ 40 chars)')}<input value={headline} onChange={(e) => { copyEdited.current = true; setHeadline(e.target.value.slice(0, 40)) }} placeholder="One hard-hitting benefit" style={input} /></label>
          <label style={{ flex: 1, minWidth: 150 }}>{label('Button')}<select value={cta} onChange={(e) => setCta(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{CTAS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</option>)}</select></label>
        </div>
      </div>

      {heading('3', 'Where & who')}
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: 2, minWidth: 220 }}>{label('Facebook Page (ad posts from here)')}
            {pages.length === 0 ? <div style={{ ...input, color: ORANGE }}>No Page connected — <Link href="/connect/meta" style={{ color: ORANGE, fontWeight: 700 }}>connect Meta →</Link></div>
              : <select value={pageId} onChange={(e) => setPageId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.instagram ? ' · + Instagram' : ''}</option>)}</select>}
          </label>
          <label style={{ flex: 1, minWidth: 150 }}>{label('Country')}<select value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...input, cursor: 'pointer' }}><option value="">Select…</option>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
        </div>
        <label>{label('Where clicks go')}<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com" style={input} /></label>
      </div>

      {heading('4', 'Budget')}
      <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 12px', background: '#fff', width: 'fit-content' }}>
        <span style={{ color: SUB, fontSize: 15 }}>$</span>
        <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" style={{ border: 0, outline: 0, padding: '12px 6px', fontSize: 16, width: 90, fontFamily: SANS, color: INK }} />
        <span style={{ color: FAINT, fontSize: 13 }}>/day</span>
      </div>

      <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={launch} disabled={!ready} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '13px 24px', fontWeight: 800, fontSize: 15, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5, fontFamily: SANS }}>
          {busy === 'uploading' ? 'Preparing…' : busy === 'launching' ? 'Launching…' : '🚀 Launch ad'}
        </button>
        <span style={{ fontSize: 13, color: SUB }}>{missing.length ? `Add ${missing.join(', ')}` : `$${parseFloat(budget) || 10}/day · Advantage+ audience · created paused for your review`}</span>
      </div>

      {result && (
        <div style={{ marginTop: 20, border: `1px solid ${result.ok ? 'rgba(18,161,80,.4)' : 'rgba(224,47,6,.35)'}`, background: result.ok ? '#f1faf3' : '#fff5f2', borderRadius: 14, padding: '14px 16px', fontSize: 14.5, color: INK, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, color: result.ok ? GOOD : ORANGE }}>{result.ok ? '✓ Ready to go live' : 'Couldn’t launch'}</div>
          <div style={{ marginTop: 4 }}>{result.msg}</div>
          {result.note && <div style={{ marginTop: 6, color: SUB, fontSize: 13 }}>{result.note}</div>}
          {result.href && <Link href={result.href} style={{ display: 'inline-block', marginTop: 10, fontWeight: 800, color: ORANGE, textDecoration: 'none' }}>{result.hrefLabel || 'Open →'}</Link>}
        </div>
      )}
    </div>
  )
}
