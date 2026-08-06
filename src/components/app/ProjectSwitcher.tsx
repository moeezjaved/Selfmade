'use client'
/**
 * The project switcher on the rail — pick a brand once and the WHOLE app scopes to it (brief, inbox,
 * everything reads the same `sf_brand` cookie). Shows only when the founder has 2+ brands (pointless for
 * one). Compact for the 72px rail: a rounded tile with the active brand's initial; hover opens a flyout
 * to switch or jump back to All brands. Switching writes the cookie + reloads so every surface re-scopes.
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

export default function ProjectSwitcher() {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [active, setActive] = useState<string>('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActive(readCookie(BRAND_COOKIE))
    fetch('/api/brands').then(r => r.ok ? r.json() : null)
      .then(j => setBrands((j?.brands || []).map((b: any) => ({ id: String(b.id), name: String(b.name) }))))
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
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: 6 }}>
      <button aria-label={`Project: ${label}`} title={`Project: ${label}`} onClick={() => setOpen(o => !o)}
        style={{ width: 34, height: 34, borderRadius: 11, border: `1px solid ${open ? '#9fb98a' : '#d6ddd4'}`, background: current ? '#17251c' : '#fff', color: current ? '#dffe95' : '#5b6b5b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, cursor: 'pointer', padding: 0 }}>
        {tile}
      </button>
      {open && (
        <div style={{ position: 'absolute', left: '100%', top: -6, paddingLeft: 10, zIndex: 70 }}>
          <div style={{ width: 210, background: '#fff', border: '1px solid #e7ece7', borderRadius: 14, boxShadow: '0 18px 50px rgba(23,37,28,0.16)', padding: '10px 8px' }}>
            <div style={{ padding: '2px 10px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#a2aca2' }}>Project</div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {multi && <button onClick={() => pick('')} style={rowStyle(!active)}>◎&nbsp;&nbsp;All brands</button>}
              {brands.map(b => (
                <button key={b.id} onClick={() => pick(b.id)} style={rowStyle(active === b.id)}>
                  <span style={{ width: 18, height: 18, borderRadius: 6, background: '#17251c', color: '#dffe95', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, marginRight: 9, flexShrink: 0 }}>{b.name.trim().charAt(0).toUpperCase()}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                </button>
              ))}
            </div>
            <div style={{ height: 1, background: '#eef1ec', margin: '6px 4px' }} />
            <a href="/brands/new" style={{ ...rowStyle(false), color: '#3b6d11', fontWeight: 750, textDecoration: 'none' }}>
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
  return { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', border: 'none', background: on ? '#f2f7ec' : 'transparent', color: on ? '#17251c' : '#3c473c', borderRadius: 9, padding: '8px 10px', fontSize: 13, fontWeight: on ? 750 : 600, fontFamily: 'inherit', cursor: 'pointer' }
}
