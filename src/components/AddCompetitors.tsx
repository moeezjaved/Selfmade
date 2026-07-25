'use client'
/**
 * ADD COMPETITORS — the step that only existed inside onboarding.
 *
 * Creating a brand anywhere else (My Brands, the studio's "New brand") wrote the brand row and
 * stopped, so Mello had nothing to watch for it and the brand never showed up in a brief. This is
 * that missing step, reusable: search the index, pick rivals, and run the SAME two calls onboarding
 * runs — enqueue the full-archive crawl, then follow (which is what feeds alerts → the brief).
 *
 * Note: followed_brands is keyed (user_id, page_id) with no brand_id, so competitors are still
 * pooled per USER, not per brand. brandId is accepted and recorded in the notebook so the intent
 * survives until that column exists.
 */
import { useEffect, useRef, useState } from 'react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e3e2da', GREEN = '#3f8f4f', FOREST = '#17251c', LIME = '#dffe95'
const SELBG = '#f4fbe6', SELBORDER = '#a8cf6f'

type Comp = { pageId: string; name: string; avatar?: string | null; adCount?: number | null }

/** Pull a Meta page id out of an Ad Library link (view_all_page_id=…) or a bare numeric id. */
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  if (/^\d{5,}$/.test(t)) return t
  const m = t.match(/[?&]view_all_page_id=(\d+)/) || t.match(/facebook\.com\/(\d{5,})/)
  return m ? m[1] : null
}

export default function AddCompetitors({ brandId, brandName, website, industry, onClose, onDone }: {
  brandId: string | null; brandName: string; website?: string | null; industry?: string[] | null
  onClose: () => void; onDone?: (n: number) => void
}) {
  const [q, setQ] = useState('')
  const [suggested, setSuggested] = useState<Comp[]>([])
  const [results, setResults] = useState<Comp[]>([])
  const [picks, setPicks] = useState<Comp[]>([])
  const [loading, setLoading] = useState(true)
  const [niches, setNiches] = useState<string[]>([])
  const [niche, setNiche] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Seed from the brand's NICHE, ranked by how much each rival actually advertises — far better
  // than a name fragment ("Bug Shield" once suggested Mountain Buggy). The niche is selectable,
  // because our guess at a brand's industry is often close-but-wrong.
  useEffect(() => {
    fetch('/api/discovery/brands?sort=ads').then(r => r.json()).then(j => {
      const list: string[] = Array.isArray(j?.industries) ? j.industries : []
      setNiches(list)
      const mine = (industry || []).map(x => String(x).toLowerCase())
      const match = list.find(n => mine.includes(String(n).toLowerCase()))
      setNiche(match || '')
      if (!match) setLoading(false)
    }).catch(() => setLoading(false))
  }, [industry])

  // Whenever the niche changes, show that niche's biggest advertisers.
  useEffect(() => {
    if (!niche) return
    setLoading(true)
    fetch(`/api/discovery/brands?industry=${encodeURIComponent(niche)}&sort=ads`)
      .then(r => r.json())
      .then(j => {
        const out: Comp[] = (j?.brands || []).map((x: any) => ({
          pageId: String(x.pageId || ''), name: x.name, avatar: x.avatar || x.picture || null, adCount: x.adCount ?? x.source_ad_count ?? null,
        })).filter((c: Comp) => c.pageId)
        setSuggested(out.slice(0, 8))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [niche])

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      Promise.all([
        fetch(`/api/discovery/pages?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null),
        fetch(`/api/discovery/brands?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null),
      ]).then(([p, b]) => {
        const seen = new Set<string>(); const out: Comp[] = []
        for (const x of [...(p?.pages || []), ...(b?.brands || [])]) {
          const id = String(x.pageId || ''); if (!id || seen.has(id)) continue
          seen.add(id); out.push({ pageId: id, name: x.name, avatar: x.picture || x.avatar || null, adCount: x.adCount ?? null })
        }
        setResults(out.slice(0, 6))
      })
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const toggle = (c: Comp) => setPicks(p => p.some(x => x.pageId === c.pageId) ? p.filter(x => x.pageId !== c.pageId) : [...p, c])

  /** Exactly what onboarding does on confirm: crawl the archive, then follow (alerts → the brief). */
  const confirm = async () => {
    if (!picks.length || busy) return
    setBusy(true)
    let n = 0
    for (const p of picks) {
      await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, name: p.name, crawlOnly: true }) }).catch(() => {})
      await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, brandName: p.name, action: 'follow' }) }).catch(() => {})
      n++; setDone(n)
    }
    // Keep the brand↔competitor intent in the notebook until followed_brands carries a brand_id.
    fetch('/api/interview/notebook', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ kind: 'fact', content: `Competitors to watch for ${brandName}: ${picks.map(p => p.name).join(', ')}.` }], brandId: brandId || undefined }),
    }).catch(() => {})
    setBusy(false); onDone?.(picks.length); onClose()
  }

  const pickedIds = new Set(picks.map(p => p.pageId))
  const manualId = extractPageId(q)
  const list = q.trim() ? results : suggested
  const manual: Comp | null = manualId && !pickedIds.has(manualId) && !list.some(r => r.pageId === manualId)
    ? { pageId: manualId, name: `Facebook page ${manualId}` } : null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.45)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px,96vw)', background: '#fff', borderRadius: 18, padding: '22px 24px 20px', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 25, color: INK, lineHeight: 1.2 }}>
          Who should I watch for {brandName}?
        </div>
        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6, margin: '6px 0 16px' }}>
          I’ll read their whole ad archive tonight and tell you the morning they launch something.
          Without this, there’s nothing for me to report on this brand.
        </p>

        {picks.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {picks.map(p => (
              <button key={p.pageId} onClick={() => toggle(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: SELBG, border: `1.5px solid ${SELBORDER}`, color: INK, borderRadius: 100, padding: '5px 11px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }}>
                {p.name} <span style={{ color: MUTED, fontWeight: 800 }}>✕</span>
              </button>
            ))}
          </div>
        )}

        {niches.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 700 }}>Niche</span>
            <select value={niche} onChange={e => setNiche(e.target.value)}
              style={{ flex: 1, border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff', outline: 'none' }}>
              <option value="">Any niche — I’ll search by name</option>
              {niches.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder="Competitor name, or paste their Meta Ad Library link…"
          style={{ border: `1.5px solid ${LINE}`, borderRadius: 12, padding: '11px 14px', fontSize: 14, width: '100%', fontFamily: 'inherit', color: INK, outline: 'none', boxSizing: 'border-box' }} />

        <div style={{ marginTop: 10, minHeight: 90 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: MUTED, padding: '6px 2px' }}>
            {q.trim() ? 'Search results' : loading ? 'Finding the biggest advertisers…' : suggested.length ? (niche ? `Top advertisers in ${niche}` : 'Recognise any of these?') : 'Pick a niche above, or search by name'}
          </div>
          {manual && (
            <button onClick={() => { toggle(manual); setQ('') }} style={rowStyle(false)}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: '#eef2ec', display: 'grid', placeItems: 'center', fontSize: 14 }}>📘</span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: INK }}>Add from the Ad Library · page {manual.pageId}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: GREEN }}>+</span>
            </button>
          )}
          {list.filter(c => !pickedIds.has(c.pageId)).map(c => (
            <button key={c.pageId} onClick={() => { toggle(c); setQ('') }} style={rowStyle(false)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.avatar ? <img src={c.avatar} alt="" style={{ width: 26, height: 26, borderRadius: 8, objectFit: 'cover' }} />
                : <span style={{ width: 26, height: 26, borderRadius: 8, background: '#eef2ec', display: 'inline-block' }} />}
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: INK }}>{c.name}</span>
              {!!c.adCount && <span style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>{c.adCount} ads</span>}
              <span style={{ fontSize: 13, fontWeight: 900, color: '#c6cfc4' }}>+</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <button onClick={confirm} disabled={!picks.length || busy}
            style={{ background: picks.length && !busy ? FOREST : '#dfe4de', color: picks.length && !busy ? LIME : '#9aa79a', border: 'none', borderRadius: 100, padding: '12px 22px', fontSize: 14, fontWeight: 800, cursor: picks.length && !busy ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {busy ? `Setting up… ${done}/${picks.length}` : picks.length ? `Watch ${picks.length} for me →` : 'Pick at least one'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
        </div>
      </div>
    </div>
  )
}

const rowStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
  background: on ? SELBG : 'transparent', border: `1.5px solid ${on ? SELBORDER : 'transparent'}`,
  borderRadius: 11, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit',
})
