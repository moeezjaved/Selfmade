'use client'

import { useMemo, useState } from 'react'
import { X, Search, ArrowUp } from 'lucide-react'
import { PROMPT_LIBRARY, PROMPT_CATEGORIES, type PromptCategory } from '@/lib/mello/prompts'

export function PromptLibrary({ onClose, onPick }: { onClose: () => void; onPick: (prompt: string) => void }) {
  const [cat, setCat] = useState<PromptCategory | 'all'>('all')
  const [q, setQ] = useState('')

  const items = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return PROMPT_LIBRARY.filter(p =>
      (cat === 'all' || p.category === cat) &&
      (!ql || p.title.toLowerCase().includes(ql) || p.description.toLowerCase().includes(ql) || p.prompt.toLowerCase().includes(ql))
    )
  }, [cat, q])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,18,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(820px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #eef2ec', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#26331f' }}>Prompt library</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#f4f7f1', border: '1px solid #e6ece2', borderRadius: 9, padding: '7px 10px' }}>
            <Search size={15} color="#8a9583" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search prompts…" autoFocus style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, flex: 1, color: '#26331f' }} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a9583' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
          {/* Category nav */}
          <div style={{ width: 168, borderRight: '1px solid #eef2ec', padding: 8, overflowY: 'auto', flexShrink: 0 }}>
            {[{ key: 'all', label: 'All', icon: '⭐' } as any, ...PROMPT_CATEGORIES].map((c: any) => (
              <button key={c.key} onClick={() => setCat(c.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: cat === c.key ? '#eef6e6' : 'transparent', color: cat === c.key ? '#2d5a27' : '#566550', fontSize: 13, fontWeight: cat === c.key ? 700 : 500 }}>
                <span>{c.icon}</span>{c.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {items.length === 0 && <div style={{ padding: 24, color: '#9aa593', fontSize: 13 }}>No prompts match “{q}”.</div>}
            {items.map((p, i) => (
              <button key={i} onClick={() => onPick(p.prompt)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid transparent', cursor: 'pointer', background: 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f5f8f2'; (e.currentTarget as HTMLElement).style.borderColor = '#e6ece2' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: '#2c3a26' }}>{p.title}</span>
                  <span style={{ color: '#8a9583', fontSize: 13 }}>  —  {p.description}</span>
                </div>
                <ArrowUp size={15} color="#9aa593" style={{ transform: 'rotate(45deg)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
