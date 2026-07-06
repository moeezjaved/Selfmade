'use client'
import UpgradeGate from '@/components/UpgradeGate'
/** Pattern Detection — what repeats among WINNING ads in a niche. Creative
 *  intelligence built on the Creative DNA + Winner Score. */
import { useEffect, useState, useCallback } from 'react'

const NICHES = ['Supplements', 'Health & Wellness', 'Beauty', 'Skincare', 'Fashion', 'Sports & Outdoors',
  'Home & Garden', 'Food & Drink', 'Pets', 'Accessories', 'Jewelry & Watches', 'Tech', 'Games', 'Other']

interface Bucket { value: string; count: number; pct: number }
interface Patterns {
  niche: string; topic: string | null; sampleSize: number
  patterns: Record<string, Bucket[]>
  sampleHooks: string[]
}

const LABELS: Record<string, string> = {
  format_style: 'Format (UGC vs Studio)', visual_style: 'Visual style', format: 'Media type',
  hook_type: 'Hook', emotion: 'Emotion', angle: 'Angle', tone: 'Tone', persona: 'Persona',
  cta: 'CTA', runtime: 'Run-time',
}
const ORDER = ['format_style', 'visual_style', 'hook_type', 'emotion', 'angle', 'runtime', 'format', 'tone', 'persona', 'cta']

function Bar({ b, max }: { b: Bucket; max: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ width: 130, fontSize: 12, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={b.value}>{b.value}</div>
      <div style={{ flex: 1, height: 18, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ width: `${max ? (100 * b.count) / max : 0}%`, height: '100%', background: '#1a3a1a', borderRadius: 5 }} />
      </div>
      <div style={{ width: 38, textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#111', flexShrink: 0 }}>{b.pct}%</div>
    </div>
  )
}

function Card({ title, buckets }: { title: string; buckets: Bucket[] }) {
  if (!buckets?.length) return null
  const max = Math.max(...buckets.map(b => b.count))
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginBottom: 12 }}>{title}</div>
      {buckets.map(b => <Bar key={b.value} b={b} max={max} />)}
    </div>
  )
}

export default function PatternsPage() {
  return <UpgradeGate feature="aiInsights" name="AI Insights"><PatternsInner /></UpgradeGate>
}
function PatternsInner() {
  const [niche, setNiche] = useState('Supplements')
  const [topic, setTopic] = useState('')
  const [topicInput, setTopicInput] = useState('')
  const [data, setData] = useState<Patterns | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ niche, ...(topic ? { topic } : {}) })
      const r = await fetch(`/api/discovery/patterns?${p}`)
      setData(await r.json())
    } catch { setData(null) } finally { setLoading(false) }
  }, [niche, topic])
  useEffect(() => { load() }, [load])

  const top = (k: string) => data?.patterns?.[k]?.[0]
  // one-line synthesized "winning formula"
  const formula = data && data.sampleSize > 0 ? [
    top('format_style') && `${top('format_style')!.pct}% ${top('format_style')!.value}`,
    top('hook_type') && `${top('hook_type')!.value} hook`,
    top('emotion') && `${top('emotion')!.value} emotion`,
    top('visual_style') && top('visual_style')!.value,
    top('runtime') && `runs ${top('runtime')!.value}`,
  ].filter(Boolean).join(' · ') : ''

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 4 }}>Pattern Detection</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 18 }}>What repeats among <strong>winning</strong> ads — creative intelligence, not ad spying.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <select value={niche} onChange={e => setNiche(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 10, border: '1.5px solid #1a3a1a', fontSize: 14, fontWeight: 700, color: '#1a3a1a', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
          {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <form onSubmit={e => { e.preventDefault(); setTopic(topicInput.trim()) }} style={{ display: 'flex', gap: 6 }}>
          <input value={topicInput} onChange={e => setTopicInput(e.target.value)} placeholder="narrow to a topic (e.g. hair loss)"
            style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, width: 240, fontFamily: 'inherit' }} />
          {topic && <button type="button" onClick={() => { setTopic(''); setTopicInput('') }} style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Clear</button>}
        </form>
      </div>

      {loading && <div style={{ color: '#9ca3af', padding: 40 }}>Analyzing winners…</div>}
      {!loading && data && data.sampleSize === 0 && (
        <div style={{ color: '#9ca3af', padding: 40 }}>No winning ads {topic ? `about "${topic}" ` : ''}in {niche} yet.</div>
      )}
      {!loading && data && data.sampleSize > 0 && (
        <>
          <div style={{ background: '#1a3a1a', color: '#dffe95', borderRadius: 14, padding: '16px 18px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>WINNING FORMULA · {niche}{topic ? ` · "${topic}"` : ''} · {data.sampleSize} winning creatives</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.5 }}>{formula}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px,100%), 1fr))', gap: 14 }}>
            {ORDER.map(k => <Card key={k} title={LABELS[k] || k} buckets={data.patterns[k]} />)}
          </div>

          {data.sampleHooks?.length > 0 && (
            <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginBottom: 10 }}>Winning on-screen hooks (real examples)</div>
              {data.sampleHooks.map((h, i) => (
                <div key={i} style={{ fontSize: 13, color: '#374151', padding: '6px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>“{h}”</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
