'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ActivityPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('activity_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
      setLogs(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const icons: Record<string,string> = { META_CONNECTED:'🔗', SYNC_COMPLETED:'↻', META_OAUTH_STARTED:'🔐', RECOMMENDATION_APPROVED:'✓', RECOMMENDATION_REJECTED:'✕' }

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'white'}}>Activity Log</h1>
        <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Complete audit trail of every action in Selfmade.</p>
      </div>
      <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:48,textAlign:'center',color:'rgba(255,255,255,0.4)'}}>Loading…</div>
        ) : !logs.length ? (
          <div style={{padding:48,textAlign:'center',color:'rgba(255,255,255,0.4)'}}>No activity yet.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#1c3533'}}>
              {['Action','Description','By','Time'].map(h => <th key={h} style={{textAlign:'left',padding:'10px 16px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,0.4)',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  <td style={{padding:'12px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:16}}>{icons[log.action_type]||'·'}</span>
                      <span style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'.05em'}}>{log.action_type?.replace(/_/g,' ')}</span>
                    </div>
                  </td>
                  <td style={{padding:'12px 16px',fontSize:13,color:'rgba(255,255,255,0.7)'}}>{log.description}</td>
                  <td style={{padding:'12px 16px'}}><span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:100,background:log.performed_by==='user'?'rgba(223,254,149,0.1)':'rgba(147,197,253,0.1)',color:log.performed_by==='user'?'#dffe95':'#93c5fd'}}>{log.performed_by==='user'?'You':'AI'}</span></td>
                  <td style={{padding:'12px 16px',fontSize:11,color:'rgba(255,255,255,0.35)',whiteSpace:'nowrap'}}>{new Date(log.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
