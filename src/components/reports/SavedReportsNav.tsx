'use client'
/**
 * Sidebar block under "Reports" (Analytics area): a "＋ Create report" button, the org's saved
 * reports, and a "Shared with me" group (reports a partner invited this org onto). Clicking one
 * deep-links to /reports?report=<id>. Silent while migrations 092/093 are still pending.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAction } from '@/components/ConfirmDialog'
import { Plus, ChevronRight } from 'lucide-react'
import { TEMPLATE_BY_KEY } from '@/lib/reports/templates'

type Saved = { id: string; name: string; template_key: string; visibility?: string; ownerName?: string; config?: any }

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
  { emoji: '🎯', label: 'New Launches', href: '/reports?template=new_launches' },
]
const FROM_TEMPLATES: { emoji: string; label: string; href: string }[] = [
  { emoji: '💵', label: 'Top converters', href: '/reports?template=top_converters' },
  { emoji: '⚖️', label: 'Scalers', href: '/reports?template=scalers' },
  { emoji: '🏋️', label: 'Heavies', href: '/reports?template=heavies' },
  { emoji: '😴', label: 'Bottom performers', href: '/reports?template=bottom_cpm' },
  { emoji: '🛤️', label: 'Customer journey', href: '/reports?template=customer_journey' },
  { emoji: '🔻', label: 'Funnel comparison', href: '/reports?template=funnel' },
]
// Sprints (time-series) — same templates, opened straight into the over-time view.
const SPRINTS: { emoji: string; label: string; href: string }[] = [
  { emoji: '📈', label: 'ROAS over time', href: '/reports?template=top_performers&sort=roas&dateRange=last_90d&view=sprint' },
  { emoji: '💸', label: 'Spend pacing', href: '/reports?template=top_performers&sort=spend&dateRange=last_90d&view=sprint' },
  { emoji: '🎯', label: 'CPA trend', href: '/reports?template=top_converters&sort=cpa&dateRange=last_90d&view=sprint' },
  { emoji: '🪝', label: 'Hook-rate trend', href: '/reports?template=top_hook&sort=hook_rate&dateRange=last_90d&view=sprint' },
  { emoji: '📊', label: 'Campaign momentum', href: '/reports?template=top_performers&groupBy=campaign&sort=roas&dateRange=last_90d&view=sprint' },
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

  // Delete a saved report (own reports only — shared-with-me rows are owned by another org).
  const del = async (r: Saved) => {
    if (!(await confirmAction({ title: `Delete “${r.name}”?`, body: 'This report will be removed. This can’t be undone.' }))) return
    setReports(rs => rs.filter(x => x.id !== r.id))
    await fetch(`/api/reports/saved?id=${r.id}`, { method: 'DELETE' }).catch(() => {})
    window.dispatchEvent(new Event('reports:changed'))
  }

  const Item = ({ r, badge }: { r: Saved; badge?: string }) => {
    const emoji = TEMPLATE_BY_KEY[r.template_key]?.emoji || '📊'
    const [hover, setHover] = useState(false)
    const canDelete = !r.ownerName   // not a shared-with-me report
    return (
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ display: 'flex', alignItems: 'center', width: '100%', height: 32, borderRadius: 10, background: hover ? 'rgba(255,255,255,0.08)' : 'transparent', transition: 'background-color .075s ease-in-out' }}>
        <button onClick={() => router.push(`/reports?report=${r.id}`)} title={r.ownerName ? `${r.name} — shared by ${r.ownerName}` : r.name}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, height: '100%', padding: '0 4px 0 10px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>{emoji}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          {badge && <span style={{ fontSize: 8.5, fontWeight: 800, color: '#8b8a72', flexShrink: 0 }}>{badge}</span>}
        </button>
        {canDelete && hover && (
          <button onClick={() => del(r)} title="Delete report"
            style={{ flexShrink: 0, width: 24, height: 24, marginRight: 5, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,120,110,0.25)'; e.currentTarget.style.color = '#ffd5d0' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}>✕</button>
        )}
      </div>
    )
  }

  const Shortcut = ({ s }: { s: { emoji: string; label: string; href: string } }) => (
    <button onClick={() => router.push(s.href)} title={s.label}
      style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', height: 32, padding: '0 10px', borderRadius: 10, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background-color .075s ease-in-out' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>{s.emoji}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
    </button>
  )

  return (
    <div style={{ padding: '4px 12px 8px' }}>
      <button onClick={() => router.push('/reports?create=1')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 9, border: '1px dashed rgba(255,90,44,0.3)', background: 'rgba(255,90,44,0.06)', color: '#ff5a2c', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        <Plus size={15} /> Create report
      </button>

      {reports.length > 0 && (() => {
        // Reports with a config.folder group under a collapsible folder; the rest render flat on top.
        const loose = reports.filter(r => !r.config?.folder)
        const byFolder = new Map<string, Saved[]>()
        for (const r of reports) { const f = r.config?.folder; if (f) { const a = byFolder.get(f) || []; a.push(r); byFolder.set(f, a) } }
        return (
          <>
            {loose.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {loose.map(r => <Item key={r.id} r={r} badge={r.visibility === 'team' ? 'TEAM' : undefined} />)}
              </div>
            )}
            {Array.from(byFolder.entries()).map(([f, rs]) => (
              <Folder key={f} title={f} defaultOpen>
                {rs.map(r => <Item key={r.id} r={r} badge={r.visibility === 'team' ? 'TEAM' : undefined} />)}
              </Folder>
            ))}
          </>
        )
      })()}

      {shared.length > 0 && (
        <Folder title="Shared with me" defaultOpen>
          {shared.map(r => <Item key={r.id} r={r} badge="SHARED" />)}
        </Folder>
      )}

      {/* Quick-report shortcuts — click to generate */}
      <Folder title="Reports" defaultOpen>
        {QUICK_REPORTS.map(s => <Shortcut key={s.label} s={s} />)}
      </Folder>
      <Folder title="Sprints">
        {SPRINTS.map(s => <Shortcut key={s.label} s={s} />)}
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
