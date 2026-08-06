'use client'
/**
 * WatchingCompetitors — the "Watching for <brand>" list on the brief. Confirms a just-added competitor is
 * really tracked, and shows its crawl progress ("⏳ fetching their ads…" → "✓ 12 ads") so it never looks
 * like nothing happened. Polls while anything is still crawling/queued so it updates on its own.
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const INK = '#17251c', SUB = '#7a9a7a', MUTED = '#6b6b6b', LINE = 'rgba(0,0,0,0.08)', GREEN = '#3f8f4f'

type Row = { pageId: string; brand: string; adCount: number; status: 'live' | 'crawling' | 'queued' | 'empty'; lastCrawledAt: string | null }

const LABEL: Record<Row['status'], (n: number) => string> = {
  live: (n) => `✓ ${n} ad${n === 1 ? '' : 's'}`,
  crawling: () => '⏳ fetching their ads…',
  queued: () => '⏳ queued — fetching soon',
  empty: () => 'no live ads found',
}
const COLOR: Record<Row['status'], string> = { live: GREEN, crawling: '#b7791f', queued: '#b7791f', empty: '#a7b0a5' }

export default function WatchingCompetitors({ brandId, brandName }: { brandId?: string | null; brandName?: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const timer = useRef<any>(null)

  // Force a fresh crawl of these competitors so their ads load NOW instead of waiting for the cycle.
  const fetchNow = async () => {
    setFetching(true)
    try {
      const j = await fetch('/api/guardian/recheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandId }) }).then(r => r.json())
      if (j?.ok) toast.success(`Fetching ads for ${j.queued} competitor${j.queued === 1 ? '' : 's'} — this can take a bit.`)
      else toast.error('Could not start the fetch.')
    } catch { toast.error('Could not start the fetch.') } finally { setFetching(false) }
  }

  const load = () => {
    fetch(`/api/discovery/watching${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.watching)) setRows(j.watching) }).catch(() => {})
  }
  useEffect(() => {
    load()
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 20s while anything is still loading, so it flips to "live" on its own; stop once settled.
  useEffect(() => {
    const stillLoading = (rows || []).some(r => r.status === 'crawling' || r.status === 'queued')
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    if (stillLoading) timer.current = setInterval(load, 20000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [rows])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows || rows.length === 0) return null   // nothing spied yet → the "+ Add a competitor" prompt covers it

  return (
    <div style={{ marginTop: 12 }}>
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
          <button onClick={fetchNow} disabled={fetching} style={{ background: '#17251c', color: '#dffe95', border: 'none', borderRadius: 100, padding: '5px 13px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: fetching ? 'default' : 'pointer', opacity: fetching ? 0.6 : 1 }}>
            {fetching ? 'Starting…' : '↻ Fetch their ads now'}
          </button>
        )}
        {rows.some(r => r.status === 'crawling' || r.status === 'queued') && (
          <span style={{ fontSize: 11, color: '#a7b0a5' }}>New competitors take a little while to load — this updates on its own.</span>
        )}
      </div>
    </div>
  )
}
