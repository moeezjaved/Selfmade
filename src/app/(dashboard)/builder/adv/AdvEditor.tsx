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
  moveNode, setHidden, removeNode, duplicateNode, insertSection, insertBlock, patchElementContent, patchStyle,
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

export default function AdvEditor({ pageId }: { pageId: string }) {
  const [doc, setDoc] = useState<PageDoc | null>(null)
  const [sel, setSel] = useState<NodeRef | null>(null)
  const [device, setDevice] = useState<Device>('base')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [addMenu, setAddMenu] = useState<null | { kind: 'section' } | { kind: 'block'; sectionId: string }>(null)

  const history = useRef<PageDoc[]>([])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)

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

  /* ── autosave (debounced) ── */
  const save = useCallback((next: PageDoc) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setStatus('saving')
      try {
        const r = await fetch('/api/builder/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, doc: next }) })
        const d = await r.json()
        if (d?.error) throw new Error(d.error)
        version.current = d.version || version.current + 1
        setStatus('saved'); setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
      } catch { setStatus('error') }
    }, 700)
  }, [pageId])

  /* ── apply a doc mutation: push undo, set, autosave ── */
  const apply = useCallback((mut: (d: PageDoc) => PageDoc, nextSel?: NodeRef | null) => {
    setDoc((cur) => {
      if (!cur) return cur
      history.current.push(cur); if (history.current.length > 80) history.current.shift()
      const next = mut(cur)
      save(next)
      if (nextSel !== undefined) setSel(nextSel)
      return next
    })
  }, [save])

  const undo = useCallback(() => {
    setDoc((cur) => { const prev = history.current.pop(); if (!prev || !cur) return cur; save(prev); return prev })
  }, [save])

  /* ── property-panel writes (style is written for the device shown on the canvas) ── */
  const onStyle = useCallback((key: StyleKey, value: unknown) => {
    if (!sel) return
    apply((d) => { const n = findNode(d, sel); if (!n) return d; return patchStyle(d, sel, writeField(n.style, key, device, value)) })
  }, [sel, device, apply])
  const onHidden = useCallback(() => { if (sel) apply((d) => setHidden(d, sel)) }, [sel, apply])
  const onContent = useCallback((patch: Partial<Element['content']>) => { if (sel) apply((d) => patchElementContent(d, sel, patch)) }, [sel, apply])

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
      const node = root.querySelector(`[data-node-id="${sel.elementId || sel.blockId || sel.sectionId}"]`)
      node?.setAttribute('data-sel', '1')
    }
  }, [sel, canvasHtml])

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
    if (!target || !doc) { setSel(null); return }
    const id = target.getAttribute('data-node-id') || ''
    const type = (target.getAttribute('data-node-type') || '').split(':')[0]
    // resolve id → NodeRef by walking the model
    for (const s of doc.sections) {
      if (s.id === id) return setSel({ sectionId: s.id })
      for (const b of s.blocks) {
        if (b.id === id) return setSel({ sectionId: s.id, blockId: b.id })
        for (const el of b.elements) if (el.id === id) return setSel({ sectionId: s.id, blockId: b.id, elementId: el.id })
      }
    }
    void type
  }, [doc])

  /* inline text edit: double-click a text/heading element */
  const onCanvasDouble = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-node-type^="element:"]') as HTMLElement | null
    if (!target || !doc) return
    const type = (target.getAttribute('data-node-type') || '').split(':')[1]
    if (!['text', 'heading', 'price', 'button', 'badge'].includes(type)) return
    const id = target.getAttribute('data-node-id') || ''
    let ref: NodeRef | null = null
    for (const s of doc.sections) for (const b of s.blocks) for (const el of b.elements) if (el.id === id) ref = { sectionId: s.id, blockId: b.id, elementId: el.id }
    if (!ref) return
    const cur = findElement(doc, ref)
    if (cur?.content.bind) return // bound to product — not free-text editable here
    target.setAttribute('contenteditable', 'true')
    ;(target as HTMLElement).focus()
    const finish = () => {
      target.removeAttribute('contenteditable')
      const txt = target.textContent || ''
      apply((d) => patchElementContent(d, ref!, { text: txt }))
      target.removeEventListener('blur', finish)
    }
    target.addEventListener('blur', finish)
  }, [doc, apply])

  /* keyboard: cmd/ctrl+Z undo, Delete removes selection */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.isContentEditable || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) { e.preventDefault(); apply((d) => removeNode(d, sel), null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, undo, apply])

  if (status === 'loading') return <Center>Loading editor…</Center>
  if (status === 'error' && !doc) return <Center>{err || 'Could not load the page.'} <Link href="/builder" style={{ color: ORANGE, marginLeft: 8 }}>Back</Link></Center>
  if (!doc) return <Center>No page.</Center>

  const canvasWidth = device === 'mobile' ? 402 : 1000

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f2ee', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
        <Link href="/builder" style={{ color: SUB, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>← Builder</Link>
        <span style={{ fontFamily: SERIF, fontSize: 18 }}>Page editor</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, background: WASH, borderRadius: 999, padding: '3px 9px' }}>Advanced · beta</span>
        <div style={{ flex: 1 }} />
        <SegToggle value={device} onChange={setDevice} />
        <SaveBadge status={status} />
        <button disabled title="Publishing on the new model is Phase 5" style={{ ...btn, opacity: .5, cursor: 'not-allowed' }}>Publish</button>
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
                  label={SECTION_LABEL(s.type)} count={descendantCount(s)} hidden={s.hidden}
                  selected={sameRef(sel, sRef)} onSelect={() => setSel(sRef)}
                  onUp={() => apply((d) => moveNode(d, sRef, -1))} onDown={() => apply((d) => moveNode(d, sRef, 1))}
                  onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sRef); queueMicrotask(() => setSel(newRef)); return nd })}
                  onHide={() => apply((d) => setHidden(d, sRef))} onDel={() => apply((d) => removeNode(d, sRef), sameRef(sel, sRef) ? null : sel)}
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
                      />
                      {bOpen && b.elements.map((el) => {
                        const eRef: NodeRef = { sectionId: s.id, blockId: b.id, elementId: el.id }
                        return (
                          <TreeRow key={el.id} depth={2} label={elLabel(el)} hidden={el.hidden}
                            selected={sameRef(sel, eRef)} onSelect={() => setSel(eRef)}
                            onUp={() => apply((d) => moveNode(d, eRef, -1))} onDown={() => apply((d) => moveNode(d, eRef, 1))}
                            onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, eRef); queueMicrotask(() => setSel(newRef)); return nd })}
                            onHide={() => apply((d) => setHidden(d, eRef))} onDel={() => apply((d) => removeNode(d, eRef), sameRef(sel, eRef) ? null : sel)} />
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
        <main style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
          <div style={{ width: canvasWidth, maxWidth: '100%', background: '#fff', borderRadius: 12, boxShadow: '0 2px 20px rgba(20,18,15,.08)', overflow: 'hidden', alignSelf: 'flex-start' }}>
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
    </div>
  )
}

/* ── small pieces ── */
const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }

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
function SegToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
      {(['base', 'mobile'] as Device[]).map((d) => (
        <button key={d} onClick={() => onChange(d)} style={{ border: 0, background: value === d ? INK : '#fff', color: value === d ? '#fff' : SUB, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          {d === 'base' ? '🖥 Desktop' : '📱 Mobile'}
        </button>
      ))}
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
}) {
  const { depth, label, count, hidden, selected, open, hasChildren, onToggle, onSelect } = props
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6 + depth * 14, paddingRight: 4, height: 30, borderRadius: 8, background: selected ? WASH : hover ? INSET : 'transparent', cursor: 'pointer', opacity: hidden ? 0.5 : 1 }}>
      <span onClick={(e) => { e.stopPropagation(); onToggle?.() }} style={{ width: 14, textAlign: 'center', color: FAINT, fontSize: 10, cursor: hasChildren ? 'pointer' : 'default' }}>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
      <span onClick={onSelect} style={{ flex: 1, fontSize: 13, color: selected ? ORANGE : INK, fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}{count != null && count > 0 ? <span style={{ color: FAINT, fontWeight: 500 }}> · {count}</span> : null}
      </span>
      {hover && (
        <span style={{ display: 'flex', gap: 1 }} onClick={(e) => e.stopPropagation()}>
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
  return <button title={title} onClick={onClick} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '3px 4px', borderRadius: 6, color: danger ? ORANGE : SUB }}>{children}</button>
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
