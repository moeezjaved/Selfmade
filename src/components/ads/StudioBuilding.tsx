'use client'
/**
 * StudioBuilding — the "wow" build-and-reveal screen. Given the new brand's website, it warms the whole
 * studio against that domain (brand kit → products → competitors) and pre-generates the free ad templates
 * (each POST caches into brands.brand_kit.adsStudio.templates as a permanent R2 url). It reveals
 * /ads-workspace as soon as the VISIBLE set is ready (brand kit + products + a first few templates, and
 * competitors within a short window); the remaining templates keep generating in the background and the
 * workspace shows them from cache. Never traps the user: an "Enter studio" escape appears after a few
 * seconds and a hard cap reveals regardless.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MarkDecode } from '@/components/brand/Mark'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#e02f06', PAPER = '#fbf4e2'
const SANS = 'Inter, system-ui, sans-serif'
const SERIF = "'Playfair Display', 'Times New Roman', serif"

type Step = 'run' | 'done'

export default function StudioBuilding({ domain }: { domain: string }) {
  const router = useRouter()
  const [brand, setBrand] = useState<Step>('run')
  const [prod, setProd] = useState<Step>('run')
  const [aud, setAud] = useState<Step>('run')
  const [comp, setComp] = useState<Step>('run')
  const [ownAds, setOwnAds] = useState<Step>('run')
  const [tpl, setTpl] = useState({ done: 0, total: 10 })
  const [target, setTarget] = useState(4)          // how many templates must be ready before reveal
  const [showEnter, setShowEnter] = useState(false)
  const navigated = useRef(false)
  const startedAt = useRef(Date.now())
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')

  const go = () => {
    if (navigated.current) return
    navigated.current = true
    fetch('/api/ads-studio/warm', { method: 'POST' }).catch(() => {})   // mark built so future visits skip this screen
    router.push('/ads-workspace?built=1')   // built=1 renders the workspace directly (loop-proof)
  }

  // ── run the build once ──
  useEffect(() => {
    let on = true
    // competitors — slow, best-effort, in parallel (doesn't block the others)
    fetch(`/api/ads-studio/competitors?domain=${encodeURIComponent(cleanDomain)}`).then((r) => r.json()).catch(() => null).finally(() => { if (on) setComp('done') })
    // your own live ads (the ads audit) — from the Meta page linked in the funnel, best-effort in parallel
    fetch(`/api/ads-studio/your-ads`).then((r) => r.json()).catch(() => null).finally(() => { if (on) setOwnAds('done') })
    // audiences — warms + caches the market/audience read, best-effort in parallel
    fetch(`/api/ads-studio/audiences?domain=${encodeURIComponent(cleanDomain)}`).then((r) => r.json()).catch(() => null).finally(() => { if (on) setAud('done') })

    ;(async () => {
      let kit: any = null
      try { kit = await fetch(`/api/ads-studio/brand-kit?domain=${encodeURIComponent(cleanDomain)}`).then((r) => r.json()) } catch { /* ignore */ }
      if (!on) return
      setBrand('done')

      let products: { title: string; image: string | null }[] = []
      try { const d = await fetch(`/api/ads-studio/products?domain=${encodeURIComponent(cleanDomain)}`).then((r) => r.json()); products = Array.isArray(d.products) ? d.products : [] } catch { /* ignore */ }
      if (!on) return
      setProd('done')

      let tpls: any[] = []
      try { const d = await fetch(`/api/ads-studio/templates?domain=${encodeURIComponent(cleanDomain)}`).then((r) => r.json()); tpls = Array.isArray(d.templates) ? d.templates : [] } catch { /* ignore */ }
      if (!on) return
      const total = tpls.length || 10
      let done = tpls.filter((t: any) => t.image).length

      const hero = products.find((p) => p.image)?.image
      // Templates need a product hero image; without one we can't generate — reveal on brand+products.
      const tgt = hero ? Math.min(4, total) : 0
      setTarget(tgt)
      setTpl({ done, total })
      if (!hero) return

      const colors = (kit?.colors || []).map((c: any) => c.hex)
      const fonts = kit?.fonts?.length ? { heading: kit.fonts[0], body: kit.fonts[1] || kit.fonts[0] } : undefined
      const body = (i: number) => ({ domain: cleanDomain, index: i, productImages: [hero], colors, fonts, logo: kit?.logo || undefined, brandName: kit?.siteName, productDesc: (kit?.facts || [])[0] })
      const genOne = async (i: number) => {
        for (let a = 0; a < 4 && on; a++) {
          try { const d = await fetch('/api/ads-studio/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(i)) }).then((r) => r.json()); if (d.image) return true } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, 5000))   // model busy → wait, then retry
        }
        return false
      }
      const todo = tpls.map((t: any, i: number) => ({ t, i })).filter(({ t }: any) => !t.image).map(({ i }: any) => i)
      let cursor = 0
      const worker = async () => { while (cursor < todo.length && on) { const i = todo[cursor++]; const ok = await genOne(i); if (on && ok) { done++; setTpl({ done, total }) } } }
      await Promise.all([worker(), worker()])   // 2 at a time, like the studio's own genAll
    })()

    const t = setTimeout(() => { if (on) setShowEnter(true) }, 9000)
    return () => { on = false; clearTimeout(t) }
  }, [cleanDomain])

  // ── reveal when the visible set is ready (with competitor grace + hard cap) ──
  useEffect(() => {
    const iv = setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      const visibleReady = brand === 'done' && prod === 'done' && tpl.done >= target
      const compOk = comp === 'done' || elapsed > 70000
      if ((visibleReady && compOk) || elapsed > 120000) { clearInterval(iv); go() }
    }, 700)
    return () => clearInterval(iv)
  }, [brand, prod, comp, tpl, target]) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.min(100, Math.round(
    (brand === 'done' ? 20 : 0) + (prod === 'done' ? 18 : 0) + (aud === 'done' ? 12 : 0) + (comp === 'done' ? 12 : 0) + (ownAds === 'done' ? 10 : 0) +
    (tpl.total ? 28 * (tpl.done / tpl.total) : 0)
  ))

  const rows: { label: string; state: Step; note?: string }[] = [
    { label: 'Reading your brand', state: brand },
    { label: 'Finding your products', state: prod },
    { label: 'Understanding your audience', state: aud },
    { label: 'Reading your live ads', state: ownAds },
    { label: 'Scouting your competitors', state: comp },
    { label: 'Designing your ad concepts', state: tpl.done >= (target || 1) ? 'done' : 'run', note: `${tpl.done}/${tpl.total}` },
  ]

  return (
    <div style={{ minHeight: '100dvh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: SANS, color: INK }}>
      <style>{`@keyframes sbspin{to{transform:rotate(360deg)}}@keyframes sbpulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 50px -24px rgba(239,74,30,.5)' }}><MarkDecode size={68} loop durationMs={2000} /></div>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 14 }}>Setting up {cleanDomain}</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 46, lineHeight: 1.04, letterSpacing: '-0.02em', margin: '0 0 10px' }}>Building your studio</h1>
        <p style={{ color: SUB, fontSize: 15.5, lineHeight: 1.5, margin: '0 0 28px' }}>Reading your site and creating your first ads — brand kit, products, competitors and on-brand concepts. One moment.</p>

        <div style={{ height: 8, borderRadius: 100, background: PAPER, overflow: 'hidden', marginBottom: 22 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: ORANGE, borderRadius: 100, transition: 'width .5s ease' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', background: '#fff' }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {r.state === 'done'
                ? <span style={{ width: 22, height: 22, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flex: 'none' }}>✓</span>
                : <span style={{ width: 22, height: 22, flex: 'none', border: `2.5px solid ${PAPER}`, borderTopColor: ORANGE, borderRadius: '50%', animation: 'sbspin .8s linear infinite' }} />}
              <span style={{ fontSize: 14.5, fontWeight: 600, color: r.state === 'done' ? INK : SUB, flex: 1 }}>{r.label}</span>
              {r.note && <span style={{ fontSize: 12.5, fontWeight: 700, color: SUB, fontVariantNumeric: 'tabular-nums' }}>{r.note}</span>}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22, minHeight: 24 }}>
          {showEnter
            ? <button onClick={go} style={{ background: 'none', border: 'none', color: ORANGE, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: SANS }}>Enter studio →</button>
            : <span style={{ fontSize: 12.5, color: SUB, animation: 'sbpulse 1.6s ease-in-out infinite' }}>This usually takes under a minute…</span>}
        </div>
      </div>
    </div>
  )
}
