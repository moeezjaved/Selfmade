'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

// Read the active brand the ProjectSwitcher stored (client-safe cookie). Empty = "All brands".
function activeBrandId(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(new RegExp('(?:^|; )' + BRAND_COOKIE + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : ''
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      // WORKSPACE audit trail: /api/activity is workspace-scoped (admin client) and attributes each row
      // to the real actor, so the owner sees a teammate's launches labelled by name — not everything as
      // "You". BRAND ISOLATION: pass the active brand; the route returns brand + account-level events.
      const brand = activeBrandId()
      const j = await fetch(`/api/activity${brand && brand !== 'all' ? `?brand=${encodeURIComponent(brand)}` : ''}`).then(r => r.json()).catch(() => ({}))
      setLogs(Array.isArray(j.logs) ? j.logs : [])
      setLoading(false)
    }
    load()
    // Re-scope when the user switches brands from the top ProjectSwitcher (it broadcasts this event).
    const onBrand = () => { setLoading(true); load() }
    window.addEventListener('sf:brandchange', onBrand)
    return () => window.removeEventListener('sf:brandchange', onBrand)
  }, [])

  const icons: Record<string,string> = { META_CONNECTED:'🔗', SYNC_COMPLETED:'↻', META_OAUTH_STARTED:'🔐', RECOMMENDATION_APPROVED:'✓', RECOMMENDATION_REJECTED:'✕', AD_LAUNCHED:'🚀', CAMPAIGN_CREATED:'📣', CREATIVE_GENERATED:'🎨', BRAND_FOLLOWED:'❤️', BRAND_UNFOLLOWED:'💔', BRAND_SPIED:'🎯', BRAND_UNSPIED:'🚫' }
  // Human descriptions — the stored `description` is often a raw id (e.g. an OAuth state UUID), which
  // read as "random data". Prefer a friendly sentence per action; only show the stored text when it's
  // actually meaningful (not a bare UUID).
  const ACTION_TEXT: Record<string,string> = {
    META_OAUTH_STARTED: 'Started connecting your Meta account',
    META_CONNECTED: 'Connected your Meta account',
    SYNC_COMPLETED: 'Synced Meta insights',
    RECOMMENDATION_APPROVED: 'Approved an AI recommendation',
    RECOMMENDATION_REJECTED: 'Dismissed an AI recommendation',
    AD_LAUNCHED: 'Launched an ad',
    CAMPAIGN_CREATED: 'Created a campaign',
    CREATIVE_GENERATED: 'Generated a creative',
  }
  // Treat bare UUIDs AND other opaque internal ids (long dashless hex/base tokens, no spaces) as
  // "not human-readable" so we never print them as a description.
  const looksLikeId = (s:string) => {
    const t = (s||'').trim()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true   // UUID
    if (!/\s/.test(t) && t.length >= 16 && /^[a-z0-9_:-]+$/i.test(t) && /\d/.test(t)) return true // opaque token/id
    return false
  }
  const describe = (log:any) => {
    // For known action types, always prefer the friendly sentence — the stored `description` is
    // usually an internal id (OAuth state, resource id) that reads as "random data".
    const mapped = ACTION_TEXT[log.action_type]
    if (mapped) return mapped
    const d = (log.description || '').trim()
    if (d && !looksLikeId(d)) return d
    return log.action_type ? log.action_type.replace(/_/g,' ').toLowerCase().replace(/^\w/, (c:string)=>c.toUpperCase()) : '—'
  }
  // Actor: the REAL person who did it (from /api/activity) — "You" for the viewer's own rows, the
  // teammate's name/email for others (so owner vs member is legible). AI/System for non-human actions.
  const byOf = (log:any): { label:string; color:string; bg:string } => {
    if (log.performed_by === 'ai' || log.performed_by === 'assistant' || log.performed_by === 'agent') return { label:'AI', color:'#2563eb', bg:'rgba(147,197,253,0.18)' }
    if (log.performed_by === 'system') return { label:'System', color:'#6b7280', bg:'rgba(0,0,0,0.05)' }
    if (log.is_self) return { label:'You', color:'#3a7a3a', bg:'rgba(255,90,44,0.35)' }
    return { label: log.actor || 'Teammate', color:'#7a4a1e', bg:'rgba(255,180,120,0.22)' }
  }

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'#141d15'}}>Activity Log</h1>
        <p style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>Complete audit trail of every action in Selfmade.</p>
      </div>
      {/* overflowX:auto so By/Time stay reachable on mobile — the card's overflow:hidden was clipping them */}
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden'}}>
       <div style={{overflowX:'auto'}}>
        {loading ? (
          <div style={{padding:48,textAlign:'center',color:'#7a9a7a'}}>Loading…</div>
        ) : !logs.length ? (
          <div style={{padding:48,textAlign:'center',color:'#7a9a7a'}}>No activity yet.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:560}}>
            <thead><tr style={{background:'#f4f0e6'}}>
              {['Action','Description','By','Time'].map(h => <th key={h} style={{textAlign:'left',padding:'10px 16px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'#7a9a7a',borderBottom:'1px solid rgba(255,90,44,0.08)'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{borderBottom:'1px solid rgba(0,0,0,0.04)'}}>
                  <td style={{padding:'12px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:16}}>{icons[log.action_type]||'·'}</span>
                      <span style={{fontSize:12,fontWeight:700,color:'#6b8f6b',textTransform:'uppercase',letterSpacing:'.05em'}}>{log.action_type?.replace(/_/g,' ')}</span>
                    </div>
                  </td>
                  <td style={{padding:'12px 16px',fontSize:13,color:'#3a5a3a'}}>{describe(log)}</td>
                  <td style={{padding:'12px 16px'}}>{(() => { const b = byOf(log); return <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:100,background:b.bg,color:b.color}}>{b.label}</span> })()}</td>
                  <td style={{padding:'12px 16px',fontSize:11,color:'#8b8a72',whiteSpace:'nowrap'}}>{new Date(log.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
       </div>
      </div>
    </div>
  )
}
