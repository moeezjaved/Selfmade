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
import FacebookAdsCard from '@/components/brief/FacebookAdsCard'

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
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'launch' | 'manage'>('launch')   // one page: launch a NEW ad, or manage LIVE ads
  const [prefilling, setPrefilling] = useState(true)
  const [busy, setBusy] = useState<'' | 'uploading' | 'launching'>('')
  const [result, setResult] = useState<{ ok: boolean; msg: string; note?: string; href?: string; hrefLabel?: string } | null>(null)
  const copyEdited = useRef(false)
  // A creative uploaded straight from the user's computer (image OR video). We hold Meta's hash so launch
  // skips the re-upload, and a local preview URL so it shows in the grid.
  const [uploaded, setUploaded] = useState<{ id: string; previewUrl: string; hash: string; isVideo: boolean; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Load creatives, the connected Page(s), and auto-detect the brand → pre-fill URL/country, then generate copy.
  useEffect(() => {
    // A specific creative can arrive via ?img=<url> (e.g. "Run on Facebook" from a single ad) — pre-select it,
    // injecting a synthetic entry when it isn't in the recent list so that exact ad is what gets launched.
    let wantImg = ''
    try {
      const sp = new URLSearchParams(window.location.search)
      wantImg = sp.get('img') || ''
      if (sp.get('tab') === 'manage') setTab('manage')   // deep-link straight to the live-ads view
    } catch { /* SSR-safe */ }

    fetch('/api/creatives?limit=60').then((r) => r.json()).then((d) => {
      let list: Creative[] = (Array.isArray(d.creatives) ? d.creatives : []).filter((c: Creative) => c.image_url && c.media_type !== 'video')
      if (wantImg) {
        const hit = list.find((c) => c.image_url === wantImg)
        if (hit) { setPicked(hit.id) }
        else { const synth: Creative = { id: '_img', image_url: wantImg, media_type: 'image' }; list = [synth, ...list]; setPicked('_img') }
      }
      setCreatives(list)
    }).catch(() => { if (wantImg) { setCreatives([{ id: '_img', image_url: wantImg, media_type: 'image' }]); setPicked('_img') } else setCreatives([]) })

    fetch('/api/m4/pages').then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) })).then(({ ok, d }) => {
      // A "No Meta account" error (400) means Facebook isn't connected at all — gate the whole flow on it.
      setMetaConnected(ok && !d?.error ? true : (d?.error === 'No Meta account' ? false : true))
      const ps: Page[] = Array.isArray(d.pages) ? d.pages : []
      setPages(ps)
      if (ps[0]) { setPageId(ps[0].id); if (ps[0].website && !url) setUrl(ps[0].website) }
    }).catch(() => setMetaConnected(true))

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

  // Upload a picture/video from the computer → Meta gives back a hash (image) or video id, which we reuse
  // at launch. Video is fully supported by /api/m4/launch (it builds a video creative).
  const onUpload = async (file: File) => {
    setUploadErr('')
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
    if (file.size > 200 * 1024 * 1024) { setUploadErr('That file is over 200MB — pick a smaller one.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('isVideo', isVideo ? 'true' : 'false')
      const d = await fetch('/api/m4/upload-image', { method: 'POST', body: fd }).then((r) => r.json())
      if (!d?.hash) { setUploadErr(d?.error || 'Couldn’t prepare that file for Meta — try another.'); setUploading(false); return }
      const previewUrl = URL.createObjectURL(file)
      const up = { id: '_upload', previewUrl, hash: String(d.hash), isVideo: !!d.isVideo || isVideo, name: file.name }
      setUploaded(up); setPicked('_upload')
    } catch { setUploadErr('Upload failed — try again.') }
    finally { setUploading(false) }
  }

  // The full pickable list = the uploaded creative (if any) first, then generated ones.
  const uploadedCreative: Creative | null = uploaded ? { id: '_upload', image_url: uploaded.previewUrl, media_type: uploaded.isVideo ? 'video' : 'image', brand_name: uploaded.name } : null
  const allCreatives: Creative[] | null = creatives === null ? null : (uploadedCreative ? [uploadedCreative, ...creatives] : creatives)

  const chosen = allCreatives?.find((c) => c.id === picked) || null
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
      // Uploaded-from-computer creative already has its Meta hash (image or video) — no re-upload needed.
      let hash = uploaded && chosen.id === '_upload' ? uploaded.hash : ''
      let creativeType: 'image' | 'video' = uploaded && chosen.id === '_upload' && uploaded.isVideo ? 'video' : 'image'
      if (!hash) {
        setBusy('uploading')
        const up = await fetch('/api/m4/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: chosen.image_url }) }).then((r) => r.json())
        if (!up?.hash) { setBusy(''); setResult({ ok: false, msg: up?.error || 'Couldn’t prepare that creative for Meta — try another.' }); return }
        hash = up.hash; creativeType = 'image'
      }

      setBusy('launching')
      const body = {
        campaignName: `Quick Launch — ${chosen.brand_name || 'Ad'}`,
        creatives: [{ id: chosen.id, name: chosen.brand_name || 'Your ad', pack: 1, type: creativeType, hash }],
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
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }}>Your ads</h1>
          <p style={{ margin: '6px 0 0', color: SUB, fontSize: 14.5 }}>{metaConnected === false ? 'Connect your Facebook account to get started.' : tab === 'manage' ? 'Everything that’s live. Hit Manage on any ad to scale, pause, duplicate or edit it — Mello does it, you approve.' : <>We pre-filled everything we could and wrote your copy — just confirm and set a budget. {prefilling && <span style={{ color: ORANGE, fontWeight: 700 }}>Setting things up…</span>}</>}</p>
        </div>
      </div>

      {/* One page, two jobs: launch a NEW ad, or manage the ads already LIVE. */}
      {metaConnected === true && (
        <div style={{ display: 'flex', gap: 4, marginTop: 18, background: INSET, borderRadius: 999, padding: 4, width: 'fit-content' }}>
          {([['launch', '🚀 Launch a new ad'], ['manage', '📊 Your live ads']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ border: 0, background: tab === k ? '#fff' : 'transparent', color: tab === k ? INK : SUB, boxShadow: tab === k ? '0 1px 2px rgba(20,18,15,.12)' : 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: SANS }}>{lbl}</button>
          ))}
        </div>
      )}

      {metaConnected !== true ? (
        metaConnected === false ? (
          <div style={{ marginTop: 26, border: `1px solid ${LINE}`, borderRadius: 16, padding: '28px 24px', background: INSET, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>📘</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Connect Facebook to launch ads</div>
            <div style={{ fontSize: 14, color: SUB, maxWidth: 440, margin: '0 auto 18px', lineHeight: 1.5 }}>
              Ads run inside your own Meta ad account, so we need to connect Facebook first. It takes about a minute — then come back here and your ad is one click away.
            </div>
            <Link href="/connect-meta?next=/m4/quick" style={{ display: 'inline-block', border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '12px 26px', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}>Connect Facebook →</Link>
          </div>
        ) : (
          <div style={{ marginTop: 40, textAlign: 'center', color: FAINT, fontSize: 14 }}>Checking your Facebook connection…</div>
        )
      ) : tab === 'manage' ? (
        <div style={{ marginTop: 22 }}>
          {/* One clean surface: your live ads (this brand's account). Each ad's "Manage" opens an inline
              Mello panel — Scale, Pause, Duplicate, Edit copy — with approve-before-it-happens. */}
          <FacebookAdsCard initial={{ accounts: [] } as any} ctaHref="/reports" ctaLabel="See the full report" />
        </div>
      ) : (<>

      {heading('1', 'Pick your ad')}
      <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
      {creatives === null ? <div style={{ color: FAINT, fontSize: 14 }}>Loading your creatives…</div>
        : (
          <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
            {/* Upload from computer — first cell */}
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ position: 'relative', padding: 0, border: `2px dashed ${LINE}`, borderRadius: 12, background: INSET, cursor: uploading ? 'default' : 'pointer', aspectRatio: '4/5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: SUB }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{uploading ? '…' : '↑'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '0 8px' }}>{uploading ? 'Uploading…' : 'Upload photo or video'}</span>
              <span style={{ fontSize: 10.5, color: FAINT }}>from your computer</span>
            </button>
            {(allCreatives || []).map((c) => (
              <button key={c.id} onClick={() => setPicked(c.id)} style={{ position: 'relative', padding: 0, border: `2px solid ${c.id === picked ? ORANGE : LINE}`, borderRadius: 12, overflow: 'hidden', background: INSET, cursor: 'pointer', aspectRatio: '4/5' }}>
                {c.media_type === 'video'
                  ? <video src={c.image_url!} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  /* eslint-disable-next-line @next/next/no-img-element */
                  : <img src={c.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                {c.media_type === 'video' && <span style={{ position: 'absolute', bottom: 7, left: 7, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 6px' }}>▶ Video</span>}
                {c.id === '_upload' && <span style={{ position: 'absolute', top: 7, left: 7, background: INK, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 6px' }}>Yours</span>}
                {c.id === picked && <span style={{ position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>✓</span>}
              </button>
            ))}
          </div>
          {uploadErr && <div style={{ marginTop: 8, fontSize: 12.5, color: ORANGE }}>{uploadErr}</div>}
          {creatives.length === 0 && !uploaded && <div style={{ marginTop: 8, fontSize: 12.5, color: FAINT }}>No generated creatives yet — upload one above, or <Link href="/ads-workspace" style={{ color: ORANGE, fontWeight: 700 }}>make an ad →</Link></div>}
          </>
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
      </>)}
    </div>
  )
}
