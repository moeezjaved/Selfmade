'use client'
/**
 * Sidebar block under "Reports" (Analytics area): a "＋ Create report" button + the list of the
 * org's saved reports. Clicking one deep-links to /reports?report=<id>. Silent while the
 * saved_reports table (migration 092) is still pending — just shows the Create button.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, BarChart2 } from 'lucide-react'
import { TEMPLATE_BY_KEY } from '@/lib/reports/templates'

type Saved = { id: string; name: string; template_key: string; visibility: string }

export default function SavedReportsNav() {
  const router = useRouter()
  const [reports, setReports] = useState<Saved[]>([])

  const load = () => {
    fetch('/api/reports/saved').then(r => r.json()).then(j => setReports(j.reports || [])).catch(() => {})
  }
  useEffect(() => {
    load()
    // Refresh when a report is saved elsewhere in the app.
    const h = () => load()
    window.addEventListener('reports:changed', h)
    return () => window.removeEventListener('reports:changed', h)
  }, [])

  return (
    <div style={{ padding: '4px 12px 8px' }}>
      <button onClick={() => router.push('/reports?create=1')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', borderRadius: 9, border: '1px dashed rgba(223,254,149,0.3)', background: 'rgba(223,254,149,0.06)', color: '#dffe95', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        <Plus size={15} /> Create report
      </button>

      {reports.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {reports.map(r => {
            const emoji = TEMPLATE_BY_KEY[r.template_key]?.emoji || '📊'
            return (
              <button key={r.id} onClick={() => router.push(`/reports?report=${r.id}`)}
                title={r.name}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{emoji}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {r.visibility === 'team' && <span style={{ fontSize: 8.5, fontWeight: 800, color: '#8aaa8a', flexShrink: 0 }}>TEAM</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
