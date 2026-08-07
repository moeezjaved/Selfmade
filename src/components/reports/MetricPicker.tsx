'use client'
/**
 * KPI / column picker modal (Motion's "Customize columns"). Reorder + remove selected metrics, add
 * more KPIs or AI-tag columns, apply, and save the set as a named preset (localStorage).
 */
import { useState } from 'react'
import { promptText } from '@/components/ConfirmDialog'
import { METRICS, type MetricKey } from '@/lib/reports/templates'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const AI_TAGS: { key: string; label: string }[] = [
  { key: 'asset_type', label: 'Asset Type' }, { key: 'visual_format', label: 'Visual Format' },
  { key: 'messaging_theme', label: 'Messaging theme' }, { key: 'offer_type', label: 'Offer Type' },
  { key: 'seasonality', label: 'Seasonality' }, { key: 'hook_tactic', label: 'Hook Tactic' },
  { key: 'headline_tactic', label: 'Headline Tactic' }, { key: 'intended_audience', label: 'Intended Audience' },
]
const AI_LABEL: Record<string, string> = Object.fromEntries(AI_TAGS.map(t => [t.key, t.label]))

export default function MetricPicker({ metrics, tagCols, onApply, onSavePreset, onClose }: {
  metrics: MetricKey[]
  tagCols: string[]
  onApply: (metrics: MetricKey[], tagCols: string[]) => void
  onSavePreset: (name: string, metrics: MetricKey[], tagCols: string[]) => void
  onClose: () => void
}) {
  const [sel, setSel] = useState<MetricKey[]>(metrics)
  const [tags, setTags] = useState<string[]>(tagCols)
  const [q, setQ] = useState('')

  const move = (i: number, d: number) => setSel(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s;[n[i], n[j]] = [n[j], n[i]]; return n })
  const removeM = (m: MetricKey) => setSel(s => s.length > 1 ? s.filter(x => x !== m) : s)
  const addM = (m: MetricKey) => setSel(s => s.includes(m) ? s : [...s, m])
  const toggleTag = (k: string) => setTags(t => t.includes(k) ? t.filter(x => x !== k) : [...t, k])

  const avail = (Object.keys(METRICS) as MetricKey[]).filter(m => !sel.includes(m) && (!q || METRICS[m].label.toLowerCase().includes(q.toLowerCase())))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, background: 'rgba(10,20,13,.55)', backdropFilter: 'blur(3px)', padding: '32px 20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 860, maxWidth: '100%', maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, boxShadow: '0 40px 90px -20px rgba(0,0,0,.55)', overflow: 'hidden' }}>
        {/* search */}
        <div style={{ padding: '18px 22px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 11, padding: '10px 14px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa196" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search KPIs" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: 14, color: '#0e1b12' }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 0, overflow: 'hidden', flex: 1 }}>
          {/* selected */}
          <div style={{ borderRight: '1px solid rgba(26,58,26,.08)', padding: '10px 16px 16px', overflowY: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', margin: '6px 4px 10px' }}>Selected metrics</div>
            {sel.map((m, i) => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 9, background: '#f8faf4', border: '1px solid rgba(26,58,26,.07)', marginBottom: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} style={arrow}>▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === sel.length - 1} style={arrow}>▼</button>
                </div>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0e1b12' }}>{METRICS[m].label}</span>
                {sel.length > 1 && <button onClick={() => removeM(m)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9aa196', fontSize: 13 }}>✕</button>}
              </div>
            ))}
          </div>

          {/* available */}
          <div style={{ padding: '10px 18px 16px', overflowY: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', margin: '6px 0 10px' }}>Metrics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 18 }}>
              {avail.map(m => (
                <button key={m} onClick={() => addM(m)} style={addRow} onMouseEnter={e => e.currentTarget.style.background = '#f4f6f0'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <span style={{ color: '#6fb03a', fontWeight: 800 }}>＋</span> {METRICS[m].label}
                </button>
              ))}
              {!avail.length && <div style={{ fontSize: 12.5, color: '#9aa196', padding: 8 }}>All metrics selected.</div>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', margin: '2px 0 10px' }}>AI tags</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {AI_TAGS.map(t => {
                const on = tags.includes(t.key)
                return (
                  <button key={t.key} onClick={() => toggleTag(t.key)} style={{ ...addRow, background: on ? '#f0f7ee' : '#fff', borderColor: on ? '#c8e6c0' : 'rgba(26,58,26,.1)' }}>
                    <span style={{ color: on ? '#2d7a2d' : '#7c3aed', fontWeight: 800 }}>{on ? '✓' : '✨'}</span> {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', borderTop: '1px solid rgba(26,58,26,.08)' }}>
          <div style={{ flex: 1 }} />
          <button onClick={async () => { const n = await promptText({ title: 'Preset name?', placeholder: 'e.g. My KPIs' }); if (n) onSavePreset(n, sel, tags) }} style={btnGhost}>Save as new preset</button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={() => { onApply(sel, tags); onClose() }} style={btnPrimary}>Apply</button>
        </div>
      </div>
    </div>
  )
}

const arrow: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: '#9aa196', fontSize: 8, lineHeight: 1, padding: 0 }
const addRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(26,58,26,.1)', background: '#fff', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: '#0e1b12' }
const btnGhost: React.CSSProperties = { padding: '9px 15px', borderRadius: 10, border: '1px solid rgba(26,58,26,.14)', background: '#fff', color: '#3a4636', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: FONT }
const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 10, border: 'none', background: '#0e1b12', color: '#dffe95', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: FONT }

export { AI_LABEL }
