'use client'
/**
 * Competitor SEO/GEO intelligence — see what rivals publish and where you have content gaps, then build the
 * pages to beat them. Free (reads their public sitemap + pages). Traffic/keyword numbers layer in when a
 * keyword API is connected.
 */
import { useEffect, useState, useCallback } from 'react'
import { useEmbedded } from '@/lib/ui/embedded'
import { openCredits } from '@/components/credits/CreditModal'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029'

type Comp = { id: string; name: string; domain: string; page_count: number; blog_count: number; topics: { topic: string; count: number }[]; sample_titles: string[]; est_traffic: number | null; last_crawled: string | null }
type Data = { competitors: Comp[]; gaps: string[] }

export default function CompetitorsPage() {
  const embedded = useEmbedded()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')

  const load = useCallback(async () => {
    try { const r = await fetch('/api/seo/competitors'); const j = await r.json(); if (r.ok) setData(j) } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (bodyObj: any, busyKey: string) => {
    setBusy(busyKey); setNote(null)
    try {
      const r = await fetch('/api/seo/competitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) })
      const j = await r.json()
      if (!r.ok) {
        if (r.status === 402) openCredits('buy', j.reason || 'Analyzing a competitor costs credits — top up to continue.')
        else setNote(j.error || 'Failed.')
        setBusy(null); return null
      }
      return j
    } catch { setNote('Network error.'); setBusy(null); return null }
  }

  const add = async () => {
    if (!domain.trim()) { setNote('Enter a competitor domain.'); return }
    const j = await post({ action: 'add', name: name.trim() || undefined, domain: domain.trim() }, 'add')
    if (j) { setNote(j.empty ? `No public sitemap found for ${domain} — try their exact domain.` : `Analyzed ${domain}.`); setName(''); setDomain(''); await load() }
    setBusy(null)
  }
  const seed = async () => { const j = await post({ action: 'seed' }, 'seed'); if (j) { setNote(`Added ${j.added} competitor${j.added === 1 ? '' : 's'}.${j.note ? ' ' + j.note : ''}`); await load() } setBusy(null) }
  const refresh = async (id: string) => { const j = await post({ action: 'refresh', id }, `ref:${id}`); if (j) await load(); setBusy(null) }
  const remove = async (id: string) => { await post({ action: 'remove', id }, `rm:${id}`); await load(); setBusy(null) }
  const build = async (topic: string) => { const j = await post({ action: 'build', topic }, `build:${topic}`); if (j) setNote(`Drafted "${j.title}" — review in Content →`); setBusy(null) }

  if (loading) return <Shell><div style={{ color: SUB }}>Loading…</div></Shell>
  const comps = data?.competitors || []
  const gaps = data?.gaps || []

  return (
    <Shell>
      {!embedded && <>
        <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>Competitor intelligence</div>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>What rivals rank for — and your gaps</h1>
        <p style={{ color: SUB, fontSize: 15, margin: '0 0 20px', lineHeight: 1.5 }}>
          We read each rival’s public content to see what they publish, then find the buyer-intent pages they cover and you don’t. Build those pages to take their traffic.
        </p>
      </>}

      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 18, fontSize: 14, fontWeight: 600, background: '#eef4fb', color: '#28527a', border: '1px solid #cddcf0' }}>{note}</div>}

      {/* Add / seed */}
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 18, marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" style={{ ...inp, maxWidth: 160 }} />
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="competitor.com" style={{ ...inp, flex: 1, minWidth: 160 }} />
          <button onClick={add} disabled={!!busy} style={{ ...primaryBtn, opacity: busy === 'add' ? 0.6 : 1 }}>{busy === 'add' ? 'Analyzing…' : 'Analyze'}</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12.5, color: SUB }}>
          Or <button onClick={seed} disabled={!!busy} style={{ background: 'none', border: 'none', color: LIME, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0, fontSize: 12.5 }}>{busy === 'seed' ? 'seeding…' : 'auto-add from your known competitors'}</button> — then correct any domains.
        </div>
      </div>

      {/* Competitors */}
      {comps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 26 }}>
          {comps.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{c.name || c.domain}</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{c.domain} · {c.page_count} pages · {c.blog_count} content pages{c.est_traffic ? ` · ~${c.est_traffic.toLocaleString()} visits/mo` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => refresh(c.id)} disabled={!!busy} style={ghostBtn}>{busy === `ref:${c.id}` ? '…' : 'Refresh'}</button>
                  <button onClick={() => remove(c.id)} disabled={!!busy} style={{ ...ghostBtn, color: '#c0392b' }}>Remove</button>
                </div>
              </div>
              {(c.topics || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {(c.topics || []).slice(0, 14).map((t, i) => (
                    <span key={i} style={{ fontSize: 12, color: INK, background: '#f3f6f2', borderRadius: 100, padding: '3px 10px' }}>{t.topic}</span>
                  ))}
                </div>
              )}
              {(c.sample_titles || []).length > 0 && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>What they publish</div>
                  {(c.sample_titles || []).slice(0, 5).map((t, i) => <div key={i} style={{ fontSize: 13, color: '#2c3a2e', marginBottom: 3 }}>· {t}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Content gaps → build */}
      {gaps.length > 0 && (
        <div style={{ border: `1.5px solid ${LIME}`, borderRadius: 16, background: '#fff', padding: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3 }}>Content gaps — pages to steal their traffic</div>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 14 }}>Buyer-intent topics rivals cover and you don’t. Draft one and it lands in Content for review.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gaps.map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 14px' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{g}</span>
                <button onClick={() => build(g)} disabled={!!busy} style={{ ...primaryBtn, padding: '7px 14px' }}>{busy === `build:${g}` ? 'Drafting…' : 'Write it →'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paid layer note */}
      <div style={{ marginTop: 22, fontSize: 12.5, color: SUB, lineHeight: 1.5, border: `1px dashed ${LINE}`, borderRadius: 12, padding: 14 }}>
        <b style={{ color: INK }}>Coming with a keyword API:</b> real organic traffic per rival, the exact keywords they rank for (position + volume), and which of your pages to build first by opportunity. Connect Ahrefs / DataForSEO / SimilarWeb to unlock the numbers — the free content-gap engine above works today.
      </div>
    </Shell>
  )
}

const inp: React.CSSProperties = { padding: '10px 13px', fontSize: 14, borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const ghostBtn: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

function Shell({ children }: { children: React.ReactNode }) {
  const embedded = useEmbedded()
  return <div style={{ maxWidth: embedded ? '100%' : 780, margin: '0 auto', padding: embedded ? '8px 0 30px' : '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
