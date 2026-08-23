'use client'
/**
 * Catalog cluster — the review desk. Three agents (SEO, Description, Image alt) draft fixes for the gaps
 * in your synced Shopify catalog; you approve, we write them back to the store. Approve-mode: nothing
 * changes on Shopify until you click Approve. Before/after on every draft.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029'

type Health = { products: number; missingSeoTitle: number; missingSeoDesc: number; imagesMissingAlt: number; drafts: number }
type Draft = { id: string; product_gid: string; product_title: string; agent: string; proposal: any; status: string }
type Data = {
  connected: boolean; store?: { shop_domain: string; shop_name?: string; currency?: string }
  health?: Health | null; drafts?: Record<string, Draft[]>; counts?: Record<string, number>
}

const AGENTS = [
  { key: 'seo', name: 'SEO title & description', blurb: 'Search-result copy for products missing it', gap: (h?: Health | null) => h?.missingSeoTitle ?? 0, gapLabel: 'missing SEO title' },
  { key: 'description', name: 'Description writer', blurb: 'Richer PDP body from the product’s own facts', gap: () => null, gapLabel: 'thin descriptions' },
  { key: 'alt', name: 'Image alt text', blurb: 'Accessibility + image SEO for photos with no alt', gap: (h?: Health | null) => h?.imagesMissingAlt ?? 0, gapLabel: 'images without alt' },
] as const

export default function CatalogPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)   // which agent's drafts are expanded
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try { const r = await fetch('/api/shopify/catalog'); const j = await r.json(); setData(j) } catch { setData({ connected: false }) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const draft = async (agent: string) => {
    setBusy(`draft:${agent}`); setNote(null)
    try {
      const r = await fetch('/api/shopify/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', agent, limit: 25 }) })
      const j = await r.json()
      if (r.ok) { setNote(`Drafted ${j.created} ${agent} fix${j.created === 1 ? '' : 'es'} — review below.`); setOpen(agent); await load() }
      else setNote(j.error || 'Could not draft.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const apply = async (ids: string[]) => {
    if (!ids.length) { setNote('Select at least one to approve.'); return }
    setBusy('apply'); setNote(null)
    try {
      const r = await fetch('/api/shopify/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', draftIds: ids }) })
      const j = await r.json()
      if (r.ok) { setNote(`Applied ${j.applied} to Shopify${j.failed ? `, ${j.failed} failed` : ''}.`); setSelected({}); await load() }
      else setNote(j.error || 'Could not apply.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const skip = async (ids: string[]) => {
    setBusy('skip')
    try { await fetch('/api/shopify/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'skip', draftIds: ids }) }); setSelected({}); await load() } catch { /* noop */ }
    setBusy(null)
  }

  if (loading) return <Shell><div style={{ color: SUB }}>Loading your catalog…</div></Shell>
  if (!data?.connected) return (
    <Shell>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 26, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>No Shopify store connected</div>
        <div style={{ color: SUB, fontSize: 14, margin: '8px 0 16px' }}>The Catalog agents run on your live store.</div>
        <a href="/connect/shopify" style={{ background: LIME, color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Connect Shopify →</a>
      </div>
    </Shell>
  )

  const h = data.health
  return (
    <Shell>
      <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>{data.store?.shop_name || data.store?.shop_domain} · Catalog cluster</div>
      <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Fix your catalog</h1>
      <p style={{ color: SUB, fontSize: 15, margin: '0 0 22px', lineHeight: 1.5 }}>
        {h ? `${h.products} products · ${h.missingSeoTitle} missing SEO title · ${h.imagesMissingAlt} images without alt.` : 'Your synced catalog.'} The agents draft the fix; nothing changes on Shopify until you approve.
      </p>

      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 18, fontSize: 14, fontWeight: 600, background: '#eef4fb', color: '#28527a', border: '1px solid #cddcf0' }}>{note}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {AGENTS.map((a) => {
          const drafts = data.drafts?.[a.key] || []
          const gap = a.gap(h)
          const expanded = open === a.key
          return (
            <div key={a.key} style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: 18, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{a.name}
                    {drafts.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: LIME, background: '#fff1ec', borderRadius: 20, padding: '2px 9px', marginLeft: 8 }}>{drafts.length} drafted</span>}
                  </div>
                  <div style={{ fontSize: 13, color: SUB, marginTop: 3 }}>{a.blurb}{gap != null ? ` · ${gap} ${a.gapLabel}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {drafts.length > 0 && <button onClick={() => setOpen(expanded ? null : a.key)} style={ghostBtn}>{expanded ? 'Hide' : 'Review'}</button>}
                  <button onClick={() => draft(a.key)} disabled={!!busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy === `draft:${a.key}` ? 'Drafting…' : drafts.length ? 'Draft more' : 'Draft fixes'}</button>
                </div>
              </div>

              {expanded && drafts.length > 0 && (
                <div style={{ borderTop: `1px solid ${LINE}`, background: PAPER, padding: 16 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <button onClick={() => apply(drafts.map((d) => d.id))} disabled={busy === 'apply'} style={{ ...primaryBtn, background: GOOD, opacity: busy === 'apply' ? 0.6 : 1 }}>{busy === 'apply' ? 'Applying…' : `Approve all ${drafts.length} → Shopify`}</button>
                    <button onClick={() => apply(drafts.filter((d) => selected[d.id]).map((d) => d.id))} disabled={busy === 'apply'} style={ghostBtn}>Approve selected</button>
                    <button onClick={() => skip(drafts.filter((d) => selected[d.id]).map((d) => d.id))} disabled={!!busy} style={ghostBtn}>Skip selected</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {drafts.map((d) => (
                      <DraftCard key={d.id} d={d} checked={!!selected[d.id]} onToggle={() => setSelected((s) => ({ ...s, [d.id]: !s[d.id] }))} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Shell>
  )
}

function DraftCard({ d, checked, onToggle }: { d: Draft; checked: boolean; onToggle: () => void }) {
  const p = d.proposal || {}
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 14, display: 'flex', gap: 12 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: 3, width: 16, height: 16, accentColor: LIME, flex: 'none' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 8 }}>{d.product_title}</div>
        {d.agent === 'seo' && <>
          <Field label="Title" cur={p.title?.current} next={p.title?.proposed} />
          <Field label="Meta description" cur={p.description?.current} next={p.description?.proposed} />
        </>}
        {d.agent === 'description' && <Field label="Description" cur={strip(p.current)} next={strip(p.proposed)} />}
        {d.agent === 'alt' && (p.images || []).map((im: any, i: number) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: 'none', border: `1px solid ${LINE}` }} />
            <div style={{ minWidth: 0, flex: 1 }}><Field label={`Image ${i + 1} alt`} cur={im.current} next={im.proposed} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, cur, next }: { label: string; cur?: string | null; next?: string | null }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{label}</div>
      {cur ? <div style={{ fontSize: 12.5, color: '#9a5b52', textDecoration: 'line-through', lineHeight: 1.4, marginBottom: 2 }}>{cur}</div> : <div style={{ fontSize: 12, color: '#c0392b', fontStyle: 'italic', marginBottom: 2 }}>— empty —</div>}
      <div style={{ fontSize: 12.5, color: GOOD, lineHeight: 1.4, fontWeight: 600 }}>{next}</div>
    </div>
  )
}

const strip = (h?: string | null) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const primaryBtn: React.CSSProperties = { background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const ghostBtn: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
