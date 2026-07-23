'use client'
/**
 * ⌘K UNIVERSAL SEARCH — "search by knowledge, not by menu." One palette over the
 * whole product: brands, hooks, formats, collections, the Edition, the raw library.
 * No dependency — a focused ~150-line component: overlay, debounced /api/search,
 * arrow-key navigation, Enter to travel. Mounted once in the dashboard shell.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Item = { label: string; sub?: string; href: string; kind: string }
type Section = { title: string; items: Item[] }

const KIND_TAG: Record<string, string> = {
  brand: 'BRAND', hook: 'HOOK', format: 'FORMAT', visual: 'VISUAL', emotion: 'EMOTION',
  angle: 'ANGLE', collection: 'COLLECTION', ads: 'LIBRARY', edition: 'EDITION',
}

export default function SearchPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const tRef = useRef<any>(null)

  // ⌘K / Ctrl-K opens anywhere; Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const runSearch = useCallback((query: string) => {
    clearTimeout(tRef.current)
    tRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const d = await r.json()
        setSections(Array.isArray(d?.sections) ? d.sections : [])
        setSel(0)
      } catch { /* keep last results */ }
    }, 180)
  }, [])

  useEffect(() => { if (open) runSearch(q) }, [open, q, runSearch])

  const flat: Item[] = sections.flatMap((s) => s.items)
  const go = (item: Item | undefined) => {
    if (!item) return
    setOpen(false); setQ('')
    router.push(item.href)
  }

  if (!open) return null
  let idx = -1
  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(12,18,13,.34)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, calc(100vw - 32px))', maxHeight: '64vh', background: '#fff', borderRadius: 18, boxShadow: '0 30px 90px -20px rgba(10,20,12,.45)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]) }
          }}
          placeholder="Search brands, hooks, collections, knowledge…"
          style={{ border: 'none', outline: 'none', padding: '18px 22px', fontSize: 16.5, fontWeight: 600, color: '#14181a', borderBottom: '1px solid #eceeec', fontFamily: 'inherit' }}
        />
        <div style={{ overflowY: 'auto', padding: '6px 8px 12px' }}>
          {sections.length === 0 && <div style={{ padding: '22px 16px', fontSize: 13.5, color: '#7a827c' }}>Type to search the marketing knowledge graph…</div>}
          {sections.map((s) => (
            <div key={s.title}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.14em', color: '#aab0ab', textTransform: 'uppercase', padding: '12px 14px 5px' }}>{s.title}</div>
              {s.items.map((it) => {
                idx += 1
                const active = idx === sel
                const i = idx
                return (
                  <button
                    key={`${s.title}:${it.href}:${it.label}`}
                    onClick={() => go(it)}
                    onMouseEnter={() => setSel(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', background: active ? '#f2f8ea' : 'transparent', borderRadius: 10, padding: '10px 14px', fontFamily: 'inherit' }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.08em', color: '#7a827c', background: '#f1f4f0', borderRadius: 6, padding: '3px 7px', flexShrink: 0 }}>{KIND_TAG[it.kind] || 'GO'}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#14181a', letterSpacing: '-.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                      {it.sub && <span style={{ display: 'block', fontSize: 11.5, color: '#7a827c', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #eceeec', padding: '8px 16px', fontSize: 11, color: '#aab0ab', fontWeight: 600, display: 'flex', gap: 14 }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  )
}
