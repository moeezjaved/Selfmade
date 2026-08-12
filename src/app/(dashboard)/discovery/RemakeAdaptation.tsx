'use client'
/**
 * REMAKE · the pre-adaptation — the magic before the money button.
 * When you land on the remake screen, Mello has ALREADY studied the winning ad and
 * rewritten it for your brand: the hook, the scenes, the voiceover. You don't start
 * from a blank form — you start from a draft. Preview only (no credits, no media);
 * the real Generate lives in the Selfmade AI card below.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

type Adaptation = { studied: string; hook: string; primaryText: string; scenes: string[]; voiceover: string }
type Brand = { id: string; name: string }

const FOREST = '#141d15', LIME = '#ff5a2c', INK = '#111514', MUTED = '#6b7280', LINE = '#e2e8f0'
const cacheKey = (adId: string, brandId: string) => `remake_adapt:${adId}:${brandId}`

export default function RemakeAdaptation({ adId, isVideo, videoUrl, poster }: { adId: string; isVideo?: boolean; videoUrl?: string | null; poster?: string | null }) {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string>('')
  const [data, setData] = useState<{ adaptation: Adaptation; brand: Brand } | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsBrand, setNeedsBrand] = useState(false)

  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((d) => {
      const bs: Brand[] = (d.brands || []).map((b: any) => ({ id: b.id, name: b.name }))
      setBrands(bs)
      if (bs[0]) setBrandId(bs[0].id); else { setNeedsBrand(true); setLoading(false) }
    }).catch(() => { setNeedsBrand(true); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!brandId) return
    let alive = true
    setLoading(true)
    try { const c = sessionStorage.getItem(cacheKey(adId, brandId)); if (c) { setData(JSON.parse(c)); setLoading(false) } } catch {}
    fetch('/api/remake/adapt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adId, brandId }) })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (d.needsBrand) { setNeedsBrand(true); return }
        if (d.adaptation) { setData(d); try { sessionStorage.setItem(cacheKey(adId, brandId), JSON.stringify(d)) } catch {} }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [adId, brandId])

  if (needsBrand) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 20px', marginBottom: 18, fontSize: 13.5, color: MUTED }}>
        <b style={{ color: INK }}>✨ Remake this for your brand.</b> Add your brand first and Mello will adapt this winning ad to your product automatically.
      </div>
    )
  }

  // "Generate this for X →" now takes you straight to the studio (the inline flow: photos → for video,
  // language/voice/free script → render), pre-loaded with this ad + brand — not just a scroll.
  const goStudio = () => {
    const q = new URLSearchParams({ ad: adId })
    if (isVideo) q.set('type', 'video')
    if (videoUrl) q.set('vid', videoUrl)
    if (poster) q.set('img', poster)
    if (data?.brand?.name) q.set('brand', data.brand.name)
    router.push(`/studio?${q.toString()}`)
  }
  const ad = data?.adaptation

  return (
    <div style={{ background: 'linear-gradient(180deg,#f7fbef,#ffffff)', border: `1px solid #d9ecb4`, borderRadius: 16, padding: '20px 22px', marginBottom: 18, boxShadow: '0 24px 50px -40px rgba(20,29,21,.4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: FOREST, color: LIME, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Sparkles size={14} /></span>
        <div style={{ fontSize: 14.5, fontWeight: 850, color: INK }}>Mello studied this campaign{data?.brand ? ` and adapted it for ${data.brand.name}` : ''}.</div>
        {brands.length > 1 && (
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: 'inherit' }}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {loading && !ad && (
        <div style={{ padding: '6px 0 2px' }}>
          {[70, 90, 60].map((w, i) => <div key={i} style={{ height: 11, width: `${w}%`, background: '#eaf3d8', borderRadius: 6, margin: '10px 0', animation: 'radp 1.2s ease-in-out infinite' }} />)}
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Adapting the winning structure to your product…</div>
          <style>{`@keyframes radp{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
        </div>
      )}

      {ad && (
        <>
          {ad.studied && <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, margin: '2px 0 14px', maxWidth: '70ch' }}><b style={{ color: '#3a5a2e' }}>Why the original works:</b> {ad.studied}</div>}

          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Your hook"><div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.015em', color: INK, lineHeight: 1.3 }}>{ad.hook}</div></Field>
            {ad.scenes?.length > 0 && (
              <Field label="Scenes">
                <div style={{ display: 'grid', gap: 5 }}>
                  {ad.scenes.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, fontSize: 13, color: '#2c342d', fontWeight: 550 }}>
                      <span style={{ color: '#2f7a3f', fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>{s}
                    </div>
                  ))}
                </div>
              </Field>
            )}
            {ad.voiceover && <Field label="Voiceover"><div style={{ fontSize: 13.5, color: '#2c342d', fontStyle: 'italic', lineHeight: 1.5 }}>“{ad.voiceover}”</div></Field>}
            {ad.primaryText && <Field label="Primary text"><div style={{ fontSize: 13, color: '#2c342d', lineHeight: 1.55 }}>{ad.primaryText}</div></Field>}
          </div>

          <button onClick={goStudio} style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, background: LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 14, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Sparkles size={15} /> Generate this for {data?.brand?.name || 'my brand'} →
          </button>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>A starting draft — you approve everything before any credits are spent.</div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid #e8efdc`, borderRadius: 12, padding: '11px 14px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: '#8a9a7a', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}
