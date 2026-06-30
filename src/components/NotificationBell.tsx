'use client'
/**
 * Notification bell — new-ad alerts on followed brands. Polls /api/notifications, shows an unread
 * badge, opens a dropdown of "{brand} launched N new ads", marks all read on open. The retention
 * heartbeat: tells users their tracked competitors shipped something → pulls them back in.
 */
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'

interface Notif {
  id: number; page_id: string | null; brand_name: string | null
  ad_count: number; read_at: string | null; created_at: string
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = async () => {
    try { const r = await fetch('/api/notifications'); if (!r.ok) return; const d = await r.json(); setItems(d.notifications || []); setUnread(d.unread || 0) } catch { /* ignore */ }
  }
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      setUnread(0)
      try { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_all_read' }) }) } catch { /* ignore */ }
    }
  }

  const ago = (s: string) => {
    const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
    if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={toggle} aria-label="Notifications"
        style={{ position: 'relative', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(223,254,149,0.18)', background: 'rgba(223,254,149,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Bell size={17} color="rgba(255,255,255,0.85)" />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 99, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #243d20' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 0, left: 'calc(100% + 12px)', width: 300, zIndex: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 14px 36px rgba(0,0,0,0.20)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 14, color: '#111' }}>New ads from your brands</div>
          {items.length === 0 ? (
            <div style={{ padding: '26px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13, lineHeight: 1.5 }}>
              No alerts yet.<br />Follow brands in Discovery and we&apos;ll ping you the moment they launch a new ad.
            </div>
          ) : (
            <div style={{ maxHeight: 384, overflowY: 'auto' }}>
              {items.map(n => (
                <button key={n.id} onClick={() => { setOpen(false); router.push(n.page_id ? `/discovery/brand-spy/${n.page_id}` : '/discovery/following') }}
                  style={{ display: 'flex', width: '100%', gap: 10, padding: '11px 14px', border: 'none', borderBottom: '1px solid #f8fafc', background: n.read_at ? '#fff' : '#f0fdf4', cursor: 'pointer', textAlign: 'left', alignItems: 'center', fontFamily: 'inherit' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, fontSize: 13 }}>
                    {(n.brand_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: '#111', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.brand_name || 'A brand you follow'}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>launched {n.ad_count} new {n.ad_count === 1 ? 'ad' : 'ads'} · {ago(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
