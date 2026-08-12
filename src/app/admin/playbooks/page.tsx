'use client'
/**
 * ADMIN · Playbooks — Moeez's curation desk. Create a playbook, then fill it two
 * ways: MANUAL (search the 4.6M-ad library, click to add) and AI (top-N winners by
 * niche/hook/format from performance + longevity). Reorder, feature, remove.
 * Everything the public /playbooks pages render comes from here.
 */
import { useCallback, useEffect, useState } from 'react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', LIME = '#ff5a2c', FOREST = '#141d15'
const NICHES = ['Beauty', 'Fashion', 'Health & Wellness', 'Supplements', 'Home & Garden', 'Food & Beverage', 'Pets', 'Tech & Gadgets', 'Finance', 'Education']
const HOOKS = ['Pain Point', 'Testimonial', 'Social Proof', 'Before & After', 'Question', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them']
const FORMATS = ['UGC', 'Studio / Produced', 'Graphic / Text', 'Mixed']

type Book = { id: string; title: string; slug: string; description?: string; emoji?: string; featured: boolean; sort_order: number; ad_count: number; updated_at: string }
type Ad = { adId: string; brand?: string; hook?: string; format?: string; niche?: string; days?: number; score?: number; media?: { img?: string; video?: string | null }; position?: number; featured?: boolean }

const btn: React.CSSProperties = { border: `1.5px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '8px 15px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer', color: INK }
const primary: React.CSSProperties = { ...btn, background: FOREST, color: LIME, border: 'none' }
const input: React.CSSProperties = { border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', fontSize: 13.5, fontWeight: 600, color: INK, outline: 'none', fontFamily: 'inherit' }

export default function AdminPlaybooks() {
  const [books, setBooks] = useState<Book[]>([])
  const [sel, setSel] = useState<Book | null>(null)
  const [ads, setAds] = useState<Ad[]>([])
  const [results, setResults] = useState<Ad[]>([])
  const [q, setQ] = useState('')
  const [nicheFilter, setNicheFilter] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // create form
  const [nTitle, setNTitle] = useState(''); const [nEmoji, setNEmoji] = useState(''); const [nDesc, setNDesc] = useState('')
  // ai fill
  const [aiNiche, setAiNiche] = useState('Beauty'); const [aiHook, setAiHook] = useState(''); const [aiFormat, setAiFormat] = useState(''); const [aiCount, setAiCount] = useState('100')

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const loadBooks = useCallback(async () => {
    const r = await fetch('/api/admin/playbooks'); const d = await r.json()
    if (Array.isArray(d.playbooks)) setBooks(d.playbooks)
  }, [])
  const loadAds = useCallback(async (id: string) => {
    const r = await fetch(`/api/admin/playbooks/ads?playbookId=${id}`); const d = await r.json()
    setAds(Array.isArray(d.ads) ? d.ads : [])
  }, [])
  useEffect(() => { loadBooks() }, [loadBooks])
  useEffect(() => { if (sel) loadAds(sel.id) }, [sel, loadAds])

  const create = async () => {
    if (!nTitle.trim()) return
    setBusy(true)
    const r = await fetch('/api/admin/playbooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nTitle, emoji: nEmoji, description: nDesc, featured: true }) })
    const d = await r.json(); setBusy(false)
    if (d.playbook) { setNTitle(''); setNEmoji(''); setNDesc(''); flash('Playbook created'); await loadBooks(); setSel(d.playbook) }
    else flash(d.error || 'Failed')
  }
  const search = async () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (nicheFilter) p.set('niche', nicheFilter)
    const r = await fetch(`/api/admin/playbooks/ads?${p}`); const d = await r.json()
    setResults(Array.isArray(d.ads) ? d.ads : [])
  }
  const add = async (adId: string) => {
    if (!sel) return
    await fetch('/api/admin/playbooks/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playbookId: sel.id, adIds: [adId] }) })
    loadAds(sel.id); loadBooks()
  }
  const remove = async (adId: string) => {
    if (!sel) return
    await fetch(`/api/admin/playbooks/ads?playbookId=${sel.id}&adId=${adId}`, { method: 'DELETE' })
    loadAds(sel.id); loadBooks()
  }
  const move = async (adId: string, dir: -1 | 1) => {
    if (!sel) return
    const i = ads.findIndex((a) => a.adId === adId); const j = i + dir
    if (i < 0 || j < 0 || j >= ads.length) return
    await Promise.all([
      fetch('/api/admin/playbooks/ads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playbookId: sel.id, adId: ads[i].adId, position: ads[j].position }) }),
      fetch('/api/admin/playbooks/ads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playbookId: sel.id, adId: ads[j].adId, position: ads[i].position }) }),
    ])
    loadAds(sel.id)
  }
  const aifill = async () => {
    if (!sel) return
    setBusy(true)
    const r = await fetch('/api/admin/playbooks/aifill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playbookId: sel.id, niche: aiNiche || undefined, hook: aiHook || undefined, formatStyle: aiFormat || undefined, count: parseInt(aiCount) || 100 }) })
    const d = await r.json(); setBusy(false)
    flash(d.ok ? `AI added ${d.added} winners` : (d.error || 'Failed'))
    loadAds(sel.id); loadBooks()
  }
  const togglePb = async (b: Book, patch: any) => {
    await fetch('/api/admin/playbooks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, ...patch }) })
    loadBooks()
  }

  const Thumb = ({ a, action, actionLabel, extra }: { a: Ad; action: () => void; actionLabel: string; extra?: React.ReactNode }) => (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'relative', aspectRatio: '3/4', background: '#0d120e' }}>
        {a.media?.img && /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.media.img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        {a.media?.video && <span style={{ position: 'absolute', right: 6, bottom: 5, color: '#fff', fontSize: 10, background: 'rgba(0,0,0,.45)', borderRadius: 6, padding: '1px 6px', fontWeight: 800 }}>▶</span>}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.brand || '—'}</div>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 650 }}>{[a.hook, a.days ? `${a.days}d` : null].filter(Boolean).join(' · ') || a.niche || ''}</div>
        <div style={{ display: 'flex', gap: 5, marginTop: 7, alignItems: 'center' }}>
          <button onClick={action} style={{ ...btn, padding: '5px 10px', fontSize: 11 }}>{actionLabel}</button>
          {extra}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f6f8f5', fontFamily: "'Inter', -apple-system, sans-serif", color: INK, padding: '28px 26px 90px' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Playbooks</h1>
        <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>Curated walls of winning ads — manual + AI. What you build here is live at <b>/playbooks</b>.</div>
        {msg && <div style={{ marginTop: 10, background: '#f4fbe6', border: '1px solid #cfe9a4', color: '#2c4a1f', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, display: 'inline-block' }}>{msg}</div>}

        {/* create */}
        <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={nEmoji} onChange={(e) => setNEmoji(e.target.value)} placeholder="💄" style={{ ...input, width: 56, textAlign: 'center' }} />
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="Beauty Playbook" style={{ ...input, width: 220 }} />
          <input value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="100 winning beauty ads. Continuously updated." style={{ ...input, flex: 1, minWidth: 220 }} />
          <button onClick={create} disabled={busy} style={primary}>Create playbook</button>
        </div>

        {/* list */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {books.map((b) => (
            <button key={b.id} onClick={() => setSel(b)} style={{ ...btn, background: sel?.id === b.id ? FOREST : '#fff', color: sel?.id === b.id ? LIME : INK }}>
              {b.emoji ? `${b.emoji} ` : ''}{b.title} · {b.ad_count}
            </button>
          ))}
          {books.length === 0 && <span style={{ fontSize: 13, color: MUTED }}>No playbooks yet — create the first above.</span>}
        </div>

        {sel && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{sel.emoji} {sel.title} <span style={{ color: MUTED, fontWeight: 650, fontSize: 13 }}>/playbooks/{sel.slug}</span></h2>
              <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                <input type="checkbox" checked={books.find((b) => b.id === sel.id)?.featured ?? false} onChange={(e) => togglePb(sel, { featured: e.target.checked })} /> featured on /playbooks
              </label>
              <a href={`/playbooks/${sel.slug}`} target="_blank" style={{ ...btn, textDecoration: 'none' }}>View live →</a>
            </div>

            {/* AI fill */}
            <div style={{ marginTop: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: MUTED }}>AI FILL</span>
              <select value={aiNiche} onChange={(e) => setAiNiche(e.target.value)} style={input}><option value="">any niche</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select>
              <select value={aiHook} onChange={(e) => setAiHook(e.target.value)} style={input}><option value="">any hook</option>{HOOKS.map((h) => <option key={h}>{h}</option>)}</select>
              <select value={aiFormat} onChange={(e) => setAiFormat(e.target.value)} style={input}><option value="">any format</option>{FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
              <input value={aiCount} onChange={(e) => setAiCount(e.target.value)} style={{ ...input, width: 70 }} />
              <button onClick={aifill} disabled={busy} style={primary}>{busy ? 'Curating…' : 'Add top winners'}</button>
              <span style={{ fontSize: 11.5, color: MUTED }}>ranked by performance · 14d+ runners · duplicates skipped</span>
            </div>

            {/* manual search */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search the library — brand or copy…" style={{ ...input, width: 280 }} />
              <select value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} style={input}><option value="">any niche</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select>
              <button onClick={search} style={btn}>Search</button>
            </div>
            {results.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginTop: 12 }}>
                {results.map((a) => <Thumb key={a.adId} a={a} action={() => add(a.adId)} actionLabel="＋ Add" />)}
              </div>
            )}

            {/* current ads */}
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: MUTED, textTransform: 'uppercase', margin: '22px 0 10px' }}>In this playbook · {ads.length}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
              {ads.map((a) => (
                <Thumb key={a.adId} a={a} action={() => remove(a.adId)} actionLabel="Remove"
                  extra={<span style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                    <button onClick={() => move(a.adId, -1)} style={{ ...btn, padding: '5px 8px', fontSize: 11 }}>↑</button>
                    <button onClick={() => move(a.adId, 1)} style={{ ...btn, padding: '5px 8px', fontSize: 11 }}>↓</button>
                  </span>} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
