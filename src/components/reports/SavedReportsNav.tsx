'use client'
/**
 * Sidebar block under "Reports" (Analytics area): a "＋ Create report" button, the org's saved
 * reports, and a "Shared with me" group (reports a partner invited this org onto). Clicking one
 * deep-links to /reports?report=<id>. Silent while migrations 092/093 are still pending.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { TEMPLATE_BY_KEY } from '@/lib/reports/templates'

type Saved = { id: string; name: string; template_key: string; visibility?: string; ownerName?: string }

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

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', padding: '10px 10px 5px' }}>{children}</div>
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
        <>
          <Label>Shared with me</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {shared.map(r => <Item key={r.id} r={r} badge="SHARED" />)}
          </div>
        </>
      )}
    </div>
  )
}
