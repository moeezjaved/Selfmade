'use client'
/**
 * Create-report modal — matches the design handoff (Create Report.dc.html).
 * Dark radial backdrop, a "Meta" platform pill in the header, a featured trio, an "or start with a
 * template" divider, then templates grouped by category. Each card = gradient tile + name (+ desc).
 * onCreate(templateKey) hands back to the reports page to render the report.
 */
import { useState } from 'react'
import { TEMPLATES, CATEGORIES } from '@/lib/reports/templates'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

// Lime/green branded tiles — varied for rhythm, cycled by index (like the handoff).
const TILES = [
  'linear-gradient(135deg,#dffe95,#b6e86a)', // lime
  'linear-gradient(135deg,#e4efc6,#c2dd8a)', // sage
  'linear-gradient(135deg,#a9d98f,#6fb85f)', // forest
  'linear-gradient(135deg,#c8f0cf,#8fd6a0)', // mint
  'linear-gradient(135deg,#eef4dc,#d4e8a8)', // pale
]
const tileFor = (i: number) => TILES[i % TILES.length]

const PLATFORMS = [
  { key: 'meta', label: 'Meta', live: true },
  { key: 'google', label: 'Google', live: false },
  { key: 'tiktok', label: 'TikTok', live: false },
  { key: 'linkedin', label: 'LinkedIn', live: false },
]

export default function CreateReportModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (templateKey: string) => void
}) {
  const [platform, setPlatform] = useState('meta')
  const [platOpen, setPlatOpen] = useState(false)
  const featured = TEMPLATES.filter(t => t.featured)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, background: 'radial-gradient(130% 130% at 50% 0%, rgba(22,40,26,.92) 0%, rgba(10,20,13,.92) 70%)', backdropFilter: 'blur(3px)', padding: '32px 20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 1000, maxWidth: '100%', maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 22, boxShadow: '0 40px 90px -20px rgba(0,0,0,.6)', overflow: 'hidden', animation: 'crpop .18s ease' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '22px 26px 18px', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0e1b12', letterSpacing: '-.02em' }}>Create report</div>
          {/* platform pill */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setPlatOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: '6px 11px', fontSize: 12.5, fontWeight: 700, color: '#3a4636', cursor: 'pointer', fontFamily: FONT }}>
              <MetaIcon /> {PLATFORMS.find(p => p.key === platform)?.label}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#7c8577" strokeWidth="1.8"><path d="M2 4l4 4 4-4" strokeLinecap="round" /></svg>
            </button>
            {platOpen && (
              <>
                <div onClick={() => setPlatOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                <div style={{ position: 'absolute', left: 0, top: '112%', zIndex: 6, background: '#fff', border: '1px solid rgba(26,58,26,.12)', borderRadius: 11, boxShadow: '0 14px 36px rgba(0,0,0,.16)', padding: 6, width: 190 }}>
                  {PLATFORMS.map(p => (
                    <button key={p.key} disabled={!p.live} onClick={() => { if (p.live) { setPlatform(p.key); setPlatOpen(false) } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: p.live ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600, color: p.live ? '#0e1b12' : '#b5c5b5', fontFamily: FONT }}
                      onMouseEnter={e => { if (p.live) e.currentTarget.style.background = '#f4f6f0' }} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ flex: 1 }}>{p.label}</span>
                      {!p.live && <span style={{ fontSize: 9, fontWeight: 800, background: '#f4f6f0', color: '#8aaa8a', padding: '1px 6px', borderRadius: 100 }}>SOON</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#f4f6f0', color: '#7c8577', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* body */}
        <div className="cr-scroll" style={{ overflowY: 'auto', padding: '22px 26px 26px' }}>

          {/* primary trio */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px,100%),1fr))', gap: 14 }}>
            {featured.map((t, i) => (
              <button key={t.key} className="cr-card" onClick={() => onCreate(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: '#fff', border: '1px solid rgba(26,58,26,.14)', borderRadius: 15, padding: '16px 18px', cursor: 'pointer', transition: 'all .15s', fontFamily: FONT }}>
                <span style={{ width: 42, height: 42, borderRadius: 12, background: tileFor(i), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 21 }}>{t.emoji}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#0e1b12' }}>{t.title}</span>
              </button>
            ))}
          </div>

          {/* divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '24px 0 20px' }}>
            <span style={{ flex: 1, height: 1, background: 'rgba(26,58,26,.1)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#9aa196' }}>or start with a template</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(26,58,26,.1)' }} />
          </div>

          {/* sections */}
          {CATEGORIES.map(cat => {
            const items = TEMPLATES.filter(t => t.category === cat && !t.featured)
            if (!items.length) return null
            return (
              <div key={cat} style={{ marginBottom: 26 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#3a4636', marginBottom: 12, letterSpacing: '-.01em' }}>{cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px,100%),1fr))', gap: 14 }}>
                  {items.map((t, i) => (
                    <button key={t.key} className="cr-card" onClick={() => onCreate(t.key)}
                      style={{ display: 'flex', flexDirection: 'column', gap: 11, textAlign: 'left', background: '#fff', border: '1px solid rgba(26,58,26,.12)', borderRadius: 15, padding: 16, cursor: 'pointer', transition: 'all .15s', fontFamily: FONT, minHeight: 112 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <span style={{ width: 38, height: 38, borderRadius: 11, background: tileFor(i + 1), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 19 }}>{t.emoji}</span>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#0e1b12', lineHeight: 1.2 }}>{t.title}</span>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#7c8577', lineHeight: 1.45 }}>{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        @keyframes crpop{from{transform:translateY(10px) scale(.99);opacity:0}to{transform:none;opacity:1}}
        .cr-scroll::-webkit-scrollbar{width:9px}
        .cr-scroll::-webkit-scrollbar-thumb{background:rgba(26,58,26,.16);border-radius:8px}
        .cr-card:hover{border-color:rgba(26,58,26,.28) !important;box-shadow:0 10px 24px -16px rgba(14,27,18,.5);transform:translateY(-1px)}
      `}</style>
    </div>
  )
}

const MetaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1877f2" strokeWidth="2"><path d="M7 12a5 5 0 015-5 5 5 0 010 10 5 5 0 01-5-5zM17 12a5 5 0 00-5-5" opacity=".9" /></svg>
)
