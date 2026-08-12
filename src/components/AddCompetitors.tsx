'use client'
/**
 * ADD COMPETITORS — the step that only existed inside onboarding.
 *
 * Creating a brand anywhere else (My Brands, the studio's "New brand") wrote the brand row and
 * stopped, so Mello had nothing to watch for it and the brand never showed up in a brief. This is
 * that missing step, reusable: search the index, pick rivals, and run the SAME two calls onboarding
 * runs — enqueue the full-archive crawl, then follow (which is what feeds alerts → the brief).
 *
 * Competitors attach to a brand via followed_brands.brand_id (migration 117): the follow call
 * carries brandId, so a rival is watched FOR this brand, not just pooled on the account.
 */
import { useEffect, useRef, useState } from 'react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#e3e2da', GREEN = '#ef4a1e', FOREST = '#141d15', LIME = '#ff5a2c'
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
  const [howOpen, setHowOpen] = useState(false)   // "how to find the Meta Ad Library link" steps
  const [link, setLink] = useState('')            // dedicated Meta Ad Library link box (separate from name search)
  const [saved, setSaved] = useState<string[] | null>(null)   // names just added → show the "on it" confirmation
  const [existing, setExisting] = useState(0)                  // competitors already watched FOR this brand
  const [lowCredits, setLowCredits] = useState(false)          // hit insufficient credits mid-confirm
  const inputRef = useRef<HTMLInputElement>(null)

  // Pricing: the FIRST competitor for a brand is free (matches onboarding); each one after costs 50cr.
  // We count what's already watched for this brand so the notice + total are honest before they confirm.
  useEffect(() => {
    fetch('/api/follows').then(r => r.ok ? r.json() : null).then(j => {
      const rows: any[] = Array.isArray(j?.brands) ? j.brands : []
      const mine = rows.filter(f => f && f.spied && (brandId ? f.brand_id === brandId : true))
      setExisting(mine.length)
    }).catch(() => {})
  }, [brandId])

  // How many of the current picks are free vs paid. free slots = 1 minus what's already there (min 0).
  const freeSlots = Math.max(0, 1 - existing)
  const paidCount = Math.max(0, picks.length - freeSlots)
  const totalCost = paidCount * 50

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
    }).catch(() => {})
  }, [industry])

  // No niche (or none that matches) → fall back to searching the brand's own name. The niche
  // vocabulary is deliberately coarse (24 categories like DTC / Fashion), so it's a BROWSE tool for
  // big advertisers, not a precision competitor finder — the name search is what actually surfaces
  // a direct rival ("Bug Shield" → Bug MD). Offer both rather than trading one for the other.
  useEffect(() => {
    if (niche) return
    const seed = (brandName || '').split(/\s+/)[0] || ''
    if (!seed) { setSuggested([]); setLoading(false); return }
    setLoading(true)
    Promise.all([
      fetch(`/api/discovery/pages?q=${encodeURIComponent(seed)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/discovery/brands?q=${encodeURIComponent(seed)}&sort=ads`).then(r => r.json()).catch(() => null),
    ]).then(([p, b]) => {
      const seen = new Set<string>(); const out: Comp[] = []
      for (const x of [...(p?.pages || []), ...(b?.brands || [])]) {
        const id = String(x.pageId || ''); if (!id || seen.has(id)) continue
        seen.add(id); out.push({ pageId: id, name: x.name, avatar: x.picture || x.avatar || null, adCount: x.adCount ?? null })
      }
      setSuggested(out.slice(0, 8))
    }).finally(() => setLoading(false))
  }, [niche, brandName])

  // A niche IS selected → show that niche's biggest advertisers.
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

  /**
   * First competitor for a brand is FREE (crawl + follow, like onboarding); every one after costs 50cr
   * (the real /brand-spy charge — which also crawls + marks it spied). Either way it lands in Brand Spy.
   */
  const confirm = async () => {
    if (!picks.length || busy) return
    setBusy(true); setLowCredits(false)
    let n = 0
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i]
      const isFree = i < freeSlots
      if (isFree) {
        await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, name: p.name, crawlOnly: true }) }).catch(() => {})
        await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, brandName: p.name, action: 'follow', brandId: brandId || undefined, spied: true }) }).catch(() => {})
      } else {
        // Paid spy: charges 50cr (free if the org already paid for this brand before), crawls, marks spied.
        const r = await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, name: p.name }) }).catch(() => null)
        if (r && r.status === 402) { setLowCredits(true); setBusy(false); return }   // out of credits → stop, tell them
        // Attach it to THIS brand so it's watched for the right product (brand-spy doesn't carry brandId).
        if (brandId) await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, brandName: p.name, action: 'follow', brandId, spied: true }) }).catch(() => {})
      }
      n++; setDone(n)
    }
    // Also keep a human-readable trail in Mello's notebook (belt-and-suspenders alongside brand_id).
    fetch('/api/interview/notebook', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ kind: 'fact', content: `Competitors to watch for ${brandName}: ${picks.map(p => p.name).join(', ')}.` }], brandId: brandId || undefined }),
    }).catch(() => {})
    setBusy(false); onDone?.(picks.length); setSaved(picks.map(p => p.name))   // show the "I'm on it" state, don't close silently
    // Tell the brief's live competitor list to re-pull so the new competitor appears without a manual reload.
    try { window.dispatchEvent(new CustomEvent('sf:competitor-added')) } catch { /* no-op */ }
  }

  const pickedIds = new Set(picks.map(p => p.pageId))
  const manualId = extractPageId(q)
  const list = q.trim() ? results : suggested
  const manual: Comp | null = manualId && !pickedIds.has(manualId) && !list.some(r => r.pageId === manualId)
    ? { pageId: manualId, name: `Facebook page ${manualId}` } : null
  // Dedicated Meta Ad Library link box (separate from the name search).
  const linkId = extractPageId(link)
  const addFromLink = () => {
    if (!linkId) return
    if (!pickedIds.has(linkId)) toggle({ pageId: linkId, name: `Facebook page ${linkId}` })
    setLink('')
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.45)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px,96vw)', background: '#fff', borderRadius: 18, padding: '22px 24px 20px', maxHeight: '88vh', overflowY: 'auto' }}>
        {saved ? (
          // "On it" confirmation — the crawl is queued; the brief fills + an email lands when ads load.
          <div style={{ textAlign: 'center', padding: '10px 4px 4px' }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#eef7d6', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 22 }}>🛰️</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 24, color: INK, lineHeight: 1.2 }}>On it — watching {saved.length} for {brandName}.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0', textAlign: 'left' }}>
              {saved.map((nm, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: INK, background: '#f6f8f5', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
                  <span className="ac-spin" style={{ width: 14, height: 14, border: `2px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, flex: 1 }}>{nm}</span>
                  <span style={{ fontSize: 12, color: MUTED }}>reading their archive…</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, margin: '0 0 16px' }}>
              I’m pulling their full ad archive now — it can take a few minutes. I’ll <b style={{ color: INK }}>email you</b> the moment their ads are loaded, and they’ll show up on your brief.
            </p>
            <button onClick={onClose} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '11px 26px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
            <style>{`.ac-spin{animation:acspin 1s linear infinite}@keyframes acspin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (<>
        <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 25, color: INK, lineHeight: 1.2 }}>
          Who should I watch for {brandName}?
        </div>
        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6, margin: '6px 0 10px' }}>
          I’ll read their whole ad archive tonight and tell you the morning they launch something.
          Without this, there’s nothing for me to report on this brand.
        </p>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: '0 0 16px', padding: '8px 11px', background: '#f5f8f0', border: `1px solid ${LINE}`, borderRadius: 10 }}>
          {existing > 0
            ? <>You’re already watching {existing} for this brand — <b style={{ color: INK }}>each new competitor is 50 cr</b>.</>
            : <>Your <b style={{ color: INK }}>first competitor for this brand is free</b> — each one after is <b style={{ color: INK }}>50 cr</b>.</>}
        </div>

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
          placeholder="Search a competitor by name…"
          style={{ border: `1.5px solid ${LINE}`, borderRadius: 12, padding: '11px 14px', fontSize: 14, width: '100%', fontFamily: 'inherit', color: INK, outline: 'none', boxSizing: 'border-box' }} />
        {/* SEPARATE path — add a competitor by their Meta Ad Library link (its own box, not the name search).
            Most users don't know how to get that link, so the how-to is one click away. */}
        <div style={{ marginTop: 12, padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 12, background: '#f9faf7' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>🔗 Or add by Meta Ad Library link</div>
            <button onClick={() => setHowOpen(o => !o)} style={{ background: 'none', border: 'none', color: GREEN, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>{howOpen ? 'Hide steps' : 'How do I get it?'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFromLink() }}
              placeholder="Paste the facebook.com/ads/library/… link"
              style={{ flex: 1, border: `1.5px solid ${linkId ? GREEN : LINE}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', color: INK, outline: 'none', boxSizing: 'border-box' }} />
            <button onClick={addFromLink} disabled={!linkId}
              style={{ background: linkId ? FOREST : '#dfe4de', color: linkId ? LIME : '#9aa79a', border: 'none', borderRadius: 100, padding: '0 18px', fontSize: 13, fontWeight: 800, cursor: linkId ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Add</button>
          </div>
          {link.trim() && !linkId && <div style={{ fontSize: 11.5, color: '#a3552b', marginTop: 6 }}>That doesn’t look like a Meta Ad Library link — it should contain <code style={{ background: '#eef2ec', padding: '1px 4px', borderRadius: 4 }}>view_all_page_id=…</code></div>}
          {howOpen && (
            <ol style={{ margin: '10px 0 0', padding: '10px 12px 10px 28px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, color: INK, fontSize: 12, lineHeight: 1.7 }}>
              <li>Open the <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ color: GREEN, fontWeight: 700 }}>Meta Ad Library</a> (opens in a new tab).</li>
              <li>Set <b>Ad category</b> to “All ads”, pick the country, and search the brand’s name.</li>
              <li>Click the brand to open <b>their</b> page of ads.</li>
              <li>Copy the URL from the address bar — it contains <code style={{ background: '#eef2ec', padding: '1px 4px', borderRadius: 4 }}>view_all_page_id=…</code></li>
              <li>Paste it here and hit <b>Add</b>.</li>
            </ol>
          )}
        </div>

        <div style={{ marginTop: 10, minHeight: 90 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: MUTED, padding: '6px 2px' }}>
            {q.trim() ? 'Search results' : loading ? 'Looking…' : suggested.length ? (niche ? `Biggest advertisers in ${niche}` : 'Possible rivals — recognise any?') : 'Pick a niche above, or search by name'}
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

        {lowCredits && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: '#a3552b', background: '#fdf3ec', border: '1px solid #f0dcc9', borderRadius: 10, padding: '9px 12px', lineHeight: 1.5 }}>
            You’re out of credits for the paid competitors. The free one was added — top up to watch the rest.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <button onClick={confirm} disabled={!picks.length || busy}
            style={{ background: picks.length && !busy ? FOREST : '#dfe4de', color: picks.length && !busy ? LIME : '#9aa79a', border: 'none', borderRadius: 100, padding: '12px 22px', fontSize: 14, fontWeight: 800, cursor: picks.length && !busy ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {busy ? `Setting up… ${done}/${picks.length}` : picks.length ? `Watch ${picks.length} for me${totalCost > 0 ? ` · ${totalCost} cr` : ' · free'} →` : 'Pick at least one'}
          </button>
          {picks.length > 0 && !busy && totalCost > 0 && (
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{freeSlots > 0 ? `1 free · ${paidCount} × 50 cr` : `${paidCount} × 50 cr`}</span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
        </div>
        </>)}
      </div>
    </div>
  )
}

const rowStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
  background: on ? SELBG : 'transparent', border: `1.5px solid ${on ? SELBORDER : 'transparent'}`,
  borderRadius: 11, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit',
})
