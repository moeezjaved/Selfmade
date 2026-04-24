'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('campaigns').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      setCampaigns(data || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:'white',letterSpacing:'-.02em'}}>Campaigns</h1>
          <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>All campaigns synced from your Meta account</p>
        </div>
        <button onClick={() => window.location.href='/ad-engine'} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'10px 22px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
          + Launch New
        </button>
      </div>

      <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:48,textAlign:'center',color:'rgba(255,255,255,0.4)',fontSize:14}}>Loading campaigns…</div>
        ) : campaigns.length === 0 ? (
          <div style={{padding:48,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>📊</div>
            <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaigns yet</div>
            <div style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Sync your Meta account to import campaigns, or launch your first one.</div>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button onClick={() => fetch('/api/meta/sync',{method:'POST'}).then(()=>window.location.reload())} style={{background:'rgba(223,254,149,0.1)',color:'#dffe95',border:'1px solid rgba(223,254,149,0.2)',padding:'9px 20px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                ↻ Sync from Meta
              </button>
              <button onClick={() => window.location.href='/ad-engine'} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'9px 20px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                🚀 Launch First Campaign
              </button>
            </div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#1c3533'}}>
                {['Campaign','Status','Objective','Daily Budget','Created'].map(h => (
                  <th key={h} style={{textAlign:'left',padding:'10px 16px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,0.4)',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  <td style={{padding:'13px 16px',fontSize:14,fontWeight:700,color:'white'}}>{c.name}</td>
                  <td style={{padding:'13px 16px'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,fontWeight:700,padding:'3px 9px',borderRadius:100,background:c.status==='ACTIVE'?'rgba(134,239,172,0.1)':'rgba(251,191,36,0.1)',color:c.status==='ACTIVE'?'#86efac':'#fbbf24',border:`1px solid ${c.status==='ACTIVE'?'rgba(134,239,172,0.2)':'rgba(251,191,36,0.2)'}`}}>
                      {c.status==='ACTIVE'?'● Active':'⏸ Paused'}
                    </span>
                  </td>
                  <td style={{padding:'13px 16px',fontSize:13,color:'rgba(255,255,255,0.5)'}}>{c.objective || '—'}</td>
                  <td style={{padding:'13px 16px',fontSize:13,color:'rgba(255,255,255,0.7)',fontWeight:600}}>{c.daily_budget ? `$${(c.daily_budget/100).toFixed(2)}` : '—'}</td>
                  <td style={{padding:'13px 16px',fontSize:12,color:'rgba(255,255,255,0.35)'}}>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
