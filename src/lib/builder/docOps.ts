/**
 * Advanced Page Builder — pure PageDoc tree operations (Phase 2, the editor's engine).
 *
 * Every op takes a doc and a node address and returns a NEW doc (immutable — never mutates the input),
 * so the editor can keep an undo stack and React sees fresh references. No React, no DB, no I/O here —
 * this is the testable spine the 3-pane shell drives (select/reorder/duplicate/hide/delete/insert).
 *
 * A node is addressed by a NodeRef: a section, or a block inside a section, or an element inside a block.
 * `level` is derived from which ids are present, so callers pass a plain address and the op figures out
 * which list it lives in.
 */
import { nodeId, type PageDoc, type Section, type Block, type Element, type SectionType, type BlockType, type ElementType } from './schema'

export type NodeLevel = 'section' | 'block' | 'element'
export interface NodeRef { sectionId: string; blockId?: string; elementId?: string }

export function levelOf(ref: NodeRef): NodeLevel {
  if (ref.elementId) return 'element'
  if (ref.blockId) return 'block'
  return 'section'
}

// ── lookups ──────────────────────────────────────────────────────────────────

export function findSection(doc: PageDoc, sectionId: string): Section | undefined {
  return doc.sections.find((s) => s.id === sectionId)
}
export function findBlock(doc: PageDoc, sectionId: string, blockId: string): Block | undefined {
  return findSection(doc, sectionId)?.blocks.find((b) => b.id === blockId)
}
export function findElement(doc: PageDoc, ref: NodeRef): Element | undefined {
  if (!ref.blockId || !ref.elementId) return undefined
  return findBlock(doc, ref.sectionId, ref.blockId)?.elements.find((e) => e.id === ref.elementId)
}

/** The node any NodeRef points at (section | block | element), or undefined if the address is stale. */
export function findNode(doc: PageDoc, ref: NodeRef): Section | Block | Element | undefined {
  switch (levelOf(ref)) {
    case 'element': return findElement(doc, ref)
    case 'block': return findBlock(doc, ref.sectionId, ref.blockId!)
    case 'section': return findSection(doc, ref.sectionId)
  }
}

/** Descendant element count for a node — the number PagePilot shows next to each tree row. */
export function descendantCount(node: Section | Block | Element): number {
  if ('elements' in node) return node.elements.length                       // block
  if ('blocks' in node) return node.blocks.reduce((n, b) => n + b.elements.length, 0) // section
  return 0                                                                   // element (leaf)
}

// ── generic immutable helpers ─────────────────────────────────────────────────

const clamp = (i: number, len: number) => Math.max(0, Math.min(len, i))

/** Move item at `from` to `to` in a fresh copy of the array (bounds-safe; no-op if `from` invalid). */
function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(clamp(to, next.length), 0, item)
  return next
}

// ── section ops ────────────────────────────────────────────────────────────────

function mapSections(doc: PageDoc, fn: (sections: Section[]) => Section[]): PageDoc {
  return { ...doc, sections: fn(doc.sections) }
}
/** Replace one section by id via an updater (identity if not found). */
function updateSection(doc: PageDoc, sectionId: string, fn: (s: Section) => Section): PageDoc {
  return mapSections(doc, (ss) => ss.map((s) => (s.id === sectionId ? fn(s) : s)))
}
function updateBlock(doc: PageDoc, sectionId: string, blockId: string, fn: (b: Block) => Block): PageDoc {
  return updateSection(doc, sectionId, (s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }))
}

/** Move a node up (-1) or down (+1) among its siblings. */
export function moveNode(doc: PageDoc, ref: NodeRef, dir: -1 | 1): PageDoc {
  const at = (arr: { id: string }[], id: string) => arr.findIndex((n) => n.id === id)
  switch (levelOf(ref)) {
    case 'section': {
      const i = at(doc.sections, ref.sectionId)
      return mapSections(doc, (ss) => reorder(ss, i, i + dir))
    }
    case 'block':
      return updateSection(doc, ref.sectionId, (s) => {
        const i = at(s.blocks, ref.blockId!)
        return { ...s, blocks: reorder(s.blocks, i, i + dir) }
      })
    case 'element':
      return updateBlock(doc, ref.sectionId, ref.blockId!, (b) => {
        const i = at(b.elements, ref.elementId!)
        return { ...b, elements: reorder(b.elements, i, i + dir) }
      })
  }
}

/** Toggle (or force) a node's hidden flag. */
export function setHidden(doc: PageDoc, ref: NodeRef, hidden?: boolean): PageDoc {
  const flip = <T extends { hidden?: boolean }>(n: T): T => ({ ...n, hidden: hidden ?? !n.hidden })
  switch (levelOf(ref)) {
    case 'section': return updateSection(doc, ref.sectionId, flip)
    case 'block': return updateBlock(doc, ref.sectionId, ref.blockId!, flip)
    case 'element': return updateBlock(doc, ref.sectionId, ref.blockId!, (b) => ({ ...b, elements: b.elements.map((e) => (e.id === ref.elementId ? flip(e) : e)) }))
  }
}

/** Remove a node. Returns { doc, removed } so the caller can move selection off a deleted node. */
export function removeNode(doc: PageDoc, ref: NodeRef): PageDoc {
  switch (levelOf(ref)) {
    case 'section': return mapSections(doc, (ss) => ss.filter((s) => s.id !== ref.sectionId))
    case 'block': return updateSection(doc, ref.sectionId, (s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== ref.blockId) }))
    case 'element': return updateBlock(doc, ref.sectionId, ref.blockId!, (b) => ({ ...b, elements: b.elements.filter((e) => e.id !== ref.elementId) }))
  }
}

// ── duplicate (deep clone with fresh ids) ──────────────────────────────────────

function cloneElement(e: Element): Element {
  return { ...e, id: nodeId('e'), content: { ...e.content }, style: { ...e.style } }
}
function cloneBlock(b: Block): Block {
  return { ...b, id: nodeId('b'), style: { ...b.style }, elements: b.elements.map(cloneElement), settings: b.settings ? { ...b.settings } : undefined }
}
function cloneSection(s: Section): Section {
  return { ...s, id: nodeId('s'), style: { ...s.style }, blocks: s.blocks.map(cloneBlock), settings: s.settings ? { ...s.settings } : undefined }
}

/** Insert a copy of a node directly after it (fresh ids throughout). Returns { doc, newRef }. */
export function duplicateNode(doc: PageDoc, ref: NodeRef): { doc: PageDoc; newRef: NodeRef } {
  switch (levelOf(ref)) {
    case 'section': {
      const src = findSection(doc, ref.sectionId); if (!src) return { doc, newRef: ref }
      const copy = cloneSection(src)
      const i = doc.sections.findIndex((s) => s.id === ref.sectionId)
      const sections = doc.sections.slice(); sections.splice(i + 1, 0, copy)
      return { doc: { ...doc, sections }, newRef: { sectionId: copy.id } }
    }
    case 'block': {
      const src = findBlock(doc, ref.sectionId, ref.blockId!); if (!src) return { doc, newRef: ref }
      const copy = cloneBlock(src)
      return {
        doc: updateSection(doc, ref.sectionId, (s) => { const i = s.blocks.findIndex((b) => b.id === ref.blockId); const blocks = s.blocks.slice(); blocks.splice(i + 1, 0, copy); return { ...s, blocks } }),
        newRef: { sectionId: ref.sectionId, blockId: copy.id },
      }
    }
    case 'element': {
      const src = findElement(doc, ref); if (!src) return { doc, newRef: ref }
      const copy = cloneElement(src)
      return {
        doc: updateBlock(doc, ref.sectionId, ref.blockId!, (b) => { const i = b.elements.findIndex((e) => e.id === ref.elementId); const elements = b.elements.slice(); elements.splice(i + 1, 0, copy); return { ...b, elements } }),
        newRef: { sectionId: ref.sectionId, blockId: ref.blockId, elementId: copy.id },
      }
    }
  }
}

// ── insert new nodes ────────────────────────────────────────────────────────────

/** Append a section to the doc. Returns { doc, newRef }. */
export function insertSection(doc: PageDoc, section: Section, atIndex?: number): { doc: PageDoc; newRef: NodeRef } {
  const sections = doc.sections.slice()
  sections.splice(atIndex ?? sections.length, 0, section)
  return { doc: { ...doc, sections }, newRef: { sectionId: section.id } }
}
/** Append a block to a section. */
export function insertBlock(doc: PageDoc, sectionId: string, block: Block, atIndex?: number): { doc: PageDoc; newRef: NodeRef } {
  return {
    doc: updateSection(doc, sectionId, (s) => { const blocks = s.blocks.slice(); blocks.splice(atIndex ?? blocks.length, 0, block); return { ...s, blocks } }),
    newRef: { sectionId, blockId: block.id },
  }
}
/** Append an element to a block. */
export function insertElement(doc: PageDoc, sectionId: string, blockId: string, element: Element, atIndex?: number): { doc: PageDoc; newRef: NodeRef } {
  return {
    doc: updateBlock(doc, sectionId, blockId, (b) => { const elements = b.elements.slice(); elements.splice(atIndex ?? elements.length, 0, element); return { ...b, elements } }),
    newRef: { sectionId, blockId, elementId: element.id },
  }
}

// ── edit content / style of the selected node ──────────────────────────────────

/** Merge into an element's content (e.g. inline text edit → { text }, image swap → { src }). */
export function patchElementContent(doc: PageDoc, ref: NodeRef, patch: Partial<Element['content']>): PageDoc {
  if (levelOf(ref) !== 'element') return doc
  return updateBlock(doc, ref.sectionId, ref.blockId!, (b) => ({ ...b, elements: b.elements.map((e) => (e.id === ref.elementId ? { ...e, content: { ...e.content, ...patch } } : e)) }))
}

/** Merge into any node's style (the property panel's write path in Phase 3). */
export function patchStyle(doc: PageDoc, ref: NodeRef, patch: Partial<Section['style']>): PageDoc {
  const merge = <T extends { style: object }>(n: T): T => ({ ...n, style: { ...n.style, ...patch } })
  switch (levelOf(ref)) {
    case 'section': return updateSection(doc, ref.sectionId, merge)
    case 'block': return updateBlock(doc, ref.sectionId, ref.blockId!, merge)
    case 'element': return updateBlock(doc, ref.sectionId, ref.blockId!, (b) => ({ ...b, elements: b.elements.map((e) => (e.id === ref.elementId ? merge(e) : e)) }))
  }
}

export type { SectionType, BlockType, ElementType }
