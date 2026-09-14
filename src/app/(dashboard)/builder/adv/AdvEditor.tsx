'use client'
/**
 * Advanced Page Builder — 3-pane editor shell (Phase 2). Section/block tree · live canvas · property panel,
 * over the PageDoc model. Structural editing end-to-end: select, reorder, duplicate, hide, delete, add
 * section/block, inline text edit, device toggle, debounced autosave to /api/builder/doc.
 *
 * The canvas uses ONE runtime (render.ts) in mode:'edit' so what you edit is pixel-identical to what
 * publishes — the hard correctness bar in the spec. The property panel is intentionally minimal here
 * (hidden toggle + inline text); the full control system is Phase 3.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { renderDoc, type RenderProduct } from '@/lib/builder/render'
import type { PageDoc, Section, Block, Element, Device } from '@/lib/builder/schema'
import {
  type NodeRef, findNode, findElement, descendantCount,
  moveNode, moveSectionToIndex, moveBlockToIndex, moveElementToIndex, levelOf, setHidden, removeNode, duplicateNode, insertSection, insertBlock, patchElementContent, patchStyle,
} from '@/lib/builder/docOps'
import { writeField, type StyleKey } from '@/lib/builder/styleField'
import { newSection, newBlock, SECTION_LABEL, BLOCK_LABEL, SECTION_BLOCK_PALETTE } from '@/lib/builder/seed'
import PropertyPanel from './PropertyPanel'

/* theme tokens (shared with the builder / HqRunable) */
const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a'
const LINE = 'rgba(20,18,15,.10)', ORANGE = '#e02f06', WASH = '#fdeee9', INSET = '#f7f6f4'
const SERIF = '"Hedvig Letters Serif", Georgia, serif'

const sameRef = (a: NodeRef | null, b: NodeRef | null) =>
  !!a && !!b && a.sectionId === b.sectionId && a.blockId === b.blockId && a.elementId === b.elementId
const refKey = (r: NodeRef) => `${r.sectionId}/${r.blockId || ''}/${r.elementId || ''}`

/** A placeholder product so product-bound elements show something legible on the canvas while editing. */
function editorProduct(doc: PageDoc): RenderProduct {
  const p = doc.productRef?.importedProduct || {}
  return {
    title: p.title || 'Your product name',
    price: p.price || '$49.00',
    compareAtPrice: p.compareAtPrice || '$69.00',
    savePct: 'SAVE 29%',
    rating: p.rating ?? 4.9,
    reviewCount: p.ratingCount ?? 1240,
    image: p.image || 'https://placehold.co/600x750/f2efe9/b8b2a8?text=Product',
    description: p.description || 'A short product description your buyers will read here.',
  }
}

const SECTION_TYPES: Section['type'][] = ['productInfo', 'imageText', 'imageBenefits', 'imageTimeline', 'imagePercentage', 'productDifferences', 'asSeenOn', 'reviewsCarousel', 'recommendedProducts', 'stickyAtc', 'shapeDivider']
const BLOCK_TYPES: Block['type'][] = ['text', 'media', 'gallery', 'productDetails']

/* ── granular editing inside a `raw` (bespoke-template) section ──────────────────────────────────────
 * A raw section renders its template slice verbatim (pixel-perfect). To let merchants edit/hide/delete/
 * move/swap the INDIVIDUAL pieces inside it (not just the whole section), we operate on the slice's HTML:
 * a click resolves the clicked DOM node to a child-index PATH from the raw root, and each op re-writes the
 * slice's HTML. Design is preserved (verbatim HTML in, verbatim HTML out) — only the edited node changes. */

/** Snap a clicked node up to the nearest MEANINGFUL item: climb through only-child wrappers (e.g. a lone
 * <span> inside a pill → the pill) so move/hide/delete act on the piece the user means, not a bare leaf. */
function snapUp(el: HTMLElement, rawRoot: HTMLElement): HTMLElement {
  let n = el
  while (n !== rawRoot && n.parentElement && n.parentElement !== rawRoot && n.parentElement.children.length === 1) {
    n = n.parentElement
  }
  return n
}

/** Child-index path from `clicked` up to (but excluding) `rawRoot`; null if not a descendant. [] = the root itself. */
function subPathTo(clicked: HTMLElement, rawRoot: HTMLElement): number[] | null {
  const path: number[] = []
  let n: HTMLElement | null = clicked
  while (n && n !== rawRoot) {
    const p: HTMLElement | null = n.parentElement
    if (!p) return null
    path.unshift(Array.prototype.indexOf.call(p.children, n as HTMLElement))
    n = p
  }
  return n === rawRoot ? path : null
}

type RawOp = 'up' | 'down' | 'hide' | 'delete' | 'img'
/** Apply an op to the node at `path` within a raw slice's HTML; returns the new HTML (unchanged on miss). */
function rawHtmlOp(html: string, path: number[], op: RawOp, arg?: string): string {
  if (!path.length) return html
  const box = document.createElement('div')
  box.innerHTML = html
  let node: HTMLElement = box
  for (const idx of path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) return html; node = kid }
  if (node === box) return html
  const parent = node.parentElement
  if (op === 'delete') node.remove()
  else if (op === 'hide') node.style.display = node.style.display === 'none' ? '' : 'none'
  else if (op === 'up') { const s = node.previousElementSibling; if (s && parent) parent.insertBefore(node, s) }
  else if (op === 'down') { const s = node.nextElementSibling; if (s && parent) parent.insertBefore(s, node) }
  else if (op === 'img' && arg != null) { const img = node.tagName === 'IMG' ? node : node.querySelector('img'); if (img) img.setAttribute('src', arg) }
  return box.innerHTML
}

export default function AdvEditor({ pageId }: { pageId: string }) {
  const [doc, setDoc] = useState<PageDoc | null>(null)
  const [sel, setSel] = useState<NodeRef | null>(null)
  const [device, setDevice] = useState<Device>('base')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [dirty, setDirty] = useState(false)   // unsaved changes (Save is manual — no autosave)
  const [err, setErr] = useState('')
  const [addMenu, setAddMenu] = useState<null | { kind: 'section' } | { kind: 'block'; sectionId: string }>(null)
  const [drag, setDrag] = useState<NodeRef | null>(null)   // node being dragged in the tree
  const [dropKey, setDropKey] = useState<string | null>(null)   // refKey of the node hovered as a drop target
  const [publishing, setPublishing] = useState<'idle' | 'saving' | 'publishing'>('idle')
  const [pubResult, setPubResult] = useState<null | { url?: string; previewUrl?: string; error?: string }>(null)
  const [showProduct, setShowProduct] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [histDepth, setHistDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const [tb, setTb] = useState<null | { top: number; left: number; below: boolean }>(null)
  const [zoom, setZoom] = useState(1)
  // Sub-selection INSIDE a raw (bespoke-template) section: the raw element + the clicked node's child-path.
  const [rawSel, setRawSel] = useState<null | { ref: NodeRef; path: number[]; isImg: boolean }>(null)
  const [rawTb, setRawTb] = useState<null | { top: number; left: number; below: boolean }>(null)

  const history = useRef<PageDoc[]>([])
  const future = useRef<PageDoc[]>([])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const version = useRef(0)
  const syncDepth = () => { setHistDepth(history.current.length); setRedoDepth(future.current.length) }

  /* ── load ── */
  useEffect(() => {
    let live = true
    setStatus('loading')
    fetch(`/api/builder/doc?pageId=${encodeURIComponent(pageId)}`)
      .then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.error) { setErr(d.error); setStatus('error'); return } version.current = d.version || 0; setDoc(d.doc); setStatus('idle') })
      .catch(() => { if (live) { setErr('Could not load the page.'); setStatus('error') } })
    return () => { live = false }
  }, [pageId])

  /* ── explicit save (NO autosave — changes persist only when the user clicks Save) ── */
  const saveNow = useCallback(async () => {
    if (!doc) return
    setStatus('saving')
    try {
      const r = await fetch('/api/builder/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, doc }) })
      const d = await r.json()
      if (d?.error) throw new Error(d.error)
      version.current = d.version || version.current + 1
      setDirty(false); setStatus('saved'); setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
    } catch { setStatus('error') }
  }, [doc, pageId])

  /* ── apply a doc mutation: push undo, set, mark dirty (Save is manual) ── */
  const apply = useCallback((mut: (d: PageDoc) => PageDoc, nextSel?: NodeRef | null) => {
    setDoc((cur) => {
      if (!cur) return cur
      history.current.push(cur); if (history.current.length > 80) history.current.shift()
      future.current = []                    // a new edit clears the redo stack
      const next = mut(cur)
      setDirty(true)
      if (nextSel !== undefined) setSel(nextSel)
      syncDepth()
      return next
    })
  }, [])

  const undo = useCallback(() => {
    setDoc((cur) => { if (!cur) return cur; const prev = history.current.pop(); if (!prev) return cur; future.current.push(cur); setDirty(true); syncDepth(); return prev })
  }, [])
  const redo = useCallback(() => {
    setDoc((cur) => { if (!cur) return cur; const nxt = future.current.pop(); if (!nxt) return cur; history.current.push(cur); setDirty(true); syncDepth(); return nxt })
  }, [])

  /* ── property-panel writes (style is written for the device shown on the canvas) ── */
  const onStyle = useCallback((key: StyleKey, value: unknown) => {
    if (!sel) return
    apply((d) => { const n = findNode(d, sel); if (!n) return d; return patchStyle(d, sel, writeField(n.style, key, device, value)) })
  }, [sel, device, apply])
  const onHidden = useCallback(() => { if (sel) apply((d) => setHidden(d, sel)) }, [sel, apply])
  const onContent = useCallback((patch: Partial<Element['content']>) => { if (sel) apply((d) => patchElementContent(d, sel, patch)) }, [sel, apply])
  const fitZoom = useCallback(() => {
    const w = mainRef.current?.clientWidth || 900
    const target = Math.min(1, Math.max(0.4, (w - 56) / (device === 'mobile' ? 402 : 1000)))
    setZoom(Math.round(target * 20) / 20)
  }, [device])
  // Fit the canvas to the available width when a page loads or the device changes, so the preview is
  // never cropped by the side panels.
  useEffect(() => { const t = setTimeout(fitZoom, 60); return () => clearTimeout(t) }, [status, device, fitZoom])

  /* ── drag-to-reorder (sections, blocks within a section, elements within a block) ── */
  const canDropOn = (ref: NodeRef): boolean => {
    if (!drag || sameRef(drag, ref) || levelOf(drag) !== levelOf(ref)) return false
    if (levelOf(ref) === 'section') return true
    if (levelOf(ref) === 'block') return drag.sectionId === ref.sectionId
    return drag.sectionId === ref.sectionId && drag.blockId === ref.blockId
  }
  const dragProps = (ref: NodeRef) => ({
    draggable: true, dragging: sameRef(drag, ref), dropHint: dropKey === refKey(ref) && canDropOn(ref),
    onDragStart: () => setDrag(ref), onDragEnd: () => { setDrag(null); setDropKey(null) },
    onDragOver: (e: React.DragEvent) => { if (canDropOn(ref)) { e.preventDefault(); setDropKey(refKey(ref)) } },
    onDrop: () => {
      const d0 = drag
      if (d0 && canDropOn(ref)) apply((d) => {
        if (levelOf(ref) === 'section') return moveSectionToIndex(d, d0.sectionId, d.sections.findIndex((x) => x.id === ref.sectionId))
        const sec = d.sections.find((x) => x.id === ref.sectionId)
        if (levelOf(ref) === 'block') return moveBlockToIndex(d, d0.sectionId, d0.blockId!, sec ? sec.blocks.findIndex((b) => b.id === ref.blockId) : 0)
        const blk = sec?.blocks.find((b) => b.id === ref.blockId)
        return moveElementToIndex(d, d0.sectionId, d0.blockId!, d0.elementId!, blk ? blk.elements.findIndex((e) => e.id === ref.elementId) : 0)
      })
      setDrag(null); setDropKey(null)
    },
  })

  /* ── publish: save the current doc, then push it to Shopify as native sections ── */
  const publish = useCallback(async () => {
    if (!doc) return
    setPublishing('saving')
    setPubResult(null)
    try {
      await fetch('/api/builder/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, doc }) })
      setDirty(false)   // publish persists the current doc
      setPublishing('publishing')
      const r = await fetch('/api/builder/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, target: 'this' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d?.error) setPubResult({ error: d?.message || d?.error || 'Publish failed' })
      else setPubResult({ url: d.url, previewUrl: d.previewUrl })
    } catch (e) { setPubResult({ error: (e as Error)?.message || 'Publish failed' }) }
    setPublishing('idle')
  }, [doc, pageId])

  /* ── canvas render (edit mode) ── */
  const product = useMemo(() => (doc ? editorProduct(doc) : {}), [doc])
  const canvasHtml = useMemo(() => {
    if (!doc) return ''
    const { html, css } = renderDoc(doc, { mode: 'edit', device, product })
    return `<style>${css}
[data-node-id]{outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .1s}
[data-node-id]:hover{outline-color:rgba(224,47,6,.35);cursor:pointer}
[data-sel="1"]{outline:2px solid ${ORANGE} !important;outline-offset:-2px}
</style>${html}`
  }, [doc, device, product])

  /* mark the selected node in the rendered DOM + attach click selection */
  useEffect(() => {
    const root = canvasRef.current
    if (!root) return
    root.querySelectorAll('[data-sel="1"]').forEach((n) => n.removeAttribute('data-sel'))
    if (sel) {
      const node = root.querySelector(`[data-node-id="${sel.elementId || sel.blockId || sel.sectionId}"]`) as HTMLElement | null
      node?.setAttribute('data-sel', '1')
      // Selecting a section/block/element (from the tree or canvas) scrolls the preview to it — like Shopify.
      // 'nearest' means a canvas click on an already-visible node won't jump.
      node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [sel, canvasHtml])

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const clicked = e.target as HTMLElement
    const target = clicked.closest('[data-node-id]') as HTMLElement | null
    if (!target || !doc) { setSel(null); setRawSel(null); return }
    const id = target.getAttribute('data-node-id') || ''
    const nodeType = target.getAttribute('data-node-type') || ''
    const type = nodeType.split(':')[0]
    // Click INSIDE a raw section on one of its inner pieces → sub-select that piece so it can be moved,
    // hidden, deleted or (if an image) swapped — granular editing that keeps the template's exact design.
    if (nodeType === 'element:raw' && clicked !== target) {
      const item = snapUp(clicked, target)
      const path = subPathTo(item, target)
      if (path && path.length) {
        const isImg = item.tagName === 'IMG' || !!item.querySelector('img')
        for (const s of doc.sections) for (const b of s.blocks) for (const el of b.elements) if (el.id === id) {
          setExpanded((x) => { const n = new Set(x); n.add(s.id); n.add(b.id); return n })
          setSel({ sectionId: s.id, blockId: b.id, elementId: el.id })
          setRawSel({ ref: { sectionId: s.id, blockId: b.id, elementId: el.id }, path, isImg })
          return
        }
        return
      }
    }
    setRawSel(null)
    // resolve id → NodeRef by walking the model; also expand the tree so the selected node is revealed there
    for (const s of doc.sections) {
      if (s.id === id) { setSel({ sectionId: s.id }); return }
      for (const b of s.blocks) {
        if (b.id === id) { setExpanded((x) => new Set(x).add(s.id)); setSel({ sectionId: s.id, blockId: b.id }); return }
        for (const el of b.elements) if (el.id === id) { setExpanded((x) => { const n = new Set(x); n.add(s.id); n.add(b.id); return n }); setSel({ sectionId: s.id, blockId: b.id, elementId: el.id }); return }
      }
    }
    void type
  }, [doc])

  /* inline text edit: double-click a text/heading element */
  const onCanvasDouble = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-node-type^="element:"]') as HTMLElement | null
    if (!target || !doc) return
    const type = (target.getAttribute('data-node-type') || '').split(':')[1]
    if (!['text', 'heading', 'price', 'button', 'badge', 'raw'].includes(type)) return
    const id = target.getAttribute('data-node-id') || ''
    let ref: NodeRef | null = null
    for (const s of doc.sections) for (const b of s.blocks) for (const el of b.elements) if (el.id === id) ref = { sectionId: s.id, blockId: b.id, elementId: el.id }
    if (!ref) return
    const cur = findElement(doc, ref)
    if (cur?.content.bind) return // bound to product — not free-text editable here
    // A `raw` (bespoke-template) section is edited in place: the whole slice is contentEditable and we save
    // its innerHTML, so any text on the real design can be changed without leaving the template's layout.
    const isRaw = type === 'raw'
    target.setAttribute('contenteditable', 'true')
    ;(target as HTMLElement).focus()
    const finish = () => {
      target.removeAttribute('contenteditable')
      if (isRaw) apply((d) => patchElementContent(d, ref!, { html: target.innerHTML }))
      else apply((d) => patchElementContent(d, ref!, { text: target.textContent || '' }))
      target.removeEventListener('blur', finish)
    }
    target.addEventListener('blur', finish)
  }, [doc, apply])

  /* keyboard: cmd/ctrl+Z undo, Delete removes selection */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.isContentEditable || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) saveNow() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) { e.preventDefault(); apply((d) => removeNode(d, sel), null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, undo, redo, apply, dirty, saveNow])

  /* ── Edit Product + page settings write into the doc ── */
  const onProduct = useCallback((patch: Record<string, unknown>) => {
    apply((d) => ({ ...d, productRef: { ...d.productRef, importedProduct: { ...(d.productRef?.importedProduct || {}), ...patch } } }))
  }, [apply])
  const onSettings = useCallback((patch: Record<string, unknown>) => {
    apply((d) => ({ ...d, settings: { ...(d.settings || { locale: 'en' }), seo: { ...((d.settings as { seo?: object })?.seo || {}), ...patch } } as PageDoc['settings'] }))
  }, [apply])

  /* ── floating canvas toolbar: fixed to the viewport over the selected node (survives scroll + zoom) ── */
  const measureTb = useCallback(() => {
    const root = canvasRef.current
    if (!root || !sel) { setTb(null); return }
    const node = root.querySelector(`[data-node-id="${sel.elementId || sel.blockId || sel.sectionId}"]`) as HTMLElement | null
    if (!node) { setTb(null); return }
    const r = node.getBoundingClientRect()
    const below = r.top < 96                              // node hugs the top bar → drop the toolbar below it
    setTb({ top: below ? r.top + 6 : r.top - 6, left: Math.max(8, r.left), below })
  }, [sel])
  useEffect(() => { measureTb() }, [measureTb, canvasHtml, device, zoom])
  useEffect(() => {
    const main = mainRef.current
    const on = () => measureTb()
    main?.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on)
    return () => { main?.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [measureTb])

  /* ── raw sub-selection toolbar: over the individual piece clicked inside a raw section ── */
  const rawNodeEl = useCallback((): HTMLElement | null => {
    const root = canvasRef.current
    if (!root || !rawSel) return null
    const rawRoot = root.querySelector(`[data-node-id="${rawSel.ref.elementId}"]`) as HTMLElement | null
    if (!rawRoot) return null
    let node: HTMLElement = rawRoot
    for (const idx of rawSel.path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) return null; node = kid }
    return node === rawRoot ? null : node
  }, [rawSel])
  const measureRawTb = useCallback(() => {
    const node = rawNodeEl()
    if (!node) { setRawTb(null); return }
    const r = node.getBoundingClientRect()
    const below = r.top < 96
    setRawTb({ top: below ? r.bottom + 6 : r.top - 6, left: Math.max(8, r.left), below })
  }, [rawNodeEl])
  useEffect(() => { measureRawTb() }, [measureRawTb, canvasHtml, device, zoom])
  useEffect(() => {
    const main = mainRef.current
    const on = () => measureRawTb()
    main?.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on)
    return () => { main?.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [measureRawTb])
  // Drop the raw sub-selection when the main selection moves off the raw element (tree click, etc.).
  useEffect(() => { if (rawSel && (!sel || sel.elementId !== rawSel.ref.elementId)) setRawSel(null) }, [sel, rawSel])
  const rawOp = useCallback((op: RawOp) => {
    if (!rawSel || !doc) return
    const cur = findElement(doc, rawSel.ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    let arg: string | undefined
    if (op === 'img') { const url = window.prompt('New image URL'); if (!url || !url.trim()) return; arg = url.trim() }
    const next = rawHtmlOp(html, rawSel.path, op, arg)
    if (next === html) return
    const ref = rawSel.ref
    apply((d) => patchElementContent(d, ref, { html: next }))
    if (op === 'delete') setRawSel(null)
  }, [rawSel, doc, apply])

  if (status === 'loading') return <Center>Loading editor…</Center>
  if (status === 'error' && !doc) return <Center>{err || 'Could not load the page.'} <Link href="/builder" style={{ color: ORANGE, marginLeft: 8 }}>Back</Link></Center>
  if (!doc) return <Center>No page.</Center>

  const canvasWidth = device === 'mobile' ? 402 : 1000

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 55, display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f2ee', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
        <Link href="/builder" style={{ color: SUB, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>← Builder</Link>
        <span style={{ fontFamily: SERIF, fontSize: 18 }}>Page editor</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, background: WASH, borderRadius: 999, padding: '3px 9px' }}>Advanced · beta</span>
        <button onClick={() => setShowProduct(true)} style={{ ...btn, padding: '6px 12px' }}>Edit product</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', gap: 2 }}>
          <button title="Undo (⌘Z)" onClick={undo} disabled={!histDepth} style={{ ...iconTopBtn, opacity: histDepth ? 1 : 0.35, cursor: histDepth ? 'pointer' : 'default' }}>↶</button>
          <button title="Redo (⇧⌘Z)" onClick={redo} disabled={!redoDepth} style={{ ...iconTopBtn, opacity: redoDepth ? 1 : 0.35, cursor: redoDepth ? 'pointer' : 'default' }}>↷</button>
        </div>
        <DeviceToggle value={device} onChange={(d) => setDevice(d)} />
        <ZoomControl zoom={zoom} setZoom={setZoom} onFit={fitZoom} />
        <SaveBadge status={status} />
        <button onClick={saveNow} disabled={!dirty || status === 'saving'} title="Save (⌘S)" style={{ border: `1px solid ${dirty ? ORANGE : LINE}`, background: dirty ? WASH : '#fff', color: dirty ? ORANGE : SUB, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: dirty && status !== 'saving' ? 'pointer' : 'default' }}>
          {status === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button onClick={publish} disabled={publishing !== 'idle'} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: publishing === 'idle' ? 'pointer' : 'default', opacity: publishing === 'idle' ? 1 : 0.7 }}>
          {publishing === 'saving' ? 'Saving…' : publishing === 'publishing' ? 'Publishing…' : 'Publish →'}
        </button>
        <button title="Page settings" onClick={() => setShowMenu(true)} style={{ ...iconTopBtn, fontSize: 18 }}>⋯</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── left: section/block tree ── */}
        <aside style={{ width: 264, borderRight: `1px solid ${LINE}`, background: '#fff', overflowY: 'auto', padding: 10 }}>
          <Row label="PAGE" faint />
          {doc.sections.map((s) => {
            const sRef: NodeRef = { sectionId: s.id }
            const open = expanded.has(s.id)
            return (
              <div key={s.id}>
                <TreeRow
                  depth={0} open={open} hasChildren={s.blocks.length > 0}
                  onToggle={() => setExpanded((x) => toggle(x, s.id))}
                  label={s.name || SECTION_LABEL(s.type)} count={descendantCount(s)} hidden={s.hidden}
                  selected={sameRef(sel, sRef)} onSelect={() => setSel(sRef)}
                  onUp={() => apply((d) => moveNode(d, sRef, -1))} onDown={() => apply((d) => moveNode(d, sRef, 1))}
                  onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sRef); queueMicrotask(() => setSel(newRef)); return nd })}
                  onHide={() => apply((d) => setHidden(d, sRef))} onDel={() => apply((d) => removeNode(d, sRef), sameRef(sel, sRef) ? null : sel)}
                  {...dragProps(sRef)}
                />
                {open && s.blocks.map((b) => {
                  const bRef: NodeRef = { sectionId: s.id, blockId: b.id }
                  const bOpen = expanded.has(b.id)
                  return (
                    <div key={b.id}>
                      <TreeRow
                        depth={1} open={bOpen} hasChildren={b.elements.length > 0}
                        onToggle={() => setExpanded((x) => toggle(x, b.id))}
                        label={BLOCK_LABEL(b.type)} count={descendantCount(b)} hidden={b.hidden}
                        selected={sameRef(sel, bRef)} onSelect={() => setSel(bRef)}
                        onUp={() => apply((d) => moveNode(d, bRef, -1))} onDown={() => apply((d) => moveNode(d, bRef, 1))}
                        onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, bRef); queueMicrotask(() => setSel(newRef)); return nd })}
                        onHide={() => apply((d) => setHidden(d, bRef))} onDel={() => apply((d) => removeNode(d, bRef), sameRef(sel, bRef) ? null : sel)}
                        {...dragProps(bRef)}
                      />
                      {bOpen && b.elements.map((el) => {
                        const eRef: NodeRef = { sectionId: s.id, blockId: b.id, elementId: el.id }
                        return (
                          <TreeRow key={el.id} depth={2} label={elLabel(el)} hidden={el.hidden}
                            selected={sameRef(sel, eRef)} onSelect={() => setSel(eRef)}
                            onUp={() => apply((d) => moveNode(d, eRef, -1))} onDown={() => apply((d) => moveNode(d, eRef, 1))}
                            onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, eRef); queueMicrotask(() => setSel(newRef)); return nd })}
                            onHide={() => apply((d) => setHidden(d, eRef))} onDel={() => apply((d) => removeNode(d, eRef), sameRef(sel, eRef) ? null : sel)} {...dragProps(eRef)} />
                        )
                      })}
                      <AddBtn label="Add block" onClick={() => setAddMenu({ kind: 'block', sectionId: s.id })} depth={1} />
                    </div>
                  )
                })}
              </div>
            )
          })}
          <AddBtn label="Add section" onClick={() => setAddMenu({ kind: 'section' })} depth={0} primary />
        </aside>

        {/* ── center: live canvas ── */}
        <main ref={mainRef} style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
          <div style={{ zoom, width: canvasWidth, background: '#fff', borderRadius: 12, boxShadow: '0 2px 20px rgba(20,18,15,.08)', overflow: 'hidden', alignSelf: 'flex-start' } as React.CSSProperties}>
            <div ref={canvasRef} onClick={onCanvasClick} onDoubleClick={onCanvasDouble} dangerouslySetInnerHTML={{ __html: canvasHtml }} />
          </div>
        </main>

        {/* ── right: property panel (minimal in Phase 2) ── */}
        <aside style={{ width: 300, borderLeft: `1px solid ${LINE}`, background: '#fff', overflowY: 'auto', padding: 16 }}>
          {!sel ? (
            <div style={{ color: FAINT, fontSize: 13, lineHeight: 1.6 }}>Select a section, block, or element on the canvas or in the tree to edit it.</div>
          ) : (
            <PropertyPanel doc={doc} sel={sel} device={device} onStyle={onStyle} onHidden={onHidden} onContent={onContent} />
          )}
        </aside>
      </div>

      {addMenu && (
        <AddMenu
          title={addMenu.kind === 'section' ? 'Add a section' : 'Add a block'}
          options={addMenu.kind === 'section'
            ? SECTION_TYPES.map((t) => ({ id: t, label: SECTION_LABEL(t) }))
            : (SECTION_BLOCK_PALETTE[doc.sections.find((s) => s.id === addMenu.sectionId)?.type || 'productInfo'] || BLOCK_TYPES).map((t) => ({ id: t, label: BLOCK_LABEL(t as Block['type']) }))}
          onPick={(id) => {
            if (addMenu.kind === 'section') apply((d) => { const { doc: nd, newRef } = insertSection(d, newSection(id as Section['type'])); queueMicrotask(() => { setSel(newRef); setExpanded((x) => new Set(x).add(newRef.sectionId)) }); return nd })
            else { const sid = addMenu.sectionId; apply((d) => { const { doc: nd, newRef } = insertBlock(d, sid, newBlock(id as Block['type'])); queueMicrotask(() => setSel(newRef)); return nd }) }
            setAddMenu(null)
          }}
          onClose={() => setAddMenu(null)}
        />
      )}

      {pubResult && (
        <div onClick={() => setPubResult(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
            {pubResult.error ? (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 8 }}>Couldn’t publish</div>
                <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>{pubResult.error}</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 8 }}>Published to Shopify 🎉</div>
                <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6, marginBottom: 14 }}>Your page is live as native, theme-editable sections. Open it in Shopify to fine-tune or set it live.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pubResult.url && <a href={pubResult.url} target="_blank" rel="noopener noreferrer" style={{ border: 0, background: ORANGE, color: '#fff', textDecoration: 'none', borderRadius: 999, padding: '9px 18px', fontWeight: 700, fontSize: 13 }}>Open in Shopify →</a>}
                  {pubResult.previewUrl && <a href={pubResult.previewUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn }}>Preview</a>}
                </div>
              </>
            )}
            <div style={{ textAlign: 'right', marginTop: 16 }}><button onClick={() => setPubResult(null)} style={btn}>Close</button></div>
          </div>
        </div>
      )}

      {tb && sel && !rawSel && (
        <div style={{ position: 'fixed', top: tb.top, left: tb.left, transform: tb.below ? 'none' : 'translateY(-100%)', display: 'flex', gap: 1, background: INK, borderRadius: 8, padding: '3px 4px', boxShadow: '0 4px 14px rgba(20,18,15,.3)', zIndex: 30 }} onClick={(e) => e.stopPropagation()}>
          <TbBtn title="Hide" onClick={() => apply((d) => setHidden(d, sel))}>👁</TbBtn>
          <TbBtn title="Duplicate" onClick={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sel); queueMicrotask(() => setSel(newRef)); return nd })}>⧉</TbBtn>
          <TbBtn title="Move up" onClick={() => apply((d) => moveNode(d, sel, -1))}>↑</TbBtn>
          <TbBtn title="Move down" onClick={() => apply((d) => moveNode(d, sel, 1))}>↓</TbBtn>
          {!sel.elementId && <TbBtn title="Add block" onClick={() => setAddMenu({ kind: 'block', sectionId: sel.sectionId })}>＋</TbBtn>}
          <TbBtn title="Delete" onClick={() => apply((d) => removeNode(d, sel), null)} danger>🗑</TbBtn>
        </div>
      )}

      {/* granular toolbar for a piece clicked INSIDE a raw (bespoke-template) section */}
      {rawTb && rawSel && (
        <div style={{ position: 'fixed', top: rawTb.top, left: rawTb.left, transform: rawTb.below ? 'none' : 'translateY(-100%)', display: 'flex', alignItems: 'center', gap: 1, background: ORANGE, borderRadius: 8, padding: '3px 4px', boxShadow: '0 4px 14px rgba(20,18,15,.3)', zIndex: 31 }} onClick={(e) => e.stopPropagation()}>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '.04em', padding: '0 6px', textTransform: 'uppercase' }}>Item</span>
          {rawSel.isImg && <TbBtn title="Replace image" onClick={() => rawOp('img')}>🖼</TbBtn>}
          <TbBtn title="Move up" onClick={() => rawOp('up')}>↑</TbBtn>
          <TbBtn title="Move down" onClick={() => rawOp('down')}>↓</TbBtn>
          <TbBtn title="Hide / show" onClick={() => rawOp('hide')}>👁</TbBtn>
          <TbBtn title="Delete" onClick={() => rawOp('delete')} danger>🗑</TbBtn>
        </div>
      )}

      {showProduct && <EditProductModal doc={doc} onChange={onProduct} onClose={() => setShowProduct(false)} />}
      {showMenu && <SettingsModal doc={doc} onChange={onSettings} onClose={() => setShowMenu(false)} />}
    </div>
  )
}

/* ── Edit Product — the product the page's bound elements read from ── */
function EditProductModal({ doc, onChange, onClose }: { doc: PageDoc; onChange: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const p = (doc.productRef?.importedProduct || {}) as Record<string, unknown>
  const field = (label: string, key: string, placeholder = '', numeric = false) => (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>{label}</span>
      <input defaultValue={p[key] != null ? String(p[key]) : ''} placeholder={placeholder}
        onBlur={(e) => onChange({ [key]: numeric ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value })}
        style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </label>
  )
  return (
    <Modal title="Edit product" onClose={onClose} hint="These feed the product-bound elements (title, price, rating, image) and the canvas preview.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {field('Title', 'title', 'Product name')}
        {field('Price', 'price', '$49.00')}
        {field('Compare-at price', 'compareAtPrice', '$69.00')}
        {field('Rating (0–5)', 'rating', '4.9', true)}
        {field('Review count', 'ratingCount', '1240', true)}
        {field('Image URL', 'image', 'https://…')}
      </div>
      <div style={{ marginTop: 10 }}>{field('Description', 'description', 'Short product description')}</div>
    </Modal>
  )
}

/* ── Page settings — SEO title + description (stored in doc.settings.seo) ── */
function SettingsModal({ doc, onChange, onClose }: { doc: PageDoc; onChange: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const seo = ((doc.settings as { seo?: Record<string, unknown> })?.seo || {}) as Record<string, unknown>
  return (
    <Modal title="Page settings" onClose={onClose} hint="SEO title and description for the published page.">
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>SEO title</span>
        <input defaultValue={seo.title != null ? String(seo.title) : ''} onBlur={(e) => onChange({ title: e.target.value })}
          style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </label>
      <label style={{ display: 'block' }}>
        <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>SEO description</span>
        <textarea defaultValue={seo.description != null ? String(seo.description) : ''} onBlur={(e) => onChange({ description: e.target.value })}
          style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', minHeight: 70, resize: 'vertical', boxSizing: 'border-box' }} />
      </label>
    </Modal>
  )
}

function Modal({ title, hint, children, onClose }: { title: string; hint?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22 }}>{title}</div>
        {hint && <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, marginBottom: 14, lineHeight: 1.5 }}>{hint}</div>}
        {children}
        <div style={{ textAlign: 'right', marginTop: 16 }}><button onClick={onClose} style={btn}>Done</button></div>
      </div>
    </div>
  )
}

function TbBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return <button title={title} onClick={onClick} style={{ border: 0, background: 'transparent', color: danger ? '#ff9b8a' : '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7 }}>{children}</button>
}

/* ── small pieces ── */
const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const iconTopBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 8, width: 30, height: 30, fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: SUB, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14 }}>{children}</div>
}
function Row({ label, faint }: { label: string; faint?: boolean }) {
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.09em', color: faint ? FAINT : SUB, padding: '4px 6px 8px' }}>{label}</div>
}
function SaveBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = { saving: ['Saving…', SUB], saved: ['Saved', '#12a150'], error: ['Save failed', ORANGE], idle: ['', SUB], loading: ['', SUB] }
  const [txt, col] = map[status] || ['', SUB]
  return <span style={{ fontSize: 12, color: col, minWidth: 64, textAlign: 'right' }}>{txt}</span>
}
const MonitorIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : SUB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
)
const PhoneIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : SUB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
)
function DeviceToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
      <button title="Desktop" onClick={() => onChange('base')} style={{ border: 0, background: value === 'base' ? INK : '#fff', padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><MonitorIcon on={value === 'base'} /></button>
      <button title="Mobile" onClick={() => onChange('mobile')} style={{ border: 0, borderLeft: `1px solid ${LINE}`, background: value === 'mobile' ? INK : '#fff', padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><PhoneIcon on={value === 'mobile'} /></button>
    </div>
  )
}
function ZoomControl({ zoom, setZoom, onFit }: { zoom: number; setZoom: (z: number) => void; onFit: () => void }) {
  const step = (d: number) => setZoom(Math.min(1, Math.max(0.4, Math.round((zoom + d) * 20) / 20)))
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
      <button title="Zoom out" onClick={() => step(-0.1)} style={{ border: 0, background: '#fff', color: INK, padding: '6px 10px', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>−</button>
      <button title="Fit to width" onClick={onFit} style={{ border: 0, borderLeft: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}`, background: '#fff', color: SUB, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, minWidth: 46 }}>{Math.round(zoom * 100)}%</button>
      <button title="Zoom in" onClick={() => step(0.1)} style={{ border: 0, background: '#fff', color: INK, padding: '6px 10px', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>+</button>
    </div>
  )
}
function AddBtn({ label, onClick, depth, primary }: { label: string; onClick: () => void; depth: number; primary?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', marginLeft: depth * 14, marginTop: 4, border: `1px dashed ${primary ? ORANGE : LINE}`, background: primary ? WASH : 'transparent', color: primary ? ORANGE : SUB, borderRadius: 9, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
      ＋ {label}
    </button>
  )
}

function TreeRow(props: {
  depth: number; label: string; count?: number; hidden?: boolean; selected: boolean; open?: boolean; hasChildren?: boolean
  onToggle?: () => void; onSelect: () => void; onUp: () => void; onDown: () => void; onDup: () => void; onHide: () => void; onDel: () => void
  draggable?: boolean; dragging?: boolean; dropHint?: boolean
  onDragStart?: () => void; onDragEnd?: () => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void
}) {
  const { depth, label, count, hidden, selected, open, hasChildren, onToggle, onSelect, draggable } = props
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      draggable={draggable} onDragStart={props.onDragStart} onDragEnd={props.onDragEnd}
      onDragOver={draggable ? props.onDragOver : undefined} onDrop={draggable ? props.onDrop : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 4 + depth * 14, paddingRight: 4, minHeight: 36, borderRadius: 8, background: selected ? WASH : hover ? INSET : 'transparent', cursor: 'pointer', opacity: props.dragging ? 0.4 : hidden ? 0.5 : 1, borderTop: props.dropHint ? `2px solid ${ORANGE}` : '2px solid transparent' }}>
      {draggable && <span title="Drag to reorder" style={{ cursor: 'grab', color: hover ? SUB : 'transparent', fontSize: 13, flex: 'none', lineHeight: 1, userSelect: 'none' }}>⠿</span>}
      <span onClick={(e) => { e.stopPropagation(); onToggle?.() }} style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: hasChildren ? INK : 'transparent', fontSize: 17, fontWeight: 700, cursor: hasChildren ? 'pointer' : 'default', flex: 'none', borderRadius: 6, transition: 'transform .12s', transform: hasChildren && open ? 'rotate(90deg)' : 'none' }}>{hasChildren ? '›' : ''}</span>
      <span onClick={onSelect} style={{ flex: 1, fontSize: 13, color: selected ? ORANGE : INK, fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}{count != null && count > 0 ? <span style={{ color: FAINT, fontWeight: 500 }}> · {count}</span> : null}
      </span>
      {hover && (
        <span style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Hide" onClick={props.onHide}>{hidden ? '◌' : '👁'}</IconBtn>
          <IconBtn title="Duplicate" onClick={props.onDup}>⧉</IconBtn>
          <IconBtn title="Move up" onClick={props.onUp}>↑</IconBtn>
          <IconBtn title="Move down" onClick={props.onDown}>↓</IconBtn>
          <IconBtn title="Delete" onClick={props.onDel} danger>🗑</IconBtn>
        </span>
      )}
    </div>
  )
}
function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return <button className="bld-iconbtn" title={title} onClick={onClick} style={{ border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: danger ? '#d64316' : SUB }}>{children}</button>
}

function AddMenu({ title, options, onPick, onClose }: { title: string; options: { id: string; label: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 14 }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => onPick(o.id)} style={{ textAlign: 'left', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'right', marginTop: 14 }}><button onClick={onClose} style={btn}>Cancel</button></div>
      </div>
    </div>
  )
}

/* helpers */
function toggle(set: Set<string>, id: string): Set<string> { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n }
function elLabel(el: Element): string {
  if (el.content.bind) return el.content.bind.replace('product.', '') + ' (product)'
  const t = el.content.text
  return t ? `${el.type}: ${t.slice(0, 18)}${t.length > 18 ? '…' : ''}` : el.type
}
