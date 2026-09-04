'use client'
/**
 * BuilderEditor — the click-anywhere visual editor (the "page is the document" model).
 * Loads the page + injected runtime into an iframe, then:
 *   • click text  → edit inline (handled inside the iframe runtime)
 *   • click image → this component opens the Upload / Generate / Product-photo popover
 *   • the AI composer (type or drop a screenshot) → /api/builder/section-agent → insert the block
 *   • Save → asks the iframe for clean HTML → POST /api/builder/editor (edited_html = source of truth)
 * Talks to the runtime over postMessage. See editorRuntime.ts for the protocol.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const ORANGE = '#e02f06', INK = '#181712', SUB = '#6b6560', LINE = '#e7e3dd', INSET = '#f6f4f1', WASH = '#fdeee9'

type ImgTarget = { id: string; src: string }
type Msg = { type: 'ok' | 'err'; text: string } | null

export default function BuilderEditor({ pageId, productImage: productImageProp, onBack, onPublish }: {
  pageId: string
  productImage?: string | null
  onBack: () => void
  onPublish: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [doc, setDoc] = useState<string>('')
  const [productImage, setProductImage] = useState<string | null>(productImageProp || null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState('')

  const [imgTarget, setImgTarget] = useState<ImgTarget | null>(null)
  const [banner, setBanner] = useState<Msg>(null)
  const htmlWaiters = useRef<Map<string, (html: string) => void>>(new Map())

  // ── load the editor document ──
  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const r = await fetch(`/api/builder/editor?id=${encodeURIComponent(pageId)}`, { credentials: 'include' })
        const j = await r.json()
        if (!on) return
        if (!r.ok) { setLoadErr(j?.error || 'Could not open the editor.'); return }
        setDoc(j.editorHtml || '')
        if (j.productImage) setProductImage(j.productImage)
      } catch { if (on) setLoadErr('Could not open the editor.') }
    })()
    return () => { on = false }
  }, [pageId])

  const send = useCallback((m: any) => {
    iframeRef.current?.contentWindow?.postMessage({ __pgbldCmd: 1, ...m }, '*')
  }, [])

  // ── receive messages from the iframe runtime ──
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data
      if (!m || !m.__pgbld) return
      if (m.t === 'dirty') { setDirty(true) }
      else if (m.t === 'image') { setImgTarget({ id: m.id, src: m.src }) }
      else if (m.t === 'html') { const w = htmlWaiters.current.get(m.reqId); if (w) { w(m.html || ''); htmlWaiters.current.delete(m.reqId) } }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const getHTML = useCallback((): Promise<string> => new Promise((resolve) => {
    const reqId = 'r' + Math.random().toString(36).slice(2)
    htmlWaiters.current.set(reqId, resolve)
    send({ t: 'getHTML', reqId })
    setTimeout(() => { if (htmlWaiters.current.has(reqId)) { htmlWaiters.current.delete(reqId); resolve('') } }, 4000)
  }), [send])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const html = await getHTML()
      if (!html) throw new Error('empty')
      const r = await fetch('/api/builder/editor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pageId, html }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'save failed')
      setDirty(false); setSavedAt(Date.now())
    } catch { setBanner({ type: 'err', text: 'Could not save — try again.' }); setTimeout(() => setBanner(null), 3000) }
    finally { setSaving(false) }
  }, [getHTML, pageId])

  // debounced autosave
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => { save() }, 2600)
    return () => clearTimeout(t)
  }, [dirty, save])

  const publish = useCallback(async () => { await save(); onPublish() }, [save, onPublish])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 78px)' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 4px 14px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onBack} style={btnGhost}>← My pages</button>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>Visual editor</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? 'All changes saved' : 'Click any text or image to edit'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: INSET, border: `1px solid ${LINE}`, borderRadius: 999, padding: 4, gap: 3 }}>
            {(['desktop', 'mobile'] as const).map((d) => (
              <button key={d} onClick={() => setDevice(d)} style={{ border: 0, background: device === d ? '#fff' : 'transparent', color: device === d ? INK : SUB, fontWeight: device === d ? 700 : 600, fontSize: 13, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', textTransform: 'capitalize', boxShadow: device === d ? '0 1px 2px rgba(20,18,15,.14)' : 'none' }}>{d}</button>
            ))}
          </div>
          <button onClick={save} disabled={saving || !dirty} style={{ ...btnGhost, opacity: saving || !dirty ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={publish} disabled={saving} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '9px 20px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>Publish to Shopify →</button>
        </div>
      </div>

      {banner && <div style={{ padding: '8px 14px', borderRadius: 10, marginBottom: 10, fontSize: 13, fontWeight: 600, background: banner.type === 'err' ? '#fdecec' : '#e7f7ee', color: banner.type === 'err' ? '#b42318' : '#087443' }}>{banner.text}</div>}

      {/* canvas + composer */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ background: INSET, border: `1px solid ${LINE}`, borderRadius: 16, padding: device === 'mobile' ? '18px 0' : 10, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          {loadErr ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: SUB }}>{loadErr}</div>
          ) : (
            <iframe
              ref={iframeRef}
              title="Visual editor"
              srcDoc={doc}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: '100%', height: '100%', border: device === 'mobile' ? `1px solid ${LINE}` : 'none', borderRadius: device === 'mobile' ? 24 : 10, background: '#fff', boxShadow: device === 'mobile' ? '0 20px 60px -24px rgba(20,18,15,.4)' : 'none' }}
            />
          )}
        </div>

        <SectionComposer pageId={pageId} productImage={productImage} onInsert={(html) => { send({ t: 'insertBlock', html }); setDirty(true) }} />
      </div>

      {imgTarget && (
        <ImagePopover
          target={imgTarget}
          productImage={productImage}
          onClose={() => setImgTarget(null)}
          onPick={(url) => { send({ t: 'setImage', id: imgTarget.id, src: url }); setImgTarget(null); setDirty(true) }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────  AI "Add a section" composer  ───────────────────────── */
function SectionComposer({ pageId, productImage, onInsert }: { pageId: string; productImage?: string | null; onInsert: (html: string) => void }) {
  const [text, setText] = useState('')
  const [shot, setShot] = useState<string | null>(null)   // data URL of a screenshot to match
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<string>('')

  const attach = (file?: File | null) => {
    if (!file || !/^image\//.test(file.type)) return
    const rd = new FileReader(); rd.onload = () => setShot(String(rd.result || '')); rd.readAsDataURL(file)
  }

  const run = useCallback(async () => {
    if (!text.trim() && !shot) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/builder/section-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ instruction: text, imageDataUrl: shot, productImage, context: '' }),
      })
      const j = await r.json()
      if (!r.ok || !j.html) throw new Error(j?.error || 'Could not build that section.')
      onInsert(j.html)
      setLast(`Added: ${j.label || 'section'}`)
      setText(''); setShot(null)
    } catch (e: any) { setErr(e?.message || 'Could not build that section.') }
    finally { setBusy(false) }
  }, [text, shot, productImage, onInsert])

  const chips = ['Comparison vs competitors', 'Customer reviews', 'FAQ', 'Money-back guarantee', 'A stat band', 'Founder story']

  return (
    <aside style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>Add a section</div>
        <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, lineHeight: 1.5 }}>Describe it, or drop a screenshot to match. It writes on-brand copy and drops it in.</div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c) => (
            <button key={c} onClick={() => setText(c)} style={{ border: `1px solid ${LINE}`, background: INSET, color: INK, borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{c}</button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }}
          placeholder="e.g. Add a comparison table vs Rogaine, or a 3-review wall…"
          style={{ width: '100%', minHeight: 90, resize: 'vertical', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, fontSize: 13.5, fontFamily: 'inherit', color: INK, outline: 'none' }}
        />

        {shot ? (
          <div style={{ position: 'relative', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
            <img src={shot} alt="reference" style={{ width: '100%', display: 'block', maxHeight: 140, objectFit: 'cover' }} />
            <button onClick={() => setShot(null)} style={{ position: 'absolute', top: 6, right: 6, border: 0, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', fontSize: 13 }}>×</button>
          </div>
        ) : (
          <label style={{ border: `1px dashed ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: SUB, cursor: 'pointer', textAlign: 'center' }}>
            📎 Attach a screenshot to match
            <input type="file" accept="image/*" onChange={(e) => attach(e.target.files?.[0])} style={{ display: 'none' }} />
          </label>
        )}

        {err && <div style={{ fontSize: 12.5, color: '#b42318' }}>{err}</div>}
        {last && !err && <div style={{ fontSize: 12.5, color: '#087443' }}>✓ {last} — hover it to move, duplicate, or delete.</div>}

        <button onClick={run} disabled={busy || (!text.trim() && !shot)} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 12, padding: '11px 16px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy || (!text.trim() && !shot) ? 0.5 : 1, marginTop: 'auto' }}>
          {busy ? 'Designing…' : 'Add section →'}
        </button>
      </div>
    </aside>
  )
}

/* ─────────────────────────  image click → Upload / Generate / Product photo  ───────────────────────── */
function ImagePopover({ target, productImage, onClose, onPick }: { target: ImgTarget; productImage?: string | null; onClose: () => void; onPick: (url: string) => void }) {
  const [tab, setTab] = useState<'upload' | 'generate'>('upload')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [prompt, setPrompt] = useState('')

  const upload = async (file?: File | null) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setErr('Use JPEG, PNG, WebP or GIF.'); return }
    setBusy(true); setErr('')
    try {
      const dataB64 = await new Promise<string>((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result || '').split(',')[1] || ''); rd.onerror = rej; rd.readAsDataURL(file) })
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mode: 'upload', dataB64, mimeType: file.type }) })
      const j = await r.json(); if (!r.ok || !j.url) throw new Error(j?.error || 'Upload failed.')
      onPick(j.url)
    } catch (e: any) { setErr(e?.message || 'Upload failed.') } finally { setBusy(false) }
  }

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mode: 'generate', prompt, referenceUrl: target.src, aspectRatio: '1:1' }) })
      const j = await r.json(); if (!r.ok || !j.url) throw new Error(j?.error || 'Could not generate.')
      onPick(j.url)
    } catch (e: any) { setErr(e?.message || 'Could not generate.') } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.42)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderBottom: `1px solid ${LINE}` }}>
          <img src={target.src} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: `1px solid ${LINE}` }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: INK, fontSize: 15 }}>Replace image</div>
            <div style={{ fontSize: 12.5, color: SUB }}>Upload your own or generate one with AI.</div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: INSET, borderRadius: 999, width: 30, height: 30, cursor: 'pointer', fontSize: 16, color: SUB }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0' }}>
          {(['upload', 'generate'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ border: 0, background: tab === t ? WASH : 'transparent', color: tab === t ? ORANGE : SUB, fontWeight: 700, fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', textTransform: 'capitalize' }}>{t === 'upload' ? 'Upload' : 'Generate with AI'}</button>
          ))}
        </div>

        <div style={{ padding: 16 }}>
          {tab === 'upload' ? (
            <label style={{ display: 'block', border: `1.5px dashed ${LINE}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', color: SUB, fontSize: 13.5 }}>
              {busy ? 'Uploading…' : '📤 Click to choose an image (max 8MB)'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} style={{ display: 'none' }} />
            </label>
          ) : (
            <div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image — e.g. the product on a marble bathroom counter, soft morning light" style={{ width: '100%', minHeight: 84, resize: 'vertical', border: `1px solid ${LINE}`, borderRadius: 10, padding: 11, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: INK }} />
              <button onClick={generate} disabled={busy || !prompt.trim()} style={{ marginTop: 10, width: '100%', border: 0, background: ORANGE, color: '#fff', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy || !prompt.trim() ? 0.5 : 1 }}>{busy ? 'Generating…' : 'Generate image'}</button>
              <div style={{ fontSize: 11.5, color: SUB, marginTop: 8, textAlign: 'center' }}>Uses AI image credits.</div>
            </div>
          )}

          {productImage && productImage !== target.src && (
            <button onClick={() => onPick(productImage)} disabled={busy} style={{ marginTop: 12, width: '100%', border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 10, padding: '10px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <img src={productImage} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }} /> Use the product photo
            </button>
          )}

          {err && <div style={{ fontSize: 12.5, color: '#b42318', marginTop: 10 }}>{err}</div>}
        </div>
      </div>
    </div>
  )
}

const btnGhost: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
