'use client'
import { useState, useEffect } from 'react'

interface CampaignInsight {
  id: string
  name: string
  status: string
  objective: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  roas: number
  ctr: number
  cpc: number
  cpa: number
  currency: string
  recommendation: string
  rec_type: 'scale'|'hold'|'pause'|'retarget'
  budget: number
}

const S = {
  card: {background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'} as React.CSSProperties,
}

import React from 'react'

export default function InsightsPage() {
  const [insights, setInsights] = useState<CampaignInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string|null>(null)
  const [accountName, setAccountName] = useState('')
  const [totals, setTotals] = useState({spend:0,revenue:0,roas:0,conversions:0})
  const [dateRange, setDateRange] = useState('last_7d')

  useEffect(()=>{ loadInsights() },[dateRange])

  const loadInsights = async () => {
    setLoading(true)
    try {
      const res = await fetch(\`/api/insights/campaigns?dateRange=${dateRange}\`)
      const data = await res.json()
      setInsights(data.campaigns||[])
      setAccountName(data.account||'')
      setTotals(data.totals||{spend:0,revenue:0,roas:0,conversions:0})
    } catch {}
    setLoading(false)
  }

  const takeAction = async (campaign: CampaignInsight, action: string) => {
    setActing(campaign.id)
    try {
      await fetch('/api/insights/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId:campaign.id,campaignName:campaign.name,action})})
      await loadInsights()
    } catch {}
    setActing(null)
  }

  const recColor = {scale:'#86efac',hold:'#fbbf24',pause:'#f87171',retarget:'#93c5fd'}
  const recEmoji = {scale:'🚀',hold:'⏳',pause:'⏸',retarget:'🔁'}
  const recLabel = {scale:'Scale Winner',hold:'Hold & Monitor',pause:'Pause — Poor ROI',retarget:'Build Retargeting'}

  const fmt = (n:number,currency:string='PKR') => new Intl.NumberFormat('en',{style:'currency',currency,maximumFractionDigits:0}).format(n)
  const fmtNum = (n:number) => n>=1000?`${(n/1000).toFixed(1)}k`:String(Math.round(n))

  return (
    <div style={{padding:28,maxWidth:1100,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28,flexWrap:'wrap',gap:16}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:900,color:'white',marginBottom:4}}>Scale & Insights</h1>
          <p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>{accountName} — Your daily action center. Take action, not notes.</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {['last_3d','last_7d','last_14d','last_30d'].map(d=>(
            <button key={d} onClick={()=>setDateRange(d)} style={{background:dateRange===d?'rgba(223,254,149,0.15)`:'rgba(255,255,255,0.04)',border:`1px solid ${dateRange===d?'rgba(223,254,149,0.3)`:'rgba(255,255,255,0.08)'}`,color:dateRange===d?'#dffe95':'rgba(255,255,255,0.4)',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
              {d.replace('last_','').replace('d',' days')}
            </button>
          ))}
          <button onClick={loadInsights} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'7px 14px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>↻ Refresh</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:28}}>
        {[
          {label:'Total Spend',value:fmt(totals.spend,insights[0]?.currency||'PKR'),color:'#f87171'},
          {label:'Total Revenue',value:fmt(totals.revenue,insights[0]?.currency||'PKR'),color:'#86efac'},
          {label:'Blended ROAS',value:`${totals.roas.toFixed(2)}x`,color:totals.roas>=2?'#86efac':totals.roas>=1?'#fbbf24':'#f87171'},
          {label:'Conversions',value:String(totals.conversions),color:'#93c5fd'},
        ].map(k=>(
          <div key={k.label} style={{background:'#152928',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20}}>
            <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:900,color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Campaign Cards */}
      {loading ? (
        <div style={{...S.card,padding:48,textAlign:'center'}}>
          <img src='/favicon.png' alt='' style={{width:44,height:44,borderRadius:11,animation:'spin 1s linear infinite',margin:'0 auto 16px',display:'block'}}/>
          <div style={{fontSize:15,color:'white',fontWeight:700}}>Loading campaign data…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : insights.length===0 ? (
        <div style={{...S.card,padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaign data yet</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Launch your first M4 campaign, let it run for a few days, then come back here.</div>
          <a href="/m4" style={{background:'#dffe95',color:'#10211f',border:'none',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',textDecoration:'none',display:'inline-block'}}>Launch M4 Campaign</a>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {insights.map(campaign=>{
            const rc = recColor[campaign.rec_type]||'#fbbf24'
            const isActing = acting===campaign.id
            return (
              <div key={campaign.id} style={{background:'#152928',border:`1px solid ${rc}22`,borderRadius:20,overflow:'hidden'}}>
                {/* Campaign Header */}
                <div style={{padding:'16px 24px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:campaign.status==='ACTIVE'?'#86efac':'rgba(255,255,255,0.2)'}}/>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:'white'}}>{campaign.name}</div>
                      <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>{campaign.status} · {campaign.objective?.replace('OUTCOME_','')}</div>
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{background:`${rc}15`,border:`1px solid ${rc}30`,borderRadius:100,padding:'5px 14px',fontSize:12,fontWeight:700,color:rc}}>
                      {recEmoji[campaign.rec_type]} {recLabel[campaign.rec_type]}
                    </div>
                    {campaign.rec_type==='scale' && (
                      <button onClick={()=>takeAction(campaign,'scale')} disabled={isActing} style={{background:'#86efac',color:'#10211f',border:'none',padding:'8px 18px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:isActing?0.7:1}}>
                        {isActing?'Scaling…':'🚀 Scale Now'}
                      </button>
                    )}
                    {campaign.rec_type==='pause' && (
                      <button onClick={()=>takeAction(campaign,'pause')} disabled={isActing} style={{background:'rgba(248,113,113,0.15)',border:'1px solid rgba(248,113,113,0.3)',color:'#f87171',padding:'8px 18px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:isActing?0.7:1}}>
                        {isActing?'Pausing…':'⏸ Pause Campaign'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div style={{padding:20,display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:12}}>
                  {[
                    {label:'Spend',value:fmt(campaign.spend,campaign.currency),highlight:false},
                    {label:'Revenue',value:fmt(campaign.revenue,campaign.currency),highlight:false},
                    {label:'ROAS',value:`${campaign.roas.toFixed(2)}x`,highlight:true,good:campaign.roas>=2},
                    {label:'Conversions',value:String(campaign.conversions),highlight:false},
                    {label:'CTR',value:`${campaign.ctr.toFixed(2)}%`,highlight:false},
                    {label:'CPC',value:fmt(campaign.cpc,campaign.currency),highlight:false},
                    {label:'CPA',value:fmt(campaign.cpa,campaign.currency),highlight:false},
                  ].map(m=>(
                    <div key={m.label} style={{textAlign:'center'}}>
                      <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>{m.label}</div>
                      <div style={{fontSize:16,fontWeight:800,color:m.highlight?(m.good?'#86efac':'#f87171'):'white'}}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Recommendation */}
                <div style={{padding:'0 20px 16px',display:'flex',alignItems:'flex-start',gap:10}}>
                  <div style={{width:3,height:'100%',minHeight:40,background:rc,borderRadius:100,flexShrink:0,marginTop:2}}/>
                  <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',lineHeight:1.7}}>{campaign.recommendation}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
