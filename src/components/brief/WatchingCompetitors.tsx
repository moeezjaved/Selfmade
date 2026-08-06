'use client'
/**
 * WatchingCompetitors — the "Watching for <brand>" list on the brief. Confirms a just-added competitor is
 * really tracked and shows its crawl progress ("⏳ fetching their ads…" → "✓ 12 ads"), polling until it
 * settles. Also catches the common gotcha: a competitor added but NOT linked to the selected brand — it
 * shows those and offers one-click "Link to <brand>" so it stops being invisible.
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const INK = '#17251c', GREEN = '#3f8f4f', LINE = 'rgba(0,0,0,0.08)', FOREST = '#17251c', LIME = '#dffe95'

type Row = { pageId: string; brand: string; adCount: number; status: 'live' | 'crawling' | 'queued' | 'empty'; lastCrawledAt: string | null }
type Unlinked = { pageId: string; brand: string }
type Data = { watching: Row[]; unlinked: Unlinked[] }

const LABEL: Record<Row['status'], (n: number) => string> = {
  live: (n) => `✓ ${n} ad${n === 1 ? '' : 's'}`,
  crawling: () => '⏳ fetching their ads…',
  queued: () => '⏳ queued — fetching soon',
  empty: () => 'no live ads found',
}
const COLOR: Record<Row['status'], string> = { live: GREEN, crawling: '#b7791f', queued: '#b7791f', empty: '#a7b0a5' }

export default function WatchingCompetitors({ brandId, brandName }: { brandId?: string | null; brandName?: string | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<any>(null)

  const load = () => {
    fetch(`/api/discovery/watching${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.watching)) setData({ watching: j.watching, unlinked: j.unlinked || [] }) }).catch(() => {})
  }
  useEffect(() => { load(); return () => { if (timer.current) clearInterval(timer.current) } }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.watching || []
  const unlinked = data?.unlinked || []

  // Poll while anything is still loading, so it flips to "live" on its own.
  useEffect(() => {
    const stillLoading = rows.some(r => r.status === 'crawling' || r.status === 'queued')
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    if (stillLoading) timer.current = setInterval(load, 20000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [data])   // eslint-disable-line react-hooks/exhaustive-deps

  // Force a fresh crawl so ads load now.
  const fetchNow = async () => {
    setBusy(true)
    try {
      const j = await fetch('/api/guardian/recheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandId }) }).then(r => r.json())
      if (j?.ok) toast.success(`Fetching ads for ${j.queued} competitor${j.queued === 1 ? '' : 's'} — this can take a bit.`)
      else toast.error('Could not start the fetch.')
    } catch { toast.error('Could not start the fetch.') } finally { setBusy(false) }
  }
  // Link the unlinked spied competitors to THIS brand (sets followed_brands.brand_id).
  const linkAll = async () => {
    if (!brandId || !unlinked.length) return
    setBusy(true)
    try {
      for (const u of unlinked) {
        await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: u.pageId, brandName: u.brand, action: 'follow', brandId, spied: true }) }).catch(() => {})
      }
      toast.success(`Linked ${unlinked.length} competitor${unlinked.length === 1 ? '' : 's'} to ${brandName || 'this brand'}.`)
      load()
    } catch { toast.error('Could not link.') } finally { setBusy(false) }
  }

  if (!data || (rows.length === 0 && unlinked.length === 0)) return null

  return (
    <div style={{ marginTop: 12 }}>
      {rows.length > 0 && (<>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a7b0a5', marginBottom: 8 }}>
          Watching {rows.length} competitor{rows.length === 1 ? '' : 's'}{brandName ? ` for ${brandName}` : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <Link key={r.pageId} href={`/discovery/brand-spy/${r.pageId}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{r.brand}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: COLOR[r.status], whiteSpace: 'nowrap' }}>{LABEL[r.status](r.adCount)}</span>
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          {rows.some(r => r.status !== 'live') && (
            <button onClick={fetchNow} disabled={busy} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '5px 13px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Starting…' : '↻ Fetch their ads now'}</button>
          )}
          {rows.some(r => r.status === 'crawling' || r.status === 'queued') && <span style={{ fontSize: 11, color: '#a7b0a5' }}>New competitors take a little while to load — this updates on its own.</span>}
        </div>
      </>)}

      {/* Added but not linked to this brand — the "I added it but nothing shows" case. */}
      {rows.length === 0 && unlinked.length > 0 && brandId && (
        <div style={{ background: '#fef6e7', border: '1px solid #f2e3c0', borderRadius: 12, padding: '12px 14px', marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 750, color: '#9a6a12', marginBottom: 4 }}>You’re watching {unlinked.length} competitor{unlinked.length === 1 ? '' : 's'}, but {unlinked.length === 1 ? 'it isn’t' : 'they aren’t'} linked to {brandName || 'this brand'}.</div>
          <div style={{ fontSize: 12, color: '#7a6a4a', marginBottom: 8 }}>{unlinked.map(u => u.brand).join(', ')}</div>
          <button onClick={linkAll} disabled={busy} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Linking…' : `Link to ${brandName || 'this brand'} →`}</button>
        </div>
      )}
    </div>
  )
}
