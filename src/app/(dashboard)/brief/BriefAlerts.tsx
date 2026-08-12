'use client'
/**
 * BRIEF ALERTS — the bell's competitor new-ad notifications, surfaced ON the brief so
 * founders don't have to hunt for them. Each unread alert ("Nike launched 4 new ads")
 * becomes a row with a direct "See & remake" action into that brand's file. Marking
 * them here clears the bell too. Shows only when there are unread drops.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', FOREST = '#141d15'

type Notif = { id: string; type?: string; page_id?: string; brand_name?: string; ad_count?: number; read_at?: string | null; created_at?: string }

const ago = (iso?: string) => {
  if (!iso) return ''
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3))
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`
}
const isBlank = (b?: string) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export default function BriefAlerts({ exclude = [] }: { exclude?: string[] }) {
  const [notifs, setNotifs] = useState<Notif[] | null>(null)
  // Merge, don't repeat: launches the brief already covered (hero/insights/evidence) are excluded —
  // this section only surfaces brands the brief DIDN'T mention. One fact, one place.
  const covered = exclude.map(t => t.toLowerCase())
  useEffect(() => {
    fetch('/api/notifications').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.notifications) setNotifs(d.notifications.filter((n: Notif) => !n.read_at && !isBlank(n.brand_name)).slice(0, 8))
    }).catch(() => {})
  }, [])
  const shown = (notifs || []).filter(n => !covered.some(t => t.includes(String(n.brand_name || '').toLowerCase()))).slice(0, 3)
  if (shown.length === 0) return null

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Bell size={13} color={MUTED} />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }}>New from brands you watch</div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {shown.map(n => (
          <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: '12px 15px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 750, color: INK, letterSpacing: '-.01em' }}>
                {n.brand_name} launched {n.ad_count || 1} new ad{(n.ad_count || 1) === 1 ? '' : 's'}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600, marginTop: 2 }}>{ago(n.created_at)} · worth a look before they scale it</div>
            </div>
            {n.page_id && (
              <Link href={`/knowledge/brand/${n.page_id}`} style={{ flexShrink: 0, background: FOREST, color: '#ff5a2c', fontSize: 12, fontWeight: 800, padding: '8px 15px', borderRadius: 100, textDecoration: 'none' }}>See &amp; remake →</Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
