'use client'
/**
 * "Let Mello make ads" — the credit pre-flight the founder asked for. Pick how many ads/day + format,
 * see EXACTLY what it costs against the live per-action price map, and gate: if one day's batch exceeds
 * the balance, the CTA becomes "Not enough credits for this task" with a top-up link. Per-action costs
 * are unchanged (read from /api/credits/balance's pricing map); this only makes the cost transparent
 * and blocks over-spend before Mello starts. On confirm → POST /api/autopilot { adsPerDay, mediaType }.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Image as ImageIcon, Video, Sparkles } from 'lucide-react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', FOREST = '#141d15', LIME = '#ff5a2c', GREEN = '#ef4a1e'
const IMG_ACTION = 'image_clone_pro', VID_ACTION = 'video_clone'   // the per-action costs Mello would incur

export default function MakeAdsModal({ brandId, brandName, onClose }: { brandId: string | null; brandName?: string | null; onClose: () => void }) {
  const router = useRouter()
  const [count, setCount] = useState(2)
  const [media, setMedia] = useState<'image' | 'video'>('image')
  const [balance, setBalance] = useState<number | null>(null)
  const [pricing, setPricing] = useState<Record<string, { label: string; credits: number }>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/credits/balance').then(r => r.json()).then(j => { setBalance(typeof j.balance === 'number' ? j.balance : 0); setPricing(j.pricing || {}) }).catch(() => setBalance(0))
  }, [])

  const unit = pricing[media === 'image' ? IMG_ACTION : VID_ACTION]?.credits ?? (media === 'image' ? 15 : 600)
  const perDay = unit * count
  const affordable = balance !== null && balance >= perDay
  const loading = balance === null

  const confirm = async () => {
    if (!affordable || busy) return
    if (!brandId) { router.push('/brands'); return }   // need a brand first
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/autopilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandId, mediaType: media, adsPerDay: count }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Could not turn on autopilot.')
      setDone(true)
    } catch (e: any) { setErr(e?.message || 'Something went wrong.') } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,10,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 20, border: `1px solid ${LINE}`, boxShadow: '0 30px 90px -30px rgba(20,29,21,.4)', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${LINE}` }}>
          <b style={{ fontSize: 15.5, color: INK }}>Have Mello make ads for you</b>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: '#3a382f', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}><X size={15} /></button>
        </div>

        {done ? (
          <div style={{ padding: '30px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 6 }}>Done — I&rsquo;m on it.</div>
            <p style={{ fontSize: 13.5, color: MUTED, margin: '0 auto 18px', maxWidth: 320, lineHeight: 1.55 }}>
              I&rsquo;ll make <b>{count} {media}</b> ad{count === 1 ? '' : 's'} a day{brandName ? ` for ${brandName}` : ''} from what&rsquo;s winning — and bring them to your morning brief for approval. Nothing charges until an ad is actually made.
            </p>
            <button onClick={onClose} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
          </div>
        ) : (
          <div style={{ padding: '20px 22px 22px' }}>
            <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.55 }}>How many should I make each day? I&rsquo;ll pull from your competitors&rsquo; winners and have them ready in your brief.</p>

            {/* format */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {([['image', ImageIcon, 'Images'], ['video', Video, 'Videos']] as const).map(([m, Icon, label]) => (
                <button key={m} onClick={() => setMedia(m)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: `1.5px solid ${media === m ? '#ef4a1e' : LINE}`, background: media === m ? '#ef4a1e' : '#fff', color: media === m ? '#fff' : INK, borderRadius: 12, padding: '10px 0', fontSize: 13, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>

            {/* quantity stepper */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f6f8f5', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Ads per day</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button onClick={() => setCount(c => Math.max(1, c - 1))} style={stepBtn}>−</button>
                <span style={{ fontSize: 18, fontWeight: 800, color: INK, minWidth: 20, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                <button onClick={() => setCount(c => Math.min(10, c + 1))} style={stepBtn}>+</button>
              </div>
            </div>

            {/* the cost + balance — the transparency */}
            <div style={{ border: `1px solid ${affordable ? LINE : '#fecaca'}`, background: affordable ? '#f4fbe6' : '#fef2f2', borderRadius: 12, padding: '13px 15px', marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span style={{ color: MUTED }}>{count} × {unit} cr ({media})</span>
                <b style={{ color: INK }}>{perDay.toLocaleString()} credits / day</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, color: MUTED }}>
                <span>Your balance</span>
                <span style={{ fontWeight: 700, color: affordable ? GREEN : '#b42318' }}>{loading ? '…' : `${(balance ?? 0).toLocaleString()} credits`}</span>
              </div>
            </div>

            {err && <div style={{ fontSize: 12.5, color: '#b42318', marginBottom: 12 }}>{err}</div>}

            {affordable ? (
              <button onClick={confirm} disabled={busy || loading} style={{ width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 0', fontSize: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy || loading ? 0.6 : 1 }}>
                <Sparkles size={15} /> {busy ? 'Turning on…' : `Have Mello make ${count} ${media}${count === 1 ? '' : 's'} a day`}
              </button>
            ) : (
              <div>
                <button disabled style={{ width: '100%', background: '#f1f4f0', color: '#9aa596', border: 'none', borderRadius: 100, padding: '13px 0', fontSize: 14, fontWeight: 800, cursor: 'not-allowed', fontFamily: 'inherit' }}>
                  Not enough credits for this task
                </button>
                <button onClick={() => router.push('/billing')} style={{ width: '100%', background: 'none', border: 'none', color: GREEN, fontSize: 13, fontWeight: 800, cursor: 'pointer', marginTop: 10, fontFamily: 'inherit' }}>
                  Top up credits →
                </button>
              </div>
            )}
            <div style={{ fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>You&rsquo;re only charged when an ad is actually made. Turn it off anytime.</div>
          </div>
        )}
      </div>
    </div>
  )
}

const stepBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${LINE}`, background: '#fff', color: INK, fontSize: 18, fontWeight: 800, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit' }
