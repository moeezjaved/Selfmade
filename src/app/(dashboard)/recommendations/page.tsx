'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function RecommendationsPage() {
  const [recs, setRecs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string|null>(null)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('recommendations').select('*, campaigns(name)').eq('user_id', user.id).order('created_at', { ascending: false })
      setRecs(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const approve = async (id: string) => {
    setApproving(id)
    await supabase.from('recommendations').update({ status: 'APPROVED', executed_at: new Date().toISOString() }).eq('id', id)
    setRecs(r => r.map(x => x.id === id ? {...x, status: 'APPROVED'} : x))
    setApproving(null)
  }

  const reject = async (id: string) => {
    await supabase.from('recommendations').update({ status: 'REJECTED' }).eq('id', id)
    setRecs(r => r.map(x => x.id === id ? {...x, status: 'REJECTED'} : x))
  }

  const typeColor: Record<string,string> = { PAUSE: 'var(--red)', SCALE: 'var(--green)', TEST_CREATIVE: 'var(--blue)', BUDGET_REALLOCATION: 'var(--amber)' }

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'white'}}>Recommendations</h1>
        <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>AI-generated actions for your Meta account. Approve to execute instantly.</p>
      </div>
      {loading ? (
        <div style={{padding:48,textAlign:'center',color:'rgba(255,255,255,0.4)'}}>Loading…</div>
      ) : !recs.length ? (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>🎯</div>
          <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No recommendations yet</div>
          <div style={{fontSize:14,color:'rgba(255,255,255,0.4)'}}>Sync your Meta account to generate AI recommendations.</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {recs.map(rec => (
            <div key={rec.id} style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:16,padding:22}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                    <span style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'.08em',padding:'3px 9px',borderRadius:100,background:rec.type==='PAUSE'?'rgba(248,113,113,0.1)':rec.type==='SCALE'?'rgba(134,239,172,0.1)':'rgba(147,197,253,0.1)',color:typeColor[rec.type]||'white',border:`1px solid ${typeColor[rec.type]||'white'}22`}}>{rec.type?.replace('_',' ')}</span>
                    <span style={{fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.4)'}}>Confidence: {rec.confidence_score}%</span>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:rec.status==='PENDING'?'rgba(251,191,36,0.1)':rec.status==='APPROVED'?'rgba(134,239,172,0.1)':'rgba(248,113,113,0.1)',color:rec.status==='PENDING'?'#fbbf24':rec.status==='APPROVED'?'#86efac':'#f87171'}}>{rec.status}</span>
                  </div>
                  <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:8}}>{rec.title}</div>
                  <div style={{background:'#1c3533',borderLeft:'3px solid #dffe95',borderRadius:'0 8px 8px 0',padding:'10px 14px',fontSize:13,color:'rgba(255,255,255,0.7)',lineHeight:1.65,marginBottom:8}}>
                    <strong style={{color:'white'}}>Why:</strong> {rec.reasoning}
                  </div>
                  {rec.impact_estimate && <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Impact: <strong style={{color:'#dffe95'}}>{rec.impact_estimate}</strong></div>}
                </div>
                {rec.status === 'PENDING' && (
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    <button onClick={() => approve(rec.id)} disabled={approving===rec.id} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'8px 16px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:approving===rec.id?.6:1}}>
                      {approving===rec.id?'Executing…':'✓ Approve'}
                    </button>
                    <button onClick={() => reject(rec.id)} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)',padding:'8px 14px',borderRadius:100,fontSize:13,fontFamily:'inherit',cursor:'pointer'}}>✕</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
