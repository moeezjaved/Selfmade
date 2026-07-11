'use client'
/**
 * Create-report modal — Motion-style template gallery.
 * Pick a platform (Meta live; others "soon"), then a report template. Featured templates sit up top,
 * the rest grouped by category. onCreate(templateKey) hands back to the reports page to render the report.
 */
import { useState } from 'react'
import { TEMPLATES, CATEGORIES, type ReportTemplate } from '@/lib/reports/templates'

const PLATFORMS = [
  { key: 'meta', label: 'Meta', emoji: '𝑓', live: true },
  { key: 'google', label: 'Google', emoji: '🔍', live: false },
  { key: 'tiktok', label: 'TikTok', emoji: '🎵', live: false },
  { key: 'linkedin', label: 'LinkedIn', emoji: '💼', live: false },
]

export default function CreateReportModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (templateKey: string) => void
}) {
  const [platform, setPlatform] = useState('meta')
  const [q, setQ] = useState('')

  const featured = TEMPLATES.filter(t => t.featured)
  const match = (t: ReportTemplate) =>
    !q || t.title.toLowerCase().includes(q.toLowerCase()) || t.description.toLowerCase().includes(q.toLowerCase())

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,25,10,0.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fbfdfa', borderRadius: 22, width: '100%', maxWidth: 920, boxShadow: '0 24px 80px rgba(0,0,0,0.35)', overflow: 'hidden', animation: 'rpop .18s ease' }}>

        {/* Header */}
        <div style={{ padding: '22px 26px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a1a' }}>Create a report</div>
            <div style={{ fontSize: 13, color: '#7a9a7a', marginTop: 3 }}>Pick a template — we build it from your live ad data</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#eef4ec', width: 32, height: 32, borderRadius: 9, cursor: 'pointer', fontSize: 16, color: '#5a7a5a', fontWeight: 700 }}>✕</button>
        </div>

        {/* Platform selector */}
        <div style={{ padding: '16px 26px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PLATFORMS.map(p => (
            <button key={p.key} disabled={!p.live} onClick={() => p.live && setPlatform(p.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 15px', borderRadius: 100, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: p.live ? 'pointer' : 'not-allowed',
                border: platform === p.key ? '1.5px solid #1a3a1a' : '1.5px solid rgba(0,0,0,0.08)',
                background: platform === p.key ? '#1a3a1a' : '#fff', color: platform === p.key ? '#dffe95' : p.live ? '#3a5a3a' : '#b5c5b5', opacity: p.live ? 1 : 0.7 }}>
              <span style={{ fontSize: 15 }}>{p.emoji}</span>{p.label}
              {!p.live && <span style={{ fontSize: 9, fontWeight: 800, background: '#f0f7ee', color: '#8aaa8a', padding: '1px 6px', borderRadius: 100 }}>SOON</span>}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '16px 26px 0' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports…"
            style={{ width: '100%', padding: '11px 16px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.08)', fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff', color: '#1a3a1a', boxSizing: 'border-box' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '18px 26px 26px', maxHeight: '58vh', overflowY: 'auto' }}>

          {/* Featured */}
          {!q && (
            <>
              <SectionLabel>Featured</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px,100%),1fr))', gap: 12, marginBottom: 22 }}>
                {featured.map(t => <FeaturedCard key={t.key} t={t} onClick={() => onCreate(t.key)} />)}
              </div>
            </>
          )}

          {/* By category */}
          {CATEGORIES.map(cat => {
            const items = TEMPLATES.filter(t => t.category === cat && match(t) && (q || !t.featured))
            if (!items.length) return null
            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                <SectionLabel>{cat}</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px,100%),1fr))', gap: 10 }}>
                  {items.map(t => <TemplateCard key={t.key} t={t} onClick={() => onCreate(t.key)} />)}
                </div>
              </div>
            )
          })}

          {q && TEMPLATES.filter(match).length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ab09a', fontSize: 13 }}>No reports match “{q}”.</div>
          )}
        </div>
      </div>
      <style>{`@keyframes rpop{from{transform:translateY(10px) scale(.99);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, color: '#7a9a7a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>{children}</div>
}

function FeaturedCard({ t, onClick }: { t: ReportTemplate; onClick: () => void }) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(26,58,26,0.14)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)' }}
      style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#1a3a1a,#2d5a2d)', border: 'none', borderRadius: 16, padding: '18px 18px 16px', color: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', transition: 'all .16s' }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{t.emoji}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#eafcbf' }}>{t.title}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4, lineHeight: 1.45 }}>{t.description}</div>
    </button>
  )
}

function TemplateCard({ t, onClick }: { t: ReportTemplate; onClick: () => void }) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#9dc98a'; e.currentTarget.style.background = '#f5faf2' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)'; e.currentTarget.style.background = '#fff' }}
      style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: '#fff', border: '1.5px solid rgba(0,0,0,0.07)', borderRadius: 14, padding: '14px 15px', display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'all .14s' }}>
      <div style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{t.emoji}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1a3a1a' }}>{t.title}</div>
        <div style={{ fontSize: 11.5, color: '#8aaa8a', marginTop: 2, lineHeight: 1.4 }}>{t.description}</div>
        {t.needsVideo && <span style={{ display: 'inline-block', marginTop: 6, fontSize: 9, fontWeight: 800, background: '#eef4ec', color: '#5a7a5a', padding: '2px 7px', borderRadius: 100 }}>🎬 VIDEO</span>}
      </div>
    </button>
  )
}
