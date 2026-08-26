'use client'
/**
 * MelloAdsActions — "run your ads by typing." Type → Mello plans → confirm card (what changes · € impact)
 * → Approve → executes on the real Meta account. Nothing writes without Approve; launches land PAUSED.
 *
 * Two shapes:
 *  • no `attach` (Your Ads command bar): free-text only — scale / pause / resume.
 *  • with `attach` (creative → Facebook bridge): three modes — New ad (free-text launch), Refresh an ad
 *    (swap a live ad's creative), Carousel (add a card). Refresh/Carousel show a picker of live ads.
 */
import { useState, useEffect } from 'react'

type Card = { title: string; summary: string; lines?: string[]; confirmLabel: string; currency: string; action: any }
type Attach = { creativeUrl: string; brandName?: string; website?: string }
type LiveAd = { adId: string; name: string; status: string; campaignName: string; image: string | null }
type Variant = 'new' | 'refresh' | 'carousel'

const ORANGE = '#ef4a1e'

export default function MelloAdsActions({ attach, placeholder = 'Tell Mello what to do — “scale ROY 1 to €80/day”, “pause the retargeting campaign”…', autoFocus, onDone }: {
  attach?: Attach; placeholder?: string; autoFocus?: boolean; onDone?: () => void
}) {
  const [variant, setVariant] = useState<Variant>('new')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const [clarify, setClarify] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [liveAds, setLiveAds] = useState<LiveAd[] | null>(null)

  const reset = () => { setCard(null); setClarify(null); setError(null); setDone(null) }

  // Load the founder's live ads when they pick Refresh/Carousel.
  useEffect(() => {
    if (!attach || variant === 'new' || liveAds) return
    fetch('/api/ads/live-ads').then((r) => r.json()).then((d) => setLiveAds(d.ads || [])).catch(() => setLiveAds([]))
  }, [variant, attach, liveAds])

  const plan = async () => {
    if (!msg.trim() || busy) return
    setBusy(true); reset()
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'plan', message: msg.trim(), attach }) })
      const d = await r.json()
      if (d.card) setCard(d.card); else if (d.clarify) setClarify(d.clarify); else setError(d.error || 'Couldn’t read that — try rephrasing.')
    } catch { setError('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const planAttach = async (targetAdId: string) => {
    if (!attach || busy) return
    setBusy(true); reset()
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'plan-attach', creativeUrl: attach.creativeUrl, brandName: attach.brandName, website: attach.website, variant, targetAdId }) })
      const d = await r.json()
      if (d.card) setCard(d.card); else setError(d.error || 'Couldn’t build that — pick another ad.')
    } catch { setError('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const approve = async () => {
    if (!card || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'execute', action: card.action }) })
      const d = await r.json()
      if (d.ok) { setDone(d.message); setCard(null); setMsg(''); onDone?.() } else setError(d.error || 'Meta rejected that.')
    } catch { setError('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const Tab = ({ v, label }: { v: Variant; label: string }) => (
    <button onClick={() => { setVariant(v); reset() }} style={{ padding: '6px 12px', borderRadius: 100, border: `1px solid ${variant === v ? ORANGE : '#e3ded2'}`, background: variant === v ? `${ORANGE}12` : '#fff', color: variant === v ? ORANGE : '#6f665a', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {attach && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Tab v="new" label="Launch as new ad" />
          <Tab v="refresh" label="Refresh a live ad" />
          <Tab v="carousel" label="Add to a carousel" />
        </div>
      )}

      {/* New-ad / Your Ads: free-text bar */}
      {(!attach || variant === 'new') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={msg} autoFocus={autoFocus} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && plan()} placeholder={attach ? 'e.g. “launch this at €30/day targeting women 25–40 into wellness”' : placeholder}
            style={{ flex: 1, padding: '13px 16px', fontSize: 14.5, borderRadius: 100, border: '1px solid #e3ded2', background: '#fff', color: '#1a1410', outline: 'none' }} />
          <button onClick={plan} disabled={busy || !msg.trim()} style={{ background: msg.trim() ? ORANGE : '#e3ded2', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 22px', fontSize: 14.5, fontWeight: 800, cursor: msg.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{busy && !card ? 'Thinking…' : 'Ask Mello'}</button>
        </div>
      )}

      {/* Refresh / Carousel: pick a live ad */}
      {attach && variant !== 'new' && !card && !done && (
        <div>
          <div style={{ fontSize: 12.5, color: '#6f665a', marginBottom: 8 }}>{variant === 'refresh' ? 'Which ad should this creative replace?' : 'Which ad should this become a carousel card in?'}</div>
          {liveAds === null ? <div style={{ fontSize: 13, color: '#aaa' }}>Loading your live ads…</div>
            : liveAds.length === 0 ? <div style={{ fontSize: 13, color: '#aaa' }}>No live ads found on your account.</div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                {liveAds.map((a) => (
                  <button key={a.adId} onClick={() => planAttach(a.adId)} disabled={busy} style={{ textAlign: 'left', border: '1px solid #e3ded2', borderRadius: 10, background: '#fff', padding: 8, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 38, height: 38, borderRadius: 7, background: '#f0f0f0', flex: 'none', overflow: 'hidden' }}>{/* eslint-disable-next-line @next/next/no-img-element */}{a.image && <img src={a.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</span>
                    <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Ad'}</span><span style={{ display: 'block', fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.campaignName}</span></span>
                  </button>
                ))}
              </div>
            )}
        </div>
      )}

      {clarify && <div style={{ fontSize: 13.5, color: '#8a5a1a', background: '#fdf4e7', border: '1px solid #f3e2c5', borderRadius: 12, padding: '11px 14px' }}>{clarify}</div>}
      {error && <div style={{ fontSize: 13.5, color: '#b42318', background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 12, padding: '11px 14px' }}>{error}</div>}
      {done && <div style={{ fontSize: 13.5, color: '#15803d', background: '#f0f9f2', border: '1px solid #bbe6c6', borderRadius: 12, padding: '11px 14px' }}>✅ {done}</div>}

      {card && (
        <div style={{ border: `1px solid ${ORANGE}33`, borderRadius: 14, background: '#fff', padding: 16, boxShadow: '0 18px 44px -28px rgba(239,74,30,.4)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 4 }}>{card.title}</div>
          <div style={{ fontSize: 13.5, color: '#555', marginBottom: card.lines?.length ? 10 : 14 }}>{card.summary}</div>
          {card.lines && card.lines.length > 0 && (
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {card.lines.map((l, i) => <li key={i} style={{ fontSize: 12.5, color: '#555', lineHeight: 1.5 }}>{l}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={approve} disabled={busy} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{busy ? 'Working…' : card.confirmLabel}</button>
            <button onClick={() => setCard(null)} disabled={busy} style={{ background: 'none', border: '1px solid #e3ded2', borderRadius: 100, padding: '10px 16px', fontSize: 14, fontWeight: 600, color: '#555', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
