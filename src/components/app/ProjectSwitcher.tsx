'use client'
/**
 * The project switcher on the rail — pick a brand once and the WHOLE app scopes to it (brief, inbox,
 * everything reads the same `sf_brand` cookie). Rendered as a labeled pill at the TOP-LEFT of the page
 * content ("● Aura ▾") so it's obvious which project you're in and that you can switch. Click opens a
 * dropdown below. Switching writes the cookie + soft-refreshes so every surface re-scopes without a reload.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

type Brand = { id: string; name: string }

function readCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}

export default function ProjectSwitcher({ initialBrands = [], initialActive = '' }: { initialBrands?: Brand[]; initialActive?: string }) {
  const router = useRouter()
  // Seed from server-rendered props so the tile is in the HTML immediately and survives a broken
  // hydration (browser extensions). The client fetch below only refreshes the list.
  const [brands, setBrands] = useState<Brand[]>(initialBrands)
  const [active, setActive] = useState<string>(initialActive)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const c = readCookie(BRAND_COOKIE); if (c) setActive(c)
    fetch('/api/brands').then(r => r.ok ? r.json() : null)
      .then(j => { const list = (j?.brands || []).map((b: any) => ({ id: String(b.id), name: String(b.name) })); if (list.length) setBrands(list) })
      .catch(() => {})
  }, [])

  // Close on any click outside the switcher (it's click-to-open, never hover — brushing past it must
  // not throw the panel over the page).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // No brands yet → nothing to show (onboarding handles first-brand creation). With ≥1 we show it so the
  // founder can switch AND reach "+ New brand" even from a single-brand account.
  if (brands.length < 1) return null
  const multi = brands.length > 1

  // With one brand the tile just is that brand; with several, the active one (or All brands).
  const current = brands.find(b => b.id === active) || (!multi ? brands[0] : null)
  const label = current ? current.name : 'All brands'
  const tile = current ? current.name.trim().charAt(0).toUpperCase() : '◎'

  const pick = (id: string) => {
    if (id === active) { setOpen(false); return }   // no-op: don't refresh when they re-pick the current one
    const oneYear = 60 * 60 * 24 * 365
    document.cookie = `${BRAND_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${oneYear}; samesite=lax`
    setActive(id); setOpen(false)
    // Soft refresh — re-render server components with the new cookie (no white reload / no fade re-fire).
    // Client-fetch pages (inbox) listen for this event and re-pull without a full reload.
    router.refresh()
    window.dispatchEvent(new CustomEvent('sf:brandchange', { detail: { brandId: id } }))
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button aria-label={`Project: ${label}`} title={`Switch project — currently ${label}`} onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${open ? '#9fb98a' : '#e2e8dd'}`, borderRadius: 100, padding: '5px 12px 5px 6px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(20,29,21,0.04)' }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: '#ef4a1e', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{tile}</span>
        <span style={{ fontSize: 13, fontWeight: 750, color: '#141d15', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: '#8a968a', fontSize: 10, marginLeft: -2 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', left: 0, top: '100%', paddingTop: 6, zIndex: 70 }}>
          <div style={{ width: 220, background: '#fff', border: '1px solid #efece2', borderRadius: 14, boxShadow: '0 18px 50px rgba(20,29,21,0.16)', padding: '10px 8px' }}>
            <div style={{ padding: '2px 10px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#a2aca2' }}>Project</div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {multi && <button onClick={() => pick('')} style={rowStyle(!active)}>◎&nbsp;&nbsp;All brands</button>}
              {brands.map(b => (
                <button key={b.id} onClick={() => pick(b.id)} style={rowStyle(active === b.id)}>
                  <span style={{ width: 18, height: 18, borderRadius: 6, background: '#ef4a1e', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, marginRight: 9, flexShrink: 0 }}>{b.name.trim().charAt(0).toUpperCase()}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                </button>
              ))}
            </div>
            <div style={{ height: 1, background: '#eef1ec', margin: '6px 4px' }} />
            {/* New brand runs the FULL onboarding interview (crawl → competitors → async pulls → first
                report), same as the first brand — not the lighter wizard. ?new=1 marks it as an Nth brand. */}
            <a href="/onboarding?new=1" style={{ ...rowStyle(false), color: '#3b6d11', fontWeight: 750, textDecoration: 'none' }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: '#eaf3de', color: '#3b6d11', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, marginRight: 9 }}>+</span>
              New brand
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function rowStyle(on: boolean): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', border: 'none', background: on ? '#f2f7ec' : 'transparent', color: on ? '#141d15' : '#3c473c', borderRadius: 9, padding: '8px 10px', fontSize: 13, fontWeight: on ? 750 : 600, fontFamily: 'inherit', cursor: 'pointer' }
}
