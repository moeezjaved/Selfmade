'use client'
/**
 * Programmatic SEO — build pages at scale from your real catalog, then bulk-publish. Shows the plan
 * (buying guides per product, landing pages per collection, comparisons vs real competitors), generates
 * batches (each a deep grounded article, not thin spam), and bulk-publishes the approved ones to Shopify.
 */
import { useEffect, useState, useCallback } from 'react'
import { useEmbedded } from '@/lib/ui/embedded'
import { openCredits } from '@/components/credits/CreditModal'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029'

type Plan = { total: number; byType: { guide: number; collection: number; comparison: number }; generated: number; remaining: number }
type Draft = { id: string; title: string; target_prompt: string; status: string; published_url: string | null }
type Data = { connected: boolean; store?: { shop_name?: string }; plan?: Plan; drafts?: Draft[]; counts?: { draft: number; published: number } }

export default function ProgrammaticPage() {
  const embedded = useEmbedded()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [batch, setBatch] = useState(5)
  const [withImage, setWithImage] = useState(false)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/shopify/programmatic'); const j = await r.json(); setData(j) } catch { setData({ connected: false }) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const generate = async () => {
    setBusy('gen'); setNote(null)
    try {
      const r = await fetch('/api/shopify/programmatic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'generate', limit: batch, withImage }) })
      const j = await r.json()
      if (r.ok) { setNote(`Generated ${j.created} page${j.created === 1 ? '' : 's'}${j.failed ? `, ${j.failed} failed` : ''}. ${j.remaining} left to build.`); await load() }
      else if (r.status === 402 && j.error === 'plan_limit') openCredits('plan', j.reason || 'Pages at Scale is a paid feature — upgrade to build pages.')
      else if (r.status === 402) openCredits('buy', j.reason || 'Generating pages costs credits — top up or upgrade.')
      else if (j.error === 'reserve_failed') setNote('Couldn’t reserve credits for this — the pricing for page generation isn’t configured yet. Try again shortly.')
      else setNote(j.error || 'Could not generate.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const publish = async (ids: string[]) => {
    if (!ids.length) { setNote('Select at least one page.'); return }
    setBusy('pub'); setNote(null)
    try {
      const r = await fetch('/api/shopify/programmatic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', ids }) })
      const j = await r.json()
      if (r.ok) { setNote(`Published ${j.published} to Shopify${j.failed ? `, ${j.failed} failed` : ''}.`); setSel({}); await load() }
      else setNote(j.error || 'Publish failed.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const discard = async (ids: string[]) => {
    setBusy('del')
    try { await fetch('/api/shopify/programmatic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'discard', ids }) }); setSel({}); await load() } catch { /* noop */ }
    setBusy(null)
  }

  if (loading) return <Shell><div style={{ color: SUB }}>Loading…</div></Shell>
  if (!data?.connected) return (
    <Shell>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 26, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>No Shopify store connected</div>
        <div style={{ color: SUB, fontSize: 14, margin: '8px 0 16px' }}>Programmatic SEO builds pages from your real catalog.</div>
        <a href="/connect/shopify" style={{ background: LIME, color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Connect Shopify →</a>
      </div>
    </Shell>
  )

  const plan = data.plan!
  const drafts = data.drafts || []
  const draftsOpen = drafts.filter((d) => d.status === 'draft')

  return (
    <Shell>
      {!embedded && <>
        <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>{data.store?.shop_name} · Programmatic SEO</div>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Build pages at scale</h1>
        <p style={{ color: SUB, fontSize: 15, margin: '0 0 22px', lineHeight: 1.5 }}>
          One deep page per product, collection, and competitor — grounded in your real catalog, not thin templates. Generate in batches, review, bulk-publish to your Shopify blog.
        </p>
      </>}

      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 18, fontSize: 14, fontWeight: 600, background: '#eef4fb', color: '#28527a', border: '1px solid #cddcf0' }}>{note}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="Buildable pages" value={plan.total} />
        <Stat label="Product guides" value={plan.byType.guide} />
        <Stat label="Collection pages" value={plan.byType.collection} />
        <Stat label="Comparisons" value={plan.byType.comparison} />
        <Stat label="Generated" value={plan.generated} accent />
      </div>

      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 18, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: INK, fontWeight: 700 }}>{plan.remaining} pages left to build</div>
        <label style={{ fontSize: 13, color: SUB, display: 'flex', alignItems: 'center', gap: 6 }}>Batch
          <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} style={{ padding: '5px 8px', borderRadius: 8, border: `1px solid ${LINE}`, fontFamily: 'inherit' }}>
            {[3, 5, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, color: SUB, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} style={{ accentColor: LIME }} /> + hero images (slower)
        </label>
        <button onClick={generate} disabled={!!busy || plan.remaining === 0} style={{ ...primaryBtn, marginLeft: 'auto', opacity: busy === 'gen' || plan.remaining === 0 ? 0.6 : 1 }}>{busy === 'gen' ? 'Generating…' : `Generate ${Math.min(batch, plan.remaining)} pages`}</button>
      </div>

      {draftsOpen.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '4px 0 12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Review queue ({draftsOpen.length})</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => publish(draftsOpen.map((d) => d.id))} disabled={busy === 'pub'} style={{ ...primaryBtn, background: GOOD }}>{busy === 'pub' ? 'Publishing…' : `Publish all ${draftsOpen.length} →`}</button>
              <button onClick={() => publish(draftsOpen.filter((d) => sel[d.id]).map((d) => d.id))} disabled={busy === 'pub'} style={ghostBtn}>Publish selected</button>
              <button onClick={() => discard(draftsOpen.filter((d) => sel[d.id]).map((d) => d.id))} disabled={!!busy} style={ghostBtn}>Discard selected</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draftsOpen.map((d) => (
              <label key={d.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!sel[d.id]} onChange={() => setSel((s) => ({ ...s, [d.id]: !s[d.id] }))} style={{ accentColor: LIME, width: 15, height: 15 }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0 }}>{d.title}</span>
                <span style={{ fontSize: 11, color: SUB, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>{d.target_prompt.split(':')[0]}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {(data.counts?.published || 0) > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 15, fontWeight: 800, margin: '0 0 12px' }}>Published ({data.counts!.published})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.filter((d) => d.status === 'published').map((d) => (
              <div key={d.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0 }}>{d.title}</span>
                {d.published_url && <a href={d.published_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: GOOD, fontWeight: 700 }}>view live →</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', background: '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? GOOD : INK, letterSpacing: '-.02em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontWeight: 600 }}>{label}</div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = { background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const ghostBtn: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

function Shell({ children }: { children: React.ReactNode }) {
  const embedded = useEmbedded()
  return <div style={{ maxWidth: embedded ? '100%' : 780, margin: '0 auto', padding: embedded ? '8px 0 30px' : '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
