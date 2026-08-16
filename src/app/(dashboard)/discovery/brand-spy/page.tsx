'use client'
/**
 * Brand Spy — directory + "Start Spying on Competitors" modal (Foreplay-style). Spying any
 * brand charges brand_spy credits the first time a user spies it (free to re-open), and
 * queues a full archive crawl. Fast list reads the per-brand summary table.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { refreshCredits } from '@/components/credits/CreditCounter'
import { showUpsell } from '@/components/UpsellModal'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

// Read a cookie client-side — same as ProjectSwitcher, to default the "link to your brand" picker
// to the active project (?brand / sf_brand cookie) so a new spy attaches to the right brand.
function readCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}

type Brand = { pageId: string; name: string; adCount: number; active: number | null; inactive: number | null; video: number | null; image: number | null; carousel: number | null; crawled?: boolean }

function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none', color: active ? '#111' : '#6b7280', background: active ? 'rgba(255,90,44,0.5)' : '#f3f4f6', border: 'none', cursor: 'pointer' }
}

export default function BrandSpyList() {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // Modal state
  const [open, setOpen] = useState(false)
  const [modalTab, setModalTab] = useState<'search' | 'manual'>('search')
  const [mQ, setMQ] = useState('')
  const [mResults, setMResults] = useState<Brand[]>([])
  const [manualUrl, setManualUrl] = useState('')
  const [msg, setMsg] = useState('')
  const [confirmSpy, setConfirmSpy] = useState<{ payload: { url?: string; pageId?: string; name?: string }; busyKey: string; name: string } | null>(null)  // in-app dialog
  const [confirmUnspy, setConfirmUnspy] = useState<Brand | null>(null)  // un-spy confirmation

  // "Link to your brand" — a spied competitor attaches to one of the user's own brands (followed_brands
  // .brand_id, mig 117) so it scopes the right brief. Defaults to the active project (sf_brand cookie).
  const [myBrands, setMyBrands] = useState<{ id: string; name: string }[]>([])
  const [linkBrandId, setLinkBrandId] = useState<string>('')
  useEffect(() => {
    fetch('/api/brands').then(r => r.ok ? r.json() : null).then(j => {
      const list: { id: string; name: string }[] = (j?.brands || []).map((b: any) => ({ id: String(b.id), name: b.name || 'Untitled' }))
      setMyBrands(list)
      const active = readCookie(BRAND_COOKIE)
      setLinkBrandId(list.find(b => b.id === active)?.id || (list.length === 1 ? list[0].id : ''))
    }).catch(() => {})
  }, [])

  const fetchBrands = useCallback(async (query: string, scope: 'mine' | 'all'): Promise<Brand[]> => {
    const p = new URLSearchParams({ scope }); if (query) p.set('q', query)
    // Pass the active project explicitly (from the same sf_brand cookie the switcher writes) so "mine"
    // scopes to the selected brand deterministically — not reliant on the server re-reading the cookie.
    if (scope === 'mine') { const b = readCookie(BRAND_COOKIE); if (b) p.set('brand', b) }
    const res = await fetch(`/api/discovery/brand-spy?${p}`)
    const j = await res.json().catch(() => ({}))
    return j.brands || []
  }, [])

  const load = useCallback(async (query: string) => { setLoading(true); try { setBrands(await fetchBrands(query, 'mine')) } finally { setLoading(false) } }, [fetchBrands])
  useEffect(() => { const t = setTimeout(() => load(q.trim()), q ? 300 : 0); return () => clearTimeout(t) }, [q, load])
  // Re-pull when the project brand switcher changes brand. router.refresh() only re-renders SERVER
  // components; this is a client-fetch page (reads the sf_brand cookie at fetch time), so without this it
  // kept showing the brand that was active on first load. Mirrors the inbox's sf:brandchange listener.
  useEffect(() => {
    const onBrand = () => { setBrands([]); load(q.trim()) }
    window.addEventListener('sf:brandchange', onBrand)
    return () => window.removeEventListener('sf:brandchange', onBrand)
  }, [q, load])
  // Modal search
  useEffect(() => { if (!open) return; const t = setTimeout(async () => setMResults(await fetchBrands(mQ.trim(), 'all')), 250); return () => clearTimeout(t) }, [mQ, open, fetchBrands])

  // Open the in-app confirmation (was a browser window.confirm).
  const spy = (payload: { url?: string; pageId?: string; name?: string }, busyKey: string) => {
    setMsg('')
    setConfirmSpy({ payload, busyKey, name: payload.name || 'this brand' })
  }
  const doSpy = async () => {
    if (!confirmSpy) return
    const { payload, busyKey } = confirmSpy
    setConfirmSpy(null); setBusy(busyKey)
    try {
      const res = await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await res.json()
      if (!res.ok) { if (showUpsell(j)) { setBusy(null); return } setMsg(j.message || j.error || 'Failed'); setBusy(null); return }
      // Attach the follow to the chosen brand — brand-spy's insert doesn't carry brand_id, so /api/follows
      // does the first-assignment link (same pattern as AddCompetitors / WatchingCompetitors). Best-effort.
      if (linkBrandId && j.pageId) {
        await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: String(j.pageId), brandName: confirmSpy.name, action: 'follow', brandId: linkBrandId, spied: true }) }).catch(() => {})
      }
      refreshCredits()
      router.push(`/discovery/brand-spy/${j.pageId}`)
    } catch (e) { setMsg(String(e)); setBusy(null) }
  }

  // Stop spying → DELETE the follow, drop the row from the tracked list.
  const doUnspy = async () => {
    if (!confirmUnspy) return
    const b = confirmUnspy; setConfirmUnspy(null); setBusy(b.pageId)
    try {
      await fetch(`/api/discovery/brand-spy?pageId=${encodeURIComponent(b.pageId)}`, { method: 'DELETE' })
      setBrands((prev) => prev.filter((x) => x.pageId !== b.pageId))
    } catch (e) { setMsg(String(e)) } finally { setBusy(null) }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <style>{`.bs-row:hover{background:#fafafa}.bs-mrow:hover{background:#f6f8ff}`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link href="/discovery/brand-spy" style={tab(true)}>Brands</Link>
          <Link href="/discovery/brand-spy/feed" style={tab(false)}>Feed</Link>
        </div>
        <button onClick={() => { setOpen(true); setModalTab('search'); setMQ(''); setManualUrl(''); setMsg('') }}
          style={{ padding: '9px 16px', background: '#2075ff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          + Spy new brand
        </button>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 2 }}>Brand Spy</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Track any competitor’s Meta ads over time — format mix, launch cadence, active-ad trends, creative tests, and the hooks they run.</div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your brands…"
        style={{ width: 360, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 14, outline: 'none' }} />

      <div style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 150px 150px', minWidth: 660, padding: '10px 16px', borderBottom: '1px solid #eee', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <div>Brand</div><div>Ads (active · inactive)</div><div>Type</div><div style={{ textAlign: 'right' }}>Tracking</div>
        </div>
        {loading && <div style={{ padding: 24, color: '#9ca3af', fontSize: 14 }}>Loading your brands…</div>}
        {!loading && brands.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{q ? `No spied brand matches “${q}”` : 'You’re not spying on any brands yet'}</div>
            <div style={{ fontSize: 13, marginBottom: 14 }}>Add a competitor to start tracking its Meta ads — format mix, creative tests, hooks, and a full active/inactive history.</div>
            <button onClick={() => { setOpen(true); setModalTab('search'); setMQ(''); setManualUrl(''); setMsg('') }}
              style={{ padding: '9px 18px', background: '#2075ff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>+ Spy your first brand</button>
          </div>
        )}
        {brands.map((b) => (
          <div key={b.pageId} className="bs-row" onClick={() => busy ? null : router.push(`/discovery/brand-spy/${b.pageId}`)}
            style={{ display: 'grid', gridTemplateColumns: '1fr 200px 150px 150px', minWidth: 660, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f3f4f6', cursor: busy ? 'wait' : 'pointer' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.pageId}</div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              {b.active != null
                ? <span><span style={{ color: '#ef4a1e', fontWeight: 700 }}>{b.active.toLocaleString()}</span> active · <span style={{ color: '#9ca3af' }}>{(b.inactive ?? 0).toLocaleString()} inactive</span></span>
                : <span>{b.adCount.toLocaleString()} ads</span>}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 8 }}>
              {b.video != null && <span title="Video">🎬 {b.video}</span>}
              {b.image != null && <span title="Image">🖼️ {b.image}</span>}
              {b.carousel != null && b.carousel > 0 && <span title="Carousel/DCO">▦ {b.carousel}</span>}
              {b.active == null && <span>—</span>}
            </div>
            <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#2075ff', background: 'rgba(32,117,255,0.08)', padding: '5px 12px', borderRadius: 999 }}>Open →</span>
              <button onClick={(e) => { e.stopPropagation(); if (!busy) setConfirmUnspy(b) }} disabled={!!busy}
                title="Stop spying — remove from your tracked brands"
                style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', background: 'rgba(185,28,28,0.07)', border: 'none', padding: '5px 12px', borderRadius: 999, cursor: busy ? 'wait' : 'pointer' }}>
                {busy === b.pageId ? '…' : 'Stop'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── "Start Spying on Competitors" modal ── */}
      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#111' }}>Start Spying on Competitors</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Track &amp; save every ad your competitors launch.</div>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#9ca3af', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', gap: 6, margin: '16px 0 14px' }}>
              <button onClick={() => setModalTab('search')} style={tab(modalTab === 'search')}>Search Brand</button>
              <button onClick={() => setModalTab('manual')} style={tab(modalTab === 'manual')}>Add Manually</button>
            </div>

            {/* Link the new competitor to one of your own brands so it scopes the right brief. */}
            {myBrands.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Spy for</span>
                <select value={linkBrandId} onChange={(e) => setLinkBrandId(e.target.value)}
                  style={{ flex: 1, minWidth: 160, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', color: '#111', outline: 'none', cursor: 'pointer' }}>
                  <option value="">All brands (not linked)</option>
                  {myBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}

            {modalTab === 'search' ? (
              <div>
                <input autoFocus value={mQ} onChange={(e) => setMQ(e.target.value)} placeholder="Type a brand name…"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10, border: mResults.length ? '1px solid #eee' : 'none', borderRadius: 8 }}>
                  {mResults.map((b) => (
                    <div key={b.pageId} className="bs-mrow" onClick={() => spy({ pageId: b.pageId, name: b.name }, b.pageId)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#111', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.pageId}</span>
                        {b.crawled
                          ? <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#ef4a1e', background: 'rgba(22,163,74,0.1)', padding: '2px 7px', borderRadius: 999 }}>CRAWLED · instant</span>
                          : <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '2px 7px', borderRadius: 999 }}>NEW · will crawl</span>}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 13, color: '#6b7280', marginLeft: 8 }}>{b.adCount ? `${b.adCount.toLocaleString()} ads` : ''}</span>
                    </div>
                  ))}
                  {mQ && mResults.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#9ca3af' }}>No brand matches — use “Add Manually” to spy any Facebook page by URL.</div>}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Facebook Ad Library URL</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input autoFocus value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="facebook.com/ads/library/?…view_all_page_id=123…"
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' }} />
                  <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ padding: '10px 14px', background: '#f3f4f6', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#374151', textDecoration: 'none', whiteSpace: 'nowrap' }}>↗ Ad Library</a>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', background: '#f9fafb', borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
                  Copy the Facebook Ad Library <b>page URL</b> of a brand — <b>not a keyword search</b>.
                </div>
                <button onClick={() => manualUrl.trim() && spy({ url: manualUrl.trim() }, 'manual')} disabled={busy === 'manual' || !manualUrl.trim()}
                  style={{ marginTop: 14, width: '100%', padding: '11px', background: '#2075ff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy === 'manual' || !manualUrl.trim() ? 0.6 : 1 }}>
                  {busy === 'manual' ? 'Spying…' : 'Add Brand'}
                </button>
              </div>
            )}

            {msg && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 10 }}>{msg}</div>}
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>◆ Included in your plan’s tracked-brand cap · continuous tracking until removed</div>
          </div>
        </div>
      )}

      {/* In-app spy confirmation (replaces the browser window.confirm) */}
      {confirmSpy && (
        <div onClick={() => setConfirmSpy(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px,96vw)', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Spy “{confirmSpy.name}”?</div>
            <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, lineHeight: 1.55 }}>
              We’ll crawl their full ad archive from the Meta Ad Library and track it over time. This costs <b>50 credits ($0.50)</b> — one-time per brand; re-adding a brand you’ve already spied is free.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmSpy(null)} style={{ background: 'none', border: '1px solid #e5e7eb', color: '#374151', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={doSpy} style={{ background: '#ef4a1e', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Spy this brand</button>
            </div>
          </div>
        </div>
      )}

      {/* Un-spy confirmation */}
      {confirmUnspy && (
        <div onClick={() => setConfirmUnspy(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px,96vw)', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111', textTransform: 'capitalize' }}>Stop spying “{confirmUnspy.name || confirmUnspy.pageId}”?</div>
            <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, lineHeight: 1.55 }}>
              It’ll be removed from your tracked brands and you’ll stop getting new-ad alerts for it. You can re-add it any time — it stays free within your plan.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmUnspy(null)} style={{ background: 'none', border: '1px solid #e5e7eb', color: '#374151', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={doUnspy} style={{ background: '#b91c1c', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Stop spying</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
