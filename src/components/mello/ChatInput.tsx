'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpen } from 'lucide-react'

export function ChatInput({ value, onChange, onSend, disabled, onOpenLibrary, placeholder }: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
  onOpenLibrary?: () => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Real Meta connection status — the badge used to be hardcoded "Meta connected". null = still checking
  // (hide the badge until we know), so we never falsely claim a connection.
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/meta/accounts')
      .then(r => (r.ok ? r.json() : { accounts: [] }))
      .then(j => { if (alive) setMetaConnected((j.accounts?.length || 0) > 0) })
      .catch(() => { if (alive) setMetaConnected(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) onSend()
    }
  }

  return (
    <div style={{ border: '1px solid #d7e1d1', background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: '0 2px 14px rgba(45,90,39,0.06)' }}>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder || 'Ask me anything…'}
        rows={1}
        style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: 14.5, lineHeight: 1.5, color: '#26331f', background: 'transparent', fontFamily: 'inherit', maxHeight: 200 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onOpenLibrary && (
            <button onClick={onOpenLibrary} title="Prompt library" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f6ec', border: '1px solid #e1ead9', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: '#4a5c43', fontSize: 12.5, fontWeight: 600 }}>
              <BookOpen size={14} /> Prompts
            </button>
          )}
          {metaConnected !== null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#9aa593' }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: metaConnected ? '#1877f2' : '#c3ccb9', display: 'inline-block' }} /> {metaConnected ? 'Meta connected' : 'Meta not connected'}
            </span>
          )}
        </div>
        <button
          onClick={() => value.trim() && !disabled && onSend()}
          disabled={disabled || !value.trim()}
          style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: (disabled || !value.trim()) ? '#cdd8c5' : '#141d15', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (disabled || !value.trim()) ? 'default' : 'pointer' }}
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  )
}
