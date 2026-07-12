'use client'
/**
 * Sidebar block under "Reports" (Analytics area): a "＋ Create report" button, the org's saved
 * reports, and a "Shared with me" group (reports a partner invited this org onto). Clicking one
 * deep-links to /reports?report=<id>. Silent while migrations 092/093 are still pending.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChevronRight } from 'lucide-react'
import { TEMPLATE_BY_KEY } from '@/lib/reports/templates'

type Saved = { id: string; name: string; template_key: string; visibility?: string; ownerName?: string }

// Quick-report shortcuts (Motion's sidebar folders). Each opens a generated report on click.
const QUICK_REPORTS: { emoji: string; label: string; href: string }[] = [
  { emoji: '🏆', label: 'Top Creatives', href: '/reports?template=top_performers' },
  { emoji: '💵', label: 'Top Converters', href: '/reports?template=top_converters' },
  { emoji: '📈', label: 'Scalers', href: '/reports?template=scalers' },
  { emoji: '👀', label: 'Top Engagers', href: '/reports?template=top_engagers' },
  { emoji: '🪝', label: 'Top Hooks', href: '/reports?template=top_hook' },
  { emoji: '⏱️', label: 'Top Hold', href: '/reports?template=top_hold' },
  { emoji: '🎬', label: 'Video Analysis', href: '/reports?template=video_analysis' },
  { emoji: '🖼️', label: 'Static Analysis', href: '/reports?template=static_analysis' },
  { emoji: '🧩', label: 'Ad Format Comparison', href: '/reports?template=ad_format' },
  { emoji: '🚀', label: 'Launch Analysis', href: '/reports?template=launch_analysis' },
]
const FROM_TEMPLATES: { emoji: string; label: string; href: string }[] = [
  { emoji: '💵', label: 'Top converters', href: '/reports?template=top_converters' },
  { emoji: '⚖️', label: 'Scalers', href: '/reports?template=scalers' },
  { emoji: '🏋️', label: 'Heavies', href: '/reports?template=heavies' },
  { emoji: '😴', label: 'Bottom performers', href: '/reports?template=bottom_cpm' },
  { emoji: '🛤️', label: 'Customer journey', href: '/reports?template=customer_journey' },
  { emoji: '🔻', label: 'Funnel comparison', href: '/reports?template=funnel' },
]
const CREATIVE_PATTERNS: { emoji: string; label: string; href: string }[] = [
  { emoji: '🎞️', label: 'Asset Type', href: '/reports?template=top_performers&groupBy=format' },
  { emoji: '🎨', label: 'Visual Format', href: '/reports?template=visual_analysis' },
  { emoji: '💬', label: 'Messaging Theme', href: '/reports?template=messaging' },
  { emoji: '🪝', label: 'Hook Tactic', href: '/reports?template=hook_analysis' },
  { emoji: '✍️', label: 'Headline Tactic', href: '/reports?template=headline_analysis' },
  { emoji: '👥', label: 'Intended Audience', href: '/reports?template=persona' },
  { emoji: '📅', label: 'Seasonality', href: '/reports?template=top_performers&groupBy=seasonality' },
  { emoji: '🏷️', label: 'Offer Type', href: '/reports?template=offer_analysis' },
]

export default function SavedReportsNav() {
  const router = useRouter()
  const [reports, setReports] = useState<Saved[]>([])
  const [shared, setShared] = useState<Saved[]>([])

  const load = () => {
    fetch('/api/reports/saved').then(r => r.json()).then(j => { setReports(j.reports || []); setShared(j.shared || []) }).catch(() => {})
  }
  useEffect(() => {
    load()
    const h = () => load()
    window.addEventListener('reports:changed', h)
    return () => window.removeEventListener('reports:changed', h)
  }, [])

  const Item = ({ r, badge }: { r: Saved; badge?: string }) => {
    const emoji = TEMPLATE_BY_KEY[r.template_key]?.emoji || '📊'
    return (
      <button onClick={() => router.push(`/reports?report=${r.id}`)} title={r.ownerName ? `${r.name} — shared by ${r.ownerName}` : r.name}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{emoji}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        {badge && <span style={{ fontSize: 8.5, fontWeight: 800, color: '#8aaa8a', flexShrink: 0 }}>{badge}</span>}
      </button>
    )
  }

  const Shortcut = ({ s }: { s: { emoji: string; label: string; href: string } }) => (
    <button onClick={() => router.push(s.href)} title={s.label}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>{s.emoji}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
    </button>
  )

  return (
    <div style={{ padding: '4px 12px 8px' }}>
      <button onClick={() => router.push('/reports?create=1')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 9, border: '1px dashed rgba(223,254,149,0.3)', background: 'rgba(223,254,149,0.06)', color: '#dffe95', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        <Plus size={15} /> Create report
      </button>

      {reports.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {reports.map(r => <Item key={r.id} r={r} badge={r.visibility === 'team' ? 'TEAM' : undefined} />)}
        </div>
      )}

      {shared.length > 0 && (
        <Folder title="Shared with me" defaultOpen>
          {shared.map(r => <Item key={r.id} r={r} badge="SHARED" />)}
        </Folder>
      )}

      {/* Quick-report shortcuts — click to generate */}
      <Folder title="Reports" defaultOpen>
        {QUICK_REPORTS.map(s => <Shortcut key={s.label} s={s} />)}
      </Folder>
      <Folder title="Creative Patterns">
        {CREATIVE_PATTERNS.map(s => <Shortcut key={s.label} s={s} />)}
      </Folder>
      <Folder title="From Templates">
        {FROM_TEMPLATES.map(s => <Shortcut key={s.label} s={s} />)}
      </Folder>
    </div>
  )
}

// Collapsible sidebar folder.
function Folder({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '5px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
        <ChevronRight size={12} color="rgba(255,255,255,0.4)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{title}</span>
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>}
    </div>
  )
}
