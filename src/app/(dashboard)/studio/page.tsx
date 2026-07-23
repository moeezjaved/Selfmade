'use client'
/**
 * STUDIO — the two-pane creation surface (Ploy's editor, applied to ads).
 * LEFT: talk to Mello (reuses useChatStream + the real Mello agent) for angles,
 * hooks, ideas. RIGHT: the canvas — pick a brand + product photos, Generate, and the
 * ad renders inline; tweak it in plain language; Approve & download (the Publish
 * moment). Reuses the existing generation engine verbatim (/api/discovery/generate-ad
 * sync + /api/discovery/edit-image) — the working modals are untouched.
 */
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Upload, Download, Wand2, Loader2, ArrowUp, Check, Image as ImageIcon } from 'lucide-react'
import { useCredits, confirmCredits, refreshCredits } from '@/components/credits/CreditCounter'
import { useChatStream } from '@/components/mello/useChatStream'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Brand = { id: string; name: string; website?: string; brand_type?: string; brand_kit?: any; products?: { image_urls?: string[] }[] }
type Photo = { id: string; src: string }
const uid = () => Math.random().toString(36).slice(2)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })

export default function StudioPage() {
  const { balance } = useCredits()
  // ── chat (left) ──
  const chat = useChatStream()
  const [convId, setConvId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.messages])

  // ── canvas (right) ──
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string>('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [headline, setHeadline] = useState('')
  const [aspect, setAspect] = useState<'4:5' | '1:1' | '9:16' | '16:9'>('4:5')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ url: string; genId: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cost = 15

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(j => {
      const bs: Brand[] = j.brands || []; setBrands(bs)
      if (bs[0]) pickBrand(bs[0])
    }).catch(() => {})
    // open a Mello conversation for the left pane + a warm greeting
    fetch('/api/mello/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(j => { if (j?.conversation?.id) setConvId(j.conversation.id) }).catch(() => {})
    chat.setHistory([{ role: 'assistant', content: 'This is your studio. Pick a product on the right and hit Create — or tell me what you’re selling and I’ll suggest an angle and a hook first.' }])
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const pickBrand = (b: Brand) => {
    setBrandId(b.id)
    const imgs = (b.products || []).flatMap(p => p.image_urls || []).slice(0, 8)
    const ph = imgs.map(u => ({ id: uid(), src: u }))
    setPhotos(ph); setSelected(ph.slice(0, 2).map(p => p.id))
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = await Promise.all(Array.from(files).slice(0, 6).map(async f => ({ id: uid(), src: await fileToDataUrl(f) })))
    setPhotos(p => [...arr, ...p]); setSelected(s => Array.from(new Set([...arr.map(a => a.id), ...s])).slice(0, 3))
  }
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 3 ? s : [...s, id]))

  const send = () => {
    const t = draft.trim(); if (!t || !convId || chat.streaming) return
    setDraft(''); chat.sendMessage(convId, t)
  }

  const generate = async () => {
    setErr(null)
    const chosen = photos.filter(p => selected.includes(p.id)).map(p => p.src)
    if (!chosen.length) { setErr('Select at least one product photo.'); return }
    if (!confirmCredits('create an ad', cost, balance)) return
    const brand = brands.find(b => b.id === brandId)
    setBusy(true); setResult(null)
    try {
      const body = {
        brandId: brandId || undefined, productImages: chosen, brandName: brand?.name || undefined,
        colors: brand?.brand_kit?.colors, palette: brand?.brand_kit?.palette, fonts: brand?.brand_kit?.fonts, logo: brand?.brand_kit?.logo,
        newHeadline: headline.trim() || undefined, aspectRatio: aspect, imageSize: '2K',
      }
      const r = await fetch('/api/discovery/generate-ad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const t = await r.text(); let j: any; try { j = JSON.parse(t) } catch { j = { error: `HTTP ${r.status}` } }
      if (!r.ok || !j?.url) { setErr(j?.error === 'insufficient_credits' ? 'Not enough credits.' : j?.error || 'Generation failed — try again.'); return }
      setResult({ url: j.url, genId: j.generationId || null }); refreshCredits()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const applyEdit = async () => {
    if (!result || !editText.trim()) return
    setEditing(true); setErr(null)
    try {
      const j = await fetch('/api/discovery/edit-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: result.url, instruction: editText.trim(), tier: 'pro', parentId: result.genId, brandId: brandId || undefined }) }).then(r => r.json())
      const newUrl = j?.url || j?.image
      if (!newUrl) { setErr(j?.error === 'insufficient_credits' ? 'Not enough credits for an edit.' : j?.error || 'Edit failed.'); return }
      setResult({ url: newUrl, genId: j.generationId || result.genId }); setEditText(''); refreshCredits()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setEditing(false) }
  }

  const download = () => { if (result) { const a = document.createElement('a'); a.href = result.url; a.download = 'selfmade-ad.png'; a.target = '_blank'; a.click() } }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 0px)', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* ── LEFT · Mello ── */}
      <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px', borderBottom: `1px solid ${LINE}` }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: FOREST, color: LIME, display: 'grid', placeItems: 'center' }}><Sparkles size={16} /></span>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Mello</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
          {chat.messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 14, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '86%', fontSize: 13.5, lineHeight: 1.6, padding: '10px 13px', borderRadius: 14, background: m.role === 'user' ? FOREST : '#f2f5f0', color: m.role === 'user' ? '#eef5eb' : INK, whiteSpace: 'pre-wrap' }}>
                {m.content || (m.streaming ? <span style={{ opacity: .6 }}>…</span> : '')}
                {m.error && <span style={{ color: '#d64545' }}>{m.error}</span>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: '#f6f8f5', border: `1px solid ${LINE}`, borderRadius: 14, padding: '8px 10px' }}>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1} placeholder="Ask Mello for an angle, a hook…" style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: INK, fontFamily: 'inherit', maxHeight: 120 }} />
            <button onClick={send} disabled={!draft.trim() || chat.streaming} style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: draft.trim() ? FOREST : '#dfe4de', color: draft.trim() ? LIME : '#9aa79a', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}><ArrowUp size={16} /></button>
          </div>
        </div>
      </div>

      {/* ── RIGHT · the canvas ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#fbfcfa' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '26px 26px 80px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>Create an ad</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 3, marginBottom: 22 }}>Pick a product, and Mello designs an on-brand ad. Approve when you love it.</div>

          {/* brand */}
          {brands.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>Brand</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {brands.map(b => (
                  <button key={b.id} onClick={() => pickBrand(b)} style={{ border: `1.5px solid ${brandId === b.id ? GREEN : LINE}`, background: brandId === b.id ? '#f4fbe6' : '#fff', color: INK, borderRadius: 100, padding: '7px 14px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer' }}>{b.name}</button>
                ))}
              </div>
            </div>
          )}

          {/* product photos */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>Product photos <span style={{ color: '#aab0a6', fontWeight: 600 }}>· pick up to 3</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 9 }}>
              {photos.map(p => {
                const on = selected.includes(p.id)
                return (
                  <button key={p.id} onClick={() => toggle(p.id)} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: `2px solid ${on ? GREEN : LINE}`, background: '#fff', cursor: 'pointer', padding: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {on && <span style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: GREEN, color: '#fff', display: 'grid', placeItems: 'center' }}><Check size={13} /></span>}
                  </button>
                )
              })}
              <button onClick={() => fileRef.current?.click()} style={{ aspectRatio: '1', borderRadius: 12, border: `2px dashed ${LINE}`, background: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', color: MUTED }}>
                <span style={{ display: 'grid', placeItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700 }}><Upload size={16} />Upload</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => onUpload(e.target.files)} />
          </div>

          {/* headline + aspect */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
            <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Optional headline (or let Mello write it)" style={{ flex: 1, minWidth: 220, border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 13px', fontSize: 13.5, color: INK, outline: 'none', fontFamily: 'inherit' }} />
            <div style={{ display: 'inline-flex', background: '#eef2ec', borderRadius: 100, padding: 3 }}>
              {(['4:5', '1:1', '9:16', '16:9'] as const).map(a => (
                <button key={a} onClick={() => setAspect(a)} style={{ border: 'none', borderRadius: 100, padding: '6px 11px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', background: aspect === a ? '#fff' : 'transparent', color: aspect === a ? INK : MUTED }}>{a}</button>
              ))}
            </div>
          </div>

          {/* generate */}
          {!result && (
            <button onClick={generate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: busy ? '#dfe4de' : LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 15, fontWeight: 850, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? <><Loader2 size={17} className="spin" /> Designing your ad… ~30s</> : <><Wand2 size={17} /> Create ad · {cost} credits</>}
            </button>
          )}
          {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px', maxWidth: 460 }}>{err}</div>}

          {/* result canvas */}
          {result && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.url} alt="Your ad" style={{ width: 340, maxWidth: '100%', borderRadius: 16, border: `1px solid ${LINE}`, boxShadow: '0 30px 60px -30px rgba(23,37,28,.4)', display: 'block' }} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>Here’s your ad.</div>
                  <div style={{ fontSize: 13, color: MUTED, margin: '5px 0 16px', lineHeight: 1.55 }}>Love it? Approve and download. Want a change? Tell Mello below and she’ll tweak this exact image.</div>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    <button onClick={download} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '11px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}><Download size={15} /> Approve &amp; download</button>
                    <button onClick={() => { setResult(null); setErr(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '11px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}><ImageIcon size={15} /> New one</button>
                  </div>

                  {/* tweak */}
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 7 }}>Tweak it</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyEdit() }} placeholder="e.g. make the background darker, bigger logo" style={{ flex: 1, border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 13px', fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit' }} />
                      <button onClick={applyEdit} disabled={editing || !editText.trim()} style={{ background: LIME, color: FOREST, border: 'none', borderRadius: 10, padding: '0 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{editing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}{editing ? '' : 'Tweak'}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
