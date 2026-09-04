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
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

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
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [tour, setTour] = useState(false)   // one-time coach marks on first open
  const [doc, setDoc] = useState<string>('')
  const [productImage, setProductImage] = useState<string | null>(productImageProp || null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState('')

  const [imgTarget, setImgTarget] = useState<ImgTarget | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)   // a ＋ was clicked → next added section lands here
  const [banner, setBanner] = useState<Msg>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
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

  // Show the coach tour the first time someone opens the editor (per browser).
  useEffect(() => {
    if (!doc) return
    let seen = false
    try { seen = localStorage.getItem('sf_builder_editor_tour_v1') === '1' } catch {}
    if (!seen) { const t = setTimeout(() => setTour(true), 500); return () => clearTimeout(t) }
  }, [doc])
  const endTour = useCallback(() => { setTour(false); try { localStorage.setItem('sf_builder_editor_tour_v1', '1') } catch {} }, [])

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
      else if (m.t === 'addAt') { setAnchor(m.anchorId || null); composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
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
        <div ref={canvasRef} style={{ background: INSET, border: `1px solid ${LINE}`, borderRadius: 16, padding: device === 'mobile' ? '18px 0' : 10, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
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

        <SectionComposer
          ref={composerRef}
          pageId={pageId}
          productImage={productImage}
          anchored={!!anchor}
          onClearAnchor={() => setAnchor(null)}
          onInsert={(html) => { send({ t: 'insertBlock', html, ...(anchor ? { anchorId: anchor, position: 'before' } : {}) }); setAnchor(null); setDirty(true) }}
        />
      </div>

      {imgTarget && (
        <ImagePopover
          target={imgTarget}
          productImage={productImage}
          onClose={() => setImgTarget(null)}
          onPick={(url) => { send({ t: 'setImage', id: imgTarget.id, src: url }); setImgTarget(null); setDirty(true) }}
        />
      )}

      {tour && <EditorTour canvasRef={canvasRef} composerRef={composerRef} onDone={endTour} />}
    </div>
  )
}

/* ─────────────────────────  first-open coach tour (spotlight)  ───────────────────────── */
const TOUR_STEPS = [
  { target: 'canvas' as const, icon: '✍️', title: 'Click anything to edit', body: 'Tap any headline or paragraph to type right on the page. Click any image to upload or generate a new one.' },
  { target: 'canvas' as const, icon: '⠿', title: 'Move & manage sections', body: 'Hover a section for its toolbar — drag the ⠿ handle to reorder, or use ↑ ↓, duplicate, and delete.' },
  { target: 'composer' as const, icon: '✨', title: 'Add anything with AI', body: 'Describe a section — or drop a screenshot to match — and it writes on-brand copy and drops it in.' },
]
function EditorTour({ canvasRef, composerRef, onDone }: { canvasRef: React.RefObject<HTMLElement | null>; composerRef: React.RefObject<HTMLElement | null>; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const step = TOUR_STEPS[i]

  useEffect(() => {
    const measure = () => {
      const el = (step.target === 'canvas' ? canvasRef.current : composerRef.current)
      if (!el) return setRect(null)
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [i, step.target, canvasRef, composerRef])

  const last = i === TOUR_STEPS.length - 1
  // card sits just inside the spotlight — below the top for a tall canvas, centered horizontally on the target
  const card = rect ? {
    top: Math.min(rect.top + (step.target === 'canvas' ? 24 : rect.height / 2 - 90), window.innerHeight - 220),
    left: step.target === 'composer' ? Math.max(16, rect.left - 320) : Math.max(16, Math.min(rect.left + rect.width / 2 - 165, window.innerWidth - 346)),
  } : { top: 120, left: 120 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130 }}>
      <style>{`@keyframes edtour{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
      {/* spotlight hole around the target */}
      {rect && (
        <div style={{ position: 'fixed', top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, borderRadius: 18, boxShadow: '0 0 0 9999px rgba(20,18,15,.62)', transition: 'all .28s cubic-bezier(.2,.8,.2,1)', pointerEvents: 'none', outline: `2px solid ${ORANGE}`, outlineOffset: -1 }} />
      )}
      {/* tip card */}
      <div style={{ position: 'fixed', top: card.top, left: card.left, width: 330, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(20,18,15,.5)', padding: 18, animation: 'edtour .25s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: WASH, display: 'grid', placeItems: 'center', fontSize: 18 }}>{step.icon}</div>
          <div style={{ fontWeight: 800, color: INK, fontSize: 15.5 }}>{step.title}</div>
        </div>
        <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.55 }}>{step.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {TOUR_STEPS.map((_, k) => <span key={k} style={{ width: k === i ? 18 : 6, height: 6, borderRadius: 999, background: k === i ? ORANGE : LINE, transition: 'all .2s' }} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!last && <button onClick={onDone} style={{ border: 0, background: 'none', color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Skip</button>}
            <button onClick={() => (last ? onDone() : setI(i + 1))} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>{last ? 'Start editing' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────  AI "Add a section" composer  ───────────────────────── */
const SectionComposer = forwardRef<HTMLDivElement, { pageId: string; productImage?: string | null; anchored?: boolean; onClearAnchor?: () => void; onInsert: (html: string) => void }>(function SectionComposer({ pageId, productImage, anchored, onClearAnchor, onInsert }, ref) {
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
    <aside ref={ref} style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>Add a section</div>
        <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, lineHeight: 1.5 }}>Describe it, or drop a screenshot to match. It writes on-brand copy and drops it in.</div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
        {anchored && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: WASH, border: `1px solid ${ORANGE}33`, borderRadius: 10, padding: '8px 11px', fontSize: 12.5, color: ORANGE, fontWeight: 600 }}>
            <span style={{ flex: 1 }}>↧ Inserting at the chosen spot</span>
            <button onClick={onClearAnchor} style={{ border: 0, background: 'transparent', color: ORANGE, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Add at end instead</button>
          </div>
        )}
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
        {last && !err && <div style={{ fontSize: 12.5, color: '#087443' }}>✓ {last} — hover it, then drag the ⠿ handle to move it, or use ⧉ / 🗑.</div>}

        <button onClick={run} disabled={busy || (!text.trim() && !shot)} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 12, padding: '11px 16px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy || (!text.trim() && !shot) ? 0.5 : 1, marginTop: 'auto' }}>
          {busy ? 'Designing…' : 'Add section →'}
        </button>
      </div>
    </aside>
  )
})

/* ─────────────────────────  image click → Upload / Generate / Product photo  ───────────────────────── */
const AI_IDEAS = ['On a marble counter, soft morning light', 'Held in a hand, lifestyle shot', 'On a clean studio background', 'Flat-lay with props']
function ImagePopover({ target, productImage, onClose, onPick }: { target: ImgTarget; productImage?: string | null; onClose: () => void; onPick: (url: string) => void }) {
  const [tab, setTab] = useState<'upload' | 'generate'>('upload')
  const [busy, setBusy] = useState<false | 'upload' | 'generate' | 'product'>(false)
  const [err, setErr] = useState('')
  const [prompt, setPrompt] = useState('')
  const [drag, setDrag] = useState(false)

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  const upload = async (file?: File | null) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setErr('Use a JPEG, PNG, WebP or GIF.'); return }
    if (file.size > 8 * 1024 * 1024) { setErr('That image is over 8MB — pick a smaller one.'); return }
    setBusy('upload'); setErr('')
    try {
      const dataB64 = await new Promise<string>((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result || '').split(',')[1] || ''); rd.onerror = rej; rd.readAsDataURL(file) })
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mode: 'upload', dataB64, mimeType: file.type }) })
      const j = await r.json(); if (!r.ok || !j.url) throw new Error(j?.error || 'Upload failed.')
      onPick(j.url)
    } catch (e: any) { setErr(e?.message || 'Upload failed.') } finally { setBusy(false) }
  }

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy('generate'); setErr('')
    try {
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mode: 'generate', prompt, referenceUrl: target.src, aspectRatio: '1:1' }) })
      const j = await r.json(); if (!r.ok || !j.url) throw new Error(j?.error || 'Could not generate.')
      onPick(j.url)
    } catch (e: any) { setErr(e?.message || 'Could not generate.') } finally { setBusy(false) }
  }

  const busyAny = busy !== false

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.5)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20, animation: 'edfade .16s ease' }}>
      <style>{`@keyframes edfade{from{opacity:0}to{opacity:1}}@keyframes edpop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@keyframes edspin{to{transform:rotate(360deg)}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 468, maxWidth: '100%', background: '#fff', borderRadius: 22, overflow: 'hidden', boxShadow: '0 40px 100px -30px rgba(20,18,15,.6), 0 0 0 1px rgba(20,18,15,.06)', animation: 'edpop .2s cubic-bezier(.2,.8,.2,1)' }}>
        {/* header — current image as a soft banner preview */}
        <div style={{ position: 'relative', height: 132, background: `${INSET} url(${target.src}) center/cover`, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(20,18,15,0) 30%, rgba(20,18,15,.72))' }} />
          <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, border: 0, background: 'rgba(255,255,255,.92)', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', fontSize: 17, color: INK, lineHeight: 1, boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>×</button>
          <div style={{ position: 'absolute', left: 18, bottom: 14, color: '#fff' }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-.01em' }}>Replace this image</div>
            <div style={{ fontSize: 12.5, opacity: .9, marginTop: 2 }}>Upload your own, or generate one with AI.</div>
          </div>
        </div>

        {/* segmented tabs */}
        <div style={{ display: 'flex', gap: 4, background: INSET, border: `1px solid ${LINE}`, borderRadius: 999, padding: 4, margin: '16px 18px 0' }}>
          {([['upload', 'Upload'], ['generate', 'Generate with AI']] as const).map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); setErr('') }} style={{ flex: 1, border: 0, background: tab === t ? '#fff' : 'transparent', color: tab === t ? ORANGE : SUB, fontWeight: 700, fontSize: 13, padding: '8px 10px', borderRadius: 999, cursor: 'pointer', boxShadow: tab === t ? '0 1px 3px rgba(20,18,15,.16)' : 'none', transition: 'all .12s' }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: '16px 18px 18px' }}>
          {tab === 'upload' ? (
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]) }}
              style={{ display: 'grid', placeItems: 'center', gap: 10, border: `2px dashed ${drag ? ORANGE : LINE}`, background: drag ? WASH : INSET, borderRadius: 16, padding: '30px 16px', textAlign: 'center', cursor: busyAny ? 'default' : 'pointer', transition: 'all .12s' }}>
              <div style={{ width: 46, height: 46, borderRadius: 999, background: '#fff', border: `1px solid ${LINE}`, display: 'grid', placeItems: 'center', fontSize: 20 }}>
                {busy === 'upload' ? <span style={{ width: 18, height: 18, border: `2px solid ${LINE}`, borderTopColor: ORANGE, borderRadius: 999, display: 'inline-block', animation: 'edspin .7s linear infinite' }} /> : '⤒'}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{busy === 'upload' ? 'Uploading…' : drag ? 'Drop to upload' : 'Drag & drop, or click to upload'}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 3 }}>JPEG, PNG, WebP or GIF · up to 8MB</div>
              </div>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busyAny} onChange={(e) => upload(e.target.files?.[0])} style={{ display: 'none' }} />
            </label>
          ) : (
            <div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image you want…" style={{ width: '100%', minHeight: 78, resize: 'vertical', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: INK }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {AI_IDEAS.map((s) => <button key={s} onClick={() => setPrompt(s)} style={{ border: `1px solid ${LINE}`, background: INSET, color: SUB, borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{s}</button>)}
              </div>
              <button onClick={generate} disabled={busyAny || !prompt.trim()} style={{ marginTop: 12, width: '100%', border: 0, background: ORANGE, color: '#fff', borderRadius: 12, padding: '12px', fontWeight: 700, fontSize: 14, cursor: busyAny ? 'default' : 'pointer', opacity: busyAny || !prompt.trim() ? 0.55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {busy === 'generate' ? <><span style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,.5)', borderTopColor: '#fff', borderRadius: 999, display: 'inline-block', animation: 'edspin .7s linear infinite' }} /> Generating…</> : '✨ Generate image'}
              </button>
              <div style={{ fontSize: 11.5, color: SUB, marginTop: 8, textAlign: 'center' }}>Uses AI image credits.</div>
            </div>
          )}

          {productImage && productImage !== target.src && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}><div style={{ flex: 1, height: 1, background: LINE }} /><span style={{ fontSize: 11, color: SUB, fontWeight: 600 }}>or</span><div style={{ flex: 1, height: 1, background: LINE }} /></div>
              <button onClick={() => { setBusy('product'); onPick(productImage) }} disabled={busyAny} style={{ width: '100%', border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 12, padding: 10, fontWeight: 600, fontSize: 13, cursor: busyAny ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                <img src={productImage} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: `1px solid ${LINE}` }} />
                <span style={{ flex: 1 }}>Use the product photo</span>
                <span style={{ color: ORANGE, fontSize: 16 }}>→</span>
              </button>
            </>
          )}

          {err && <div style={{ fontSize: 12.5, color: '#b42318', marginTop: 12, background: '#fdecec', borderRadius: 8, padding: '8px 11px' }}>{err}</div>}
        </div>
      </div>
    </div>
  )
}

const btnGhost: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
