'use client'
/**
 * Quick Launch — the dead-simple way to put an ad live on Meta. Pick a creative you already made, set a
 * daily budget, hit Launch. Everything else (Facebook Page, Pixel, objective, audience) is auto-resolved:
 * we launch a single Advantage+ (auto-targeted) campaign via the SAME battle-tested /api/m4/launch engine,
 * so no interests to pick and no 8-step wizard. The full wizard stays at /m4 for power users ("Advanced").
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a', LINE = 'rgba(20,18,15,.12)', INSET = '#f7f6f4', ORANGE = '#e02f06', GOOD = '#12a150'
const SANS = 'Inter, system-ui, sans-serif'

type Creative = { id: string; image_url: string | null; media_type?: string | null; type?: string | null; prompt?: string | null; brand_name?: string | null }

export default function QuickLaunch() {
  const [creatives, setCreatives] = useState<Creative[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [budget, setBudget] = useState('10')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'' | 'uploading' | 'launching'>('')
  const [result, setResult] = useState<{ ok: boolean; msg: string; note?: string; href?: string } | null>(null)

  useEffect(() => {
    fetch('/api/creatives?limit=60').then((r) => r.json()).then((d) => {
      const imgs = (Array.isArray(d.creatives) ? d.creatives : []).filter((c: Creative) => c.image_url && c.media_type !== 'video')
      setCreatives(imgs)
    }).catch(() => setCreatives([]))
    // Prefill the destination from the active brand's site.
    fetch('/api/ads-studio/products').then((r) => r.json()).then((d) => { if (d?.website && !url) setUrl(String(d.website)) }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = creatives?.find((c) => c.id === picked) || null

  const launch = async () => {
    if (!chosen?.image_url || busy) return
    setResult(null)
    try {
      setBusy('uploading')
      const up = await fetch('/api/m4/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: chosen.image_url }) }).then((r) => r.json())
      if (!up?.hash) { setBusy(''); setResult({ ok: false, msg: up?.error || 'Couldn’t prepare that creative for Meta — try another.' }); return }

      setBusy('launching')
      const headline = (chosen.brand_name || 'Shop now').slice(0, 40)
      const body = {
        campaignName: `Quick Launch — ${chosen.brand_name || 'Ad'}`,
        creatives: [{ id: chosen.id, name: chosen.brand_name || 'Your ad', pack: 1, type: 'image', hash: up.hash }],
        interests: [],                 // Advantage+ auto-targeting — no manual interests
        budget: String(parseFloat(budget) || 10),
        objective: 'OUTCOME_SALES',    // engine auto-downgrades to Traffic if the account has no Pixel
        websiteUrl: url.trim(),
        headline,
        primaryText: chosen.prompt?.slice(0, 120) || `Discover ${chosen.brand_name || 'our products'}.`,
        cta: 'SHOP_NOW',
      }
      const r = await fetch('/api/m4/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      setBusy('')
      if (!r.ok || d.error) {
        // Surface the engine's clear, actionable messages (plan gate, account setup, reconnect…).
        setResult({ ok: false, msg: d.error || 'Launch failed — try again.', href: d.needsReconnect ? '/settings' : d.needsSetup ? undefined : (r.status === 402 ? '/upgrade' : undefined) })
        return
      }
      const made = (d.broad_adsets || 0)
      setResult({ ok: true, msg: made ? `Your ad is set up on ${d.account || 'Meta'} — it’s paused for your review.` : 'Campaign created, but no ad set built — check your Meta account is ready to run ads.', note: d.note, href: '/reports' })
    } catch {
      setBusy('')
      setResult({ ok: false, msg: 'Something went wrong — try again.' })
    }
  }

  const btn: React.CSSProperties = { border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '13px 22px', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: SANS }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 22px 60px', fontFamily: SANS, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }}>Launch an ad</h1>
          <p style={{ margin: '6px 0 0', color: SUB, fontSize: 14.5 }}>Pick a creative, set a daily budget, go live. Meta targeting is handled for you (Advantage+).</p>
        </div>
        <Link href="/m4" style={{ fontSize: 13, fontWeight: 700, color: SUB, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 14px' }}>Advanced setup →</Link>
      </div>

      {/* 1 · pick a creative */}
      <div style={{ marginTop: 26 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 12 }}>1 · Pick your ad</div>
        {creatives === null ? (
          <div style={{ color: FAINT, fontSize: 14 }}>Loading your creatives…</div>
        ) : creatives.length === 0 ? (
          <div style={{ border: `1.5px dashed ${LINE}`, borderRadius: 14, padding: 24, textAlign: 'center', color: SUB, fontSize: 14 }}>
            No creatives yet. <Link href="/ads-workspace" style={{ color: ORANGE, fontWeight: 700 }}>Make an ad first →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {creatives.map((c) => {
              const on = c.id === picked
              return (
                <button key={c.id} onClick={() => setPicked(c.id)} style={{ position: 'relative', padding: 0, border: `2px solid ${on ? ORANGE : LINE}`, borderRadius: 12, overflow: 'hidden', background: INSET, cursor: 'pointer', aspectRatio: '4/5' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {on && <span style={{ position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>✓</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 2 · budget + destination */}
      <div style={{ marginTop: 30 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 12 }}>2 · Budget & destination</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginBottom: 6, fontWeight: 600 }}>Daily budget</span>
            <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 12px', background: '#fff' }}>
              <span style={{ color: SUB, fontSize: 15 }}>$</span>
              <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" style={{ border: 0, outline: 0, padding: '12px 6px', fontSize: 16, width: 90, fontFamily: SANS, color: INK }} />
              <span style={{ color: FAINT, fontSize: 13 }}>/day</span>
            </div>
          </label>
          <label style={{ display: 'block', flex: 1, minWidth: 240 }}>
            <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginBottom: 6, fontWeight: 600 }}>Where clicks go</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com" style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 12px', fontSize: 15, fontFamily: SANS, color: INK, background: '#fff', boxSizing: 'border-box' }} />
          </label>
        </div>
      </div>

      {/* launch */}
      <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={launch} disabled={!chosen || !!busy || !url.trim()} style={{ ...btn, opacity: (!chosen || !!busy || !url.trim()) ? 0.5 : 1, cursor: (!chosen || !!busy || !url.trim()) ? 'default' : 'pointer' }}>
          {busy === 'uploading' ? 'Preparing…' : busy === 'launching' ? 'Launching…' : '🚀 Launch ad'}
        </button>
        {chosen && !busy && <span style={{ fontSize: 13, color: SUB }}>${parseFloat(budget) || 10}/day · Advantage+ audience · created paused for your review</span>}
      </div>

      {result && (
        <div style={{ marginTop: 20, border: `1px solid ${result.ok ? 'rgba(18,161,80,.4)' : 'rgba(224,47,6,.35)'}`, background: result.ok ? '#f1faf3' : '#fff5f2', borderRadius: 14, padding: '14px 16px', fontSize: 14.5, color: INK, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, color: result.ok ? GOOD : ORANGE }}>{result.ok ? '✓ Ready to go live' : 'Couldn’t launch'}</div>
          <div style={{ marginTop: 4 }}>{result.msg}</div>
          {result.note && <div style={{ marginTop: 6, color: SUB, fontSize: 13 }}>{result.note}</div>}
          {result.href && <Link href={result.href} style={{ display: 'inline-block', marginTop: 10, fontWeight: 800, color: ORANGE, textDecoration: 'none' }}>{result.ok ? 'Review & turn it on →' : 'Fix it →'}</Link>}
        </div>
      )}
    </div>
  )
}
