'use client'
/**
 * Blog studio — the deep content agent's desk. Give it a topic (or pick a suggested buyer question), it
 * researches your real catalog + brand, writes a Ryze-grade article with Buy/Consider/Skip picks + a deep
 * FAQ, generates a hero image, and — on approval — publishes to your Shopify blog. Draft-first.
 */
import { useEffect, useState, useCallback } from 'react'
import { useEmbedded } from '@/lib/ui/embedded'
import { celebrate, blogPublished } from '@/lib/celebrate'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029'

type Draft = { id: string; title: string; target_prompt: string; body_markdown: string; status: string; published_url: string | null; created_at: string }
type Data = { connected: boolean; store?: { shop_name?: string; shop_domain?: string }; drafts?: Draft[]; topics?: string[] }

export default function BlogPage() {
  const embedded = useEmbedded()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState('')
  const [withImage, setWithImage] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string | null; html: string; title: string } | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/shopify/blog'); const j = await r.json(); setData(j) } catch { setData({ connected: false }) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const generate = async () => {
    setBusy('draft'); setNote(null); setPreview(null)
    try {
      const r = await fetch('/api/shopify/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', topic: topic.trim() || undefined, withImage }) })
      const j = await r.json()
      if (r.ok) { setPreview({ id: j.id, html: j.html, title: j.article?.title || 'Draft' }); setNote('Drafted — review below, then publish.'); await load() }
      else setNote(j.error || 'Could not generate.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const publish = async (id: string) => {
    setBusy(`pub:${id}`); setNote(null)
    try {
      const r = await fetch('/api/shopify/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', id }) })
      const j = await r.json()
      if (r.ok) { celebrate(blogPublished()); setNote(`Published → ${j.url}`); await load() }
      else setNote(j.error || 'Publish failed.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const discard = async (id: string) => {
    setBusy(`del:${id}`)
    try { await fetch('/api/shopify/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'discard', id }) }); if (preview?.id === id) setPreview(null); await load() } catch { /* noop */ }
    setBusy(null)
  }

  const openDraft = (d: Draft) => setPreview({ id: d.id, html: d.body_markdown, title: d.title })

  if (loading) return <Shell><div style={{ color: SUB }}>Loading…</div></Shell>
  if (!data?.connected) return (
    <Shell>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 26, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>No Shopify store connected</div>
        <div style={{ color: SUB, fontSize: 14, margin: '8px 0 16px' }}>The blog agent writes from your real catalog and publishes to your store.</div>
        <a href="/connect/shopify" style={{ background: LIME, color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Connect Shopify →</a>
      </div>
    </Shell>
  )

  const drafts = data.drafts || []
  return (
    <Shell>
      {!embedded && <>
        <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>{data.store?.shop_name || data.store?.shop_domain} · Content agent</div>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Write a blog that ranks</h1>
        <p style={{ color: SUB, fontSize: 15, margin: '0 0 20px', lineHeight: 1.5 }}>
          It reads your real products + brand, writes a buyer-intent article with Buy/Consider/Skip picks and a deep FAQ, and generates a hero image. Nothing publishes until you approve.
        </p>
      </>}

      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 18, fontSize: 14, fontWeight: 600, background: note.startsWith('Published') ? '#eaf6e6' : '#eef4fb', color: note.startsWith('Published') ? GOOD : '#28527a', border: `1px solid ${note.startsWith('Published') ? '#bfe3b6' : '#cddcf0'}`, wordBreak: 'break-word' }}>{note}</div>}

      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 20, marginBottom: 22 }}>
        <label style={{ fontSize: 13, fontWeight: 700 }}>Topic (or leave blank and it picks the highest-intent question)</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. best way to quit vaping without nicotine"
          style={{ width: '100%', marginTop: 8, padding: '12px 14px', fontSize: 15, borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        {(data.topics || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {(data.topics || []).map((t, i) => (
              <button key={i} onClick={() => setTopic(t)} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, color: INK, cursor: 'pointer', fontFamily: 'inherit' }}>{t}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={generate} disabled={!!busy} style={{ background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 14.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy === 'draft' ? 0.6 : 1 }}>{busy === 'draft' ? 'Researching + writing…' : 'Generate article'}</button>
          <label style={{ fontSize: 13, color: SUB, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} style={{ accentColor: LIME, width: 15, height: 15 }} /> Generate hero image
          </label>
        </div>
      </div>

      {preview && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Preview</div>
            {preview.id && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => discard(preview.id!)} disabled={!!busy} style={ghostBtn}>Discard</button>
                <button onClick={() => publish(preview.id!)} disabled={!!busy} style={{ ...primaryBtn, background: GOOD }}>{busy === `pub:${preview.id}` ? 'Publishing…' : 'Publish to Shopify →'}</button>
              </div>
            )}
          </div>
          <article className="blogbody" style={{ padding: 22, maxHeight: 620, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div style={{ fontSize: 15, fontWeight: 800, margin: '4px 0 12px' }}>Your articles</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drafts.map((d) => (
              <div key={d.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>
                    {d.status === 'published' && d.published_url
                      ? <>Published · <a href={d.published_url} target="_blank" rel="noreferrer" style={{ color: GOOD }}>view live →</a></>
                      : 'Draft'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openDraft(d)} style={ghostBtn}>Open</button>
                  {d.status !== 'published' && <button onClick={() => publish(d.id)} disabled={!!busy} style={{ ...primaryBtn, background: GOOD }}>{busy === `pub:${d.id}` ? 'Publishing…' : 'Publish'}</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <style>{`.blogbody h2{font-size:19px;font-weight:800;margin:22px 0 8px;color:${INK}} .blogbody h3{font-size:15.5px;font-weight:800;margin:16px 0 4px;color:${INK}} .blogbody p{font-size:15px;line-height:1.65;color:#2c3a2e;margin:0 0 12px} .blogbody ul{margin:0 0 12px 18px} .blogbody li{font-size:15px;line-height:1.6;color:#2c3a2e;margin:0 0 6px} .blogbody a{color:${LIME}} .blogbody img{width:100%;border-radius:12px;margin-bottom:12px}`}</style>
    </Shell>
  )
}

const primaryBtn: React.CSSProperties = { background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const ghostBtn: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

function Shell({ children }: { children: React.ReactNode }) {
  const embedded = useEmbedded()
  return <div style={{ maxWidth: embedded ? '100%' : 780, margin: '0 auto', padding: embedded ? '8px 0 30px' : '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
