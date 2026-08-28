'use client'
/**
 * Blog studio — the deep content agent's desk. Give it a topic (or pick a suggested buyer question), it
 * researches your real catalog + brand, writes a Ryze-grade article with Buy/Consider/Skip picks + a deep
 * FAQ, generates a hero image, and — on approval — publishes to your Shopify blog. Draft-first.
 */
import { useEffect, useState, useCallback } from 'react'
import { useEmbedded } from '@/lib/ui/embedded'
import { celebrate, blogPublished } from '@/lib/celebrate'
import { openCredits } from '@/components/credits/CreditModal'
import { requireUpgrade } from '@/lib/ui/requireUpgrade'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029'

type Seo = { keyword?: string; metaTitle?: string; metaDescription?: string; secondary?: string[] }
type Draft = { id: string; title: string; target_prompt: string; body_markdown: string; status: string; published_url: string | null; created_at: string; seo?: Seo | null }
type Data = { connected: boolean; selectBrand?: boolean; brandName?: string; store?: { shop_name?: string; shop_domain?: string }; drafts?: Draft[]; topics?: string[] }

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
  useEffect(() => { const h = () => load(); window.addEventListener('sf:brandchange', h); return () => window.removeEventListener('sf:brandchange', h) }, [load])

  const generate = async () => {
    setBusy('draft'); setNote(null); setPreview(null)
    try {
      const r = await fetch('/api/shopify/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', topic: topic.trim() || undefined, withImage }) })
      const j = await r.json()
      if (r.ok) { setPreview({ id: j.id, html: j.html, title: j.article?.title || 'Draft' }); setNote('Drafted — review below, then publish.'); await load() }
      else if (r.status === 402) { if (!(await requireUpgrade())) openCredits('buy', j.reason || 'Writing a blog costs credits — top up to continue.') }   // free → /upgrade; paid → top up
      else if (j.error === 'reserve_failed') setNote('Couldn’t reserve credits for this — the pricing for blog drafts isn’t configured yet. Try again shortly.')
      else setNote(j.error || 'Could not generate.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  const publish = async (id: string) => {
    if (await requireUpgrade()) return   // free → employment agreement + payment wall
    setBusy(`pub:${id}`); setNote(null)
    try {
      const r = await fetch('/api/shopify/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', id }) })
      const j = await r.json()
      if (r.ok) { celebrate(blogPublished()); setNote(`Published → ${j.url}`); await load() }
      else if (r.status === 402) { openCredits('plan', j.reason || 'Publishing to your live blog is a paid feature.') }
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
  if (data?.selectBrand) return (
    <Shell>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Select a brand</div>
        <div style={{ color: SUB, fontSize: 14.5, margin: '8px auto 0', maxWidth: 420, lineHeight: 1.5 }}>Content is written and published per brand. Pick a brand from the switcher at the <b>top-left</b> and the content agent works on that brand&rsquo;s catalog.</div>
      </div>
    </Shell>
  )
  if (!data?.connected) return (
    <Shell>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 26, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Connect {data?.brandName || 'this brand'}&rsquo;s Shopify store</div>
        <div style={{ color: SUB, fontSize: 14, margin: '8px 0 16px' }}>The blog agent writes from {data?.brandName || 'this brand'}&rsquo;s real catalog and publishes to its store. Connect Shopify to this brand to write &amp; publish.</div>
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
              <div key={d.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{d.title}</div>
                    <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>
                      {d.status === 'published' && d.published_url
                        ? <>Published · <a href={d.published_url} target="_blank" rel="noreferrer" style={{ color: GOOD }}>view live →</a></>
                        : 'Draft'}
                      {d.seo?.keyword && <> · targeting <b style={{ color: INK }}>{d.seo.keyword}</b></>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openDraft(d)} style={ghostBtn}>Open</button>
                    {d.status !== 'published' && <button onClick={() => publish(d.id)} disabled={!!busy} style={{ ...primaryBtn, background: GOOD }}>{busy === `pub:${d.id}` ? 'Publishing…' : 'Publish'}</button>}
                  </div>
                </div>
                {/* SEO at a glance — the Google search preview + the keyword cluster this page targets. */}
                {(d.seo?.metaTitle || d.seo?.keyword) && (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
                    {d.seo?.metaTitle && (
                      <div style={{ background: '#f7f9f6', borderRadius: 8, padding: '8px 11px' }}>
                        <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Google preview</div>
                        <div style={{ fontSize: 14, color: '#1a0dab', fontWeight: 600, lineHeight: 1.3 }}>{d.seo.metaTitle}</div>
                        {d.seo?.metaDescription && <div style={{ fontSize: 12, color: '#4d5156', marginTop: 2, lineHeight: 1.4 }}>{d.seo.metaDescription}</div>}
                      </div>
                    )}
                    {!!(d.seo?.secondary && d.seo.secondary.length) && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>Also targets:</span>
                        {d.seo.secondary.map((k, i) => <span key={i} style={{ fontSize: 11.5, color: INK, background: '#eef3ea', borderRadius: 100, padding: '2px 9px' }}>{k}</span>)}
                      </div>
                    )}
                  </div>
                )}
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
