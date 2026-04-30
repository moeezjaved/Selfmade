'use client'
import React, { useState, useEffect } from 'react'

interface AdsetInsight {
  id: string; name: string; status: string
  spend: number; revenue: number; roas: number; conversions: number
  ctr: number; cpc: number; cpa: number; clicks: number; impressions: number
  currency: string; rec_type: string; recommendation: string; budget: number
}

interface CampaignInsight {
  id: string; name: string; status: string; objective: string
  currency: string; budget: number; adsets: AdsetInsight[]
}

export default function InsightsPage() {
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string|null>(null)
  const [accountName, setAccountName] = useState('')
  const [totals, setTotals] = useState({spend:0,revenue:0,roas:0,conversions:0})
  const [accountROAS, setAccountROAS] = useState(0)
  const [dateRange, setDateRange] = useState('last_7d')
  const [scaleModal, setScaleModal] = useState<{campaign: CampaignInsight, adset: AdsetInsight}|null>(null)
  const [scaleFactor, setScaleFactor] = useState('2')
  const [isBudgetIncrease, setIsBudgetIncrease] = useState(false)
  const [suggestedInterests, setSuggestedInterests] = useState<{name:string,why:string,selected:boolean}[]>([])
  const [loadingInterests, setLoadingInterests] = useState(false)
  const [expanded, setExpanded] = useState<Record<string,boolean>>({})

  useEffect(() => { loadInsights() }, [dateRange])

  const loadInsights = async () => {
    setLoading(true)
    try {
      const url = '/api/insights/campaigns?dateRange=' + dateRange
      const res = await fetch(url)
      const data = await res.json()
      setCampaigns(data.campaigns || [])
      setAccountName(data.account || '')
      setTotals(data.totals || {spend:0,revenue:0,roas:0,conversions:0})
      setAccountROAS(data.accountROAS || 0)
      // Auto-expand ALL campaigns
      const exp: Record<string,boolean> = {}
      ;(data.campaigns || []).forEach((c: CampaignInsight) => { exp[c.id] = true })
      setExpanded(exp)
    } catch {}
    setLoading(false)
  }

  const executeScale = async () => {
    if (!scaleModal) return
    const { campaign, adset } = scaleModal
    setActing(adset.id)
    setScaleModal(null)
    try {
      const res = await fetch('/api/m4/scale', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          campaignName: campaign.name,
          adsetId: adset.id,
          adsetName: adset.name,
          budgetMultiplier: parseFloat(scaleFactor),
          isBudgetIncrease,
          product: '', description: '', competitorDomains: '',
          selectedInterests: suggestedInterests.filter(i=>i.selected).map(i=>i.name)
        })
      })
      const data = await res.json()
      if (data.error) alert('Scale failed: ' + data.error)
      else {
        if (isBudgetIncrease) alert('Budget increased by ' + scaleFactor + '% on ' + adset.name)
        else alert('Scaled! Duplicate ad set created with ' + scaleFactor + 'x budget.\n\nCheck Meta Ads Manager to activate.')
      }
      await loadInsights()
    } catch(e: any) { alert('Error: ' + e.message) }
    setActing(null)
  }

  const pauseAdset = async (adsetId: string) => {
    setActing(adsetId)
    try {
      await fetch('/api/insights/action', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({campaignId: adsetId, action: 'pause'})})
      alert('Ad set paused.')
      await loadInsights()
    } catch {}
    setActing(null)
  }

  const recColor: Record<string,string> = {scale:'#86efac', hold:'#fbbf24', pause:'#f87171', retarget:'#93c5fd'}
  const recLabel: Record<string,string> = {scale:'Scale Winner', hold:'Hold & Monitor', pause:'Pause', retarget:'Build Retargeting'}
  const recEmoji: Record<string,string> = {scale:'🚀', hold:'⏳', pause:'⏸', retarget:'🔁'}

  const fmt = (n: number, cur = 'PKR') => {
    try { return new Intl.NumberFormat('en', {style:'currency', currency:cur, maximumFractionDigits:0}).format(n) }
    catch { return cur + ' ' + Math.round(n) }
  }

  return (
    <div style={{padding:28, maxWidth:1100, margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:16}}>
        <div>
          <h1 style={{fontSize:24, fontWeight:900, color:'white', marginBottom:4}}>Scale & Insights</h1>
          <p style={{fontSize:13, color:'rgba(255,255,255,0.4)'}}>{accountName} — Daily action center. Scale winners, pause losers.</p>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {['last_3d','last_7d','last_14d','last_30d'].map(d => (
            <button key={d} onClick={() => setDateRange(d)} style={{background:dateRange===d?'rgba(223,254,149,0.15)':'rgba(255,255,255,0.04)',border:dateRange===d?'1px solid rgba(223,254,149,0.3)':'1px solid rgba(255,255,255,0.08)',color:dateRange===d?'#dffe95':'rgba(255,255,255,0.4)',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
              {d.replace('last_','').replace('d',' days')}
            </button>
          ))}
          <button onClick={loadInsights} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'7px 14px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Refresh</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:28}}>
        {[
          {label:'Total Spend', value:fmt(totals.spend, campaigns[0]?.currency), color:'#f87171'},
          {label:'Total Revenue', value:fmt(totals.revenue, campaigns[0]?.currency), color:'#86efac'},
          {label:'Blended ROAS', value:totals.roas.toFixed(2)+'x', color:totals.roas>=2?'#86efac':totals.roas>=1?'#fbbf24':'#f87171'},
          {label:'Conversions', value:String(totals.conversions), color:'#93c5fd'},
        ].map(k => (
          <div key={k.label} style={{background:'#152928',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20}}>
            <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:900,color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,padding:48,textAlign:'center'}}>
          <img src='/favicon.png' alt='' style={{width:44,height:44,borderRadius:11,animation:'spin 1s linear infinite',margin:'0 auto 16px',display:'block'}}/>
          <div style={{fontSize:15,color:'white',fontWeight:700}}>Analyzing your campaigns...</div>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaign data yet</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Launch your first M4 campaign, let it run for a few days, then come back here.</div>
          <a href='/m4' style={{background:'#dffe95',color:'#10211f',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,textDecoration:'none',display:'inline-block'}}>Launch M4 Campaign</a>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {campaigns.map(campaign => (
            <div key={campaign.id} style={{background:'#152928',border:'1px solid rgba(255,255,255,0.08)',borderRadius:20,overflow:'hidden'}}>
              {/* Campaign Header */}
              <div onClick={()=>setExpanded(p=>({...p,[campaign.id]:!p[campaign.id]}))} style={{padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',borderBottom:expanded[campaign.id]?'1px solid rgba(255,255,255,0.06)':'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:campaign.status==='ACTIVE'?'#86efac':'rgba(255,255,255,0.2)',flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:'white'}}>{campaign.name}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>{campaign.status} · {campaign.objective?.replace('OUTCOME_','')} · {campaign.adsets.length} ad sets</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  {campaign.adsets.some(a=>a.rec_type==='scale') && (
                    <div style={{background:'rgba(134,239,172,0.15)',border:'1px solid rgba(134,239,172,0.3)',borderRadius:100,padding:'4px 12px',fontSize:11,fontWeight:700,color:'#86efac'}}>🚀 Has Winner</div>
                  )}
                  <div style={{fontSize:18,color:'rgba(255,255,255,0.3)'}}>{expanded[campaign.id]?'▲':'▼'}</div>
                </div>
              </div>

              {/* Ad Sets */}
              {expanded[campaign.id] && campaign.adsets.map(adset => {
                const rc = recColor[adset.rec_type] || '#fbbf24'
                const isActing = acting === adset.id
                return (
                  <div key={adset.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                    <div style={{padding:'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:adset.status==='ACTIVE'?'#86efac':'rgba(255,255,255,0.15)',flexShrink:0}}/>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:'white'}}>{adset.name}</div>
                          <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>{adset.status}</div>
                        </div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{background:rc+'15',border:'1px solid '+rc+'30',borderRadius:100,padding:'4px 12px',fontSize:11,fontWeight:700,color:rc}}>
                          {recEmoji[adset.rec_type]} {recLabel[adset.rec_type]}
                        </div>
                        {adset.rec_type==='scale' && (
                          <button onClick={()=>{setScaleModal({campaign,adset});setScaleFactor('2');setIsBudgetIncrease(false);setSuggestedInterests([]);setLoadingInterests(true);fetch('/api/m4/interests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:campaign.name.replace(/— M4.*|— Scale.*/g,'').trim(),description:'We need fresh Meta interest audiences for this campaign. Find competitors and relevant interests.',targetCustomer:'',competitorDomains:''})}).then(r=>r.json()).then(d=>setSuggestedInterests((d.interests||[]).slice(0,6).map((i:any)=>({name:i.name,why:i.why,selected:false})))).catch(()=>{}).finally(()=>setLoadingInterests(false))}} disabled={!!isActing} style={{background:'#86efac',color:'#10211f',border:'none',padding:'6px 16px',borderRadius:100,fontSize:12,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                            {isActing?'Scaling...':'Scale Now'}
                          </button>
                        )}
                        {adset.rec_type==='pause' && (
                          <button onClick={()=>pauseAdset(adset.id)} disabled={!!isActing} style={{background:'rgba(248,113,113,0.15)',border:'1px solid rgba(248,113,113,0.3)',color:'#f87171',padding:'6px 16px',borderRadius:100,fontSize:12,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                            {isActing?'Pausing...':'Pause'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{padding:'0 24px 14px',display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
                      {[
                        {label:'Spend', value:fmt(adset.spend,adset.currency)},
                        {label:'Revenue', value:fmt(adset.revenue,adset.currency)},
                        {label:'ROAS', value:adset.roas.toFixed(2)+'x', color:adset.roas>=2?'#86efac':adset.roas>=1?'#fbbf24':'#f87171'},
                        {label:'Conversions', value:String(adset.conversions)},
                        {label:'CTR', value:adset.ctr.toFixed(2)+'%'},
                        {label:'CPA', value:fmt(adset.cpa,adset.currency)},
                      ].map(m => (
                        <div key={m.label} style={{textAlign:'center',background:'rgba(255,255,255,0.02)',borderRadius:10,padding:'10px 6px'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{m.label}</div>
                          <div style={{fontSize:14,fontWeight:800,color:m.color||'white'}}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{padding:'0 24px 14px',display:'flex',gap:8,alignItems:'flex-start'}}>
                      <div style={{width:3,minHeight:32,background:rc,borderRadius:100,flexShrink:0,marginTop:2}}/>
                      <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',lineHeight:1.6}}>{adset.recommendation}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Scale Modal */}
      {scaleModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:24}}>
          <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.2)',borderRadius:20,padding:32,maxWidth:500,width:'100%'}}>
            <div style={{fontSize:18,fontWeight:900,color:'white',marginBottom:4}}>Scale This Winner</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:20,lineHeight:1.6}}>
              <strong style={{color:'#dffe95'}}>{scaleModal.adset.name}</strong> is beating your account average.
            </div>

            <div style={{background:'rgba(134,239,172,0.06)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:12,padding:16,marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:700,color:'#86efac',marginBottom:10,textTransform:'uppercase',letterSpacing:'.06em'}}>What Scale Does</div>
              <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13,color:'rgba(255,255,255,0.7)'}}>
                <div>✅ <strong style={{color:'white'}}>Duplicate this ad set</strong> — same creative + audience, higher budget</div>
                <div>✅ <strong style={{color:'white'}}>Duplicate goes ACTIVE</strong> — original gets new interest to test more audiences</div>
                <div>✅ <strong style={{color:'white'}}>Select 1 interest below</strong> — added to original campaign to test new audiences</div>
              </div>
            </div>

            {/* Show tabs: if already scaled show budget increase option too */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em'}}>Pick 1 Interest to Add to Original Campaign</div>
              {loadingInterests ? (
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',padding:8}}>Finding best audiences...</div>
              ) : suggestedInterests.length === 0 ? (
                <div style={{fontSize:12,color:'rgba(255,255,255,0.3)',padding:8}}>No suggestions available</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:200,overflowY:'auto'}}>
                  {suggestedInterests.map((interest,i) => (
                    <div key={i} onClick={()=>setSuggestedInterests(prev=>prev.map((x,j)=>({...x,selected:j===i&&!x.selected})))} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:10,border:'1.5px solid '+(interest.selected?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)'),background:interest.selected?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                      <div style={{width:16,height:16,borderRadius:4,border:'2px solid '+(interest.selected?'#dffe95':'rgba(255,255,255,0.2)'),background:interest.selected?'#dffe95':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#10211f',fontWeight:900}}>{interest.selected?'v':''}</div>
                      <div><div style={{fontSize:12,fontWeight:700,color:'white'}}>{interest.name}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{interest.why}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {scaleModal.adset.name.includes('Scale') || scaleModal.campaign.name.includes('Scale') ? (
              <div style={{display:'flex',gap:10,marginBottom:16}}>
                <button onClick={()=>{setIsBudgetIncrease(false);setScaleFactor('2')}} style={{flex:1,padding:'8px 0',borderRadius:10,border:'2px solid '+(!isBudgetIncrease?'#dffe95':'rgba(255,255,255,0.1)'),background:!isBudgetIncrease?'rgba(223,254,149,0.1)':'transparent',color:!isBudgetIncrease?'#dffe95':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                  Duplicate Again
                </button>
                <button onClick={()=>{setIsBudgetIncrease(true);setScaleFactor('10')}} style={{flex:1,padding:'8px 0',borderRadius:10,border:'2px solid '+(isBudgetIncrease?'#fbbf24':'rgba(255,255,255,0.1)'),background:isBudgetIncrease?'rgba(251,191,36,0.1)':'transparent',color:isBudgetIncrease?'#fbbf24':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                  Increase Budget Only
                </button>
              </div>
            ) : (
              <div style={{marginBottom:16,fontSize:12,color:'rgba(255,255,255,0.35)',textAlign:'center'}}>First time scaling — duplicate is recommended</div>
            )}

            {!isBudgetIncrease ? (
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:10,textTransform:'uppercase',letterSpacing:'.06em'}}>Budget Multiplier for Duplicate</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:10}}>
                  {['1.5','2','3','5'].map(x=>(
                    <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:'2px solid '+(scaleFactor===x?'#dffe95':'rgba(255,255,255,0.1)'),background:scaleFactor===x?'rgba(223,254,149,0.1)':'rgba(255,255,255,0.02)',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#dffe95':'rgba(255,255,255,0.5)'}}>
                      {x}x
                    </div>
                  ))}
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>
                  Current: {fmt(scaleModal.campaign.budget||scaleModal.adset.budget, scaleModal.adset.currency)}/day → Duplicate gets: {fmt((scaleModal.campaign.budget||scaleModal.adset.budget) * parseFloat(scaleFactor||'2'), scaleModal.adset.currency)}/day
                </div>
              </div>
            ) : (
              <div style={{marginBottom:20}}>
                <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:12,marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginBottom:4}}>⚠️ Max 15% — Protects Learning Phase</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Increasing budget on an existing ad set by more than 20% resets Meta learning. Stay under 15% to keep performance stable.</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                  {['5','10','15'].map(x=>(
                    <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:'2px solid '+(scaleFactor===x?'#fbbf24':'rgba(255,255,255,0.1)'),background:scaleFactor===x?'rgba(251,191,36,0.1)':'rgba(255,255,255,0.02)',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#fbbf24':'rgba(255,255,255,0.5)'}}>
                      +{x}%
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setScaleModal(null)} style={{flex:1,background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'11px 0',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>Cancel</button>
              <button onClick={executeScale} style={{flex:2,background:'#dffe95',color:'#10211f',border:'none',padding:'11px 0',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                {isBudgetIncrease ? 'Increase Budget +'+scaleFactor+'%' : 'Scale '+scaleFactor+'x — Duplicate Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
