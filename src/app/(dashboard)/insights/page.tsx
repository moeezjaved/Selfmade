'use client'
import MetaGate from '@/components/MetaGate'
import AdsTabs from '@/components/ads/AdsTabs'
import React, { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { useIsMobile } from '@/lib/useIsMobile'

interface AdsetInsight {
  id: string; name: string; status: string
  spend: number; revenue: number; roas: number; conversions: number
  ctr: number; cpc: number; cpa: number; clicks: number; impressions: number
  currency: string; rec_type: string; recommendation: string; budget: number
  top_thumbnail_url?: string | null; top_preview_url?: string | null
}

interface CampaignInsight {
  id: string; name: string; status: string; objective: string
  currency: string; budget: number; adsets: AdsetInsight[]
  launchData?: {product:string,description:string,target_customer:string,competitor_domains:string}|null
}

function InsightsPage() {
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [noAccount, setNoAccount] = useState(false)   // active brand has no Meta ad account linked
  const [acting, setActing] = useState<string|null>(null)
  const [accountName, setAccountName] = useState('')
  const [totals, setTotals] = useState({spend:0,revenue:0,roas:0,conversions:0})
  const [accountROAS, setAccountROAS] = useState(0)
  const [dateRange, setDateRange] = useState('last_7d')
  const [scaleModal, setScaleModal] = useState<{campaign: CampaignInsight, adset: AdsetInsight}|null>(null)
  const [scaleFactor, setScaleFactor] = useState('2')
  const [isBudgetIncrease, setIsBudgetIncrease] = useState(false)
  const [expanded, setExpanded] = useState<Record<string,boolean>>({})
  const isMobile = useIsMobile()
  // Collapse fixed N-column grids on phones: 1 col for wide (4/6-col) blocks, 2 for the 3-col.
  const grid = (n: number) => isMobile ? (n >= 4 ? 'repeat(2,1fr)' : '1fr') : `repeat(${n},1fr)`

  useEffect(() => { loadInsights() }, [dateRange])
  // Follow the top ProjectSwitcher: re-fetch when the active brand changes so the insights re-resolve
  // to the NEW brand's linked account (the route is brand-scoped server-side via sf_brand).
  useEffect(() => {
    const onBrand = () => loadInsights()
    window.addEventListener('sf:brandchange', onBrand)
    return () => window.removeEventListener('sf:brandchange', onBrand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange])

  const loadInsights = async () => {
    setLoading(true)
    try {
      const url = '/api/insights/campaigns?dateRange=' + dateRange
      const res = await fetch(url)
      const data = await res.json()
      setNoAccount(!!data.noAccountForBrand)
      setCampaigns(data.campaigns || [])
      setAccountName(data.account || '')
      setTotals(data.totals || {spend:0,revenue:0,roas:0,conversions:0})
      setAccountROAS(data.accountROAS || 0)
      // Auto-expand campaigns with scale recommendations
      const exp: Record<string,boolean> = {}
      ;(data.campaigns || []).forEach((c: CampaignInsight) => {
        exp[c.id] = true
      })
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
          campaignId: campaign.id,
          adsetId: adset.id,
          budgetMultiplier: parseFloat(scaleFactor),
          isBudgetIncrease,
          product: '', description: '', competitorDomains: ''
        })
      })
      const data = await res.json()
      if (data.error) toast.error('Scale failed: ' + data.error)
      else {
        if (isBudgetIncrease) toast.success('Budget increased by ' + scaleFactor + '% on ' + adset.name)
        else toast.success('Scaled! Duplicate ad set created with ' + scaleFactor + 'x budget. Check Meta Ads Manager to activate.')
      }
      await loadInsights()
    } catch(e: any) { toast.error('Error: ' + e.message) }
    setActing(null)
  }

  const pauseAdset = async (adsetId: string) => {
    setActing(adsetId)
    try {
      await fetch('/api/insights/action', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({campaignId: adsetId, action: 'pause'})})
      toast.success('Ad set paused.')
      await loadInsights()
    } catch {}
    setActing(null)
  }

  const recColor: Record<string,string> = {scale:'#ef4a1e', hold:'#b8860b', pause:'#c0392b', retarget:'#93c5fd'}
  const recLabel: Record<string,string> = {scale:'Scale Winner', hold:'Hold & Monitor', pause:'Pause', retarget:'Build Retargeting'}
  const recEmoji: Record<string,string> = {scale:'🚀', hold:'⏳', pause:'⏸', retarget:'🔁'}

  const fmt = (n: number, cur = 'PKR') => {
    try { return new Intl.NumberFormat('en', {style:'currency', currency:cur, maximumFractionDigits:0}).format(n) }
    catch { return cur + ' ' + Math.round(n) }
  }

  return (
    <div style={{padding:28, maxWidth:1100, margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <AdsTabs />

      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:16}}>
        <div>
          <h1 style={{fontSize:24, fontWeight:900, color:'#141d15', marginBottom:4}}>Scale & Insights</h1>
          <p style={{fontSize:13, color:'#7a9a7a'}}>{accountName} — Daily action center. Scale winners, pause losers.</p>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {['last_3d','last_7d','last_14d','last_30d'].map(d => (
            <button key={d} onClick={() => setDateRange(d)} style={{background:dateRange===d?'#ef4a1e':'#f4f0e6',border:dateRange===d?'1px solid #ef4a1e':'1px solid rgba(0,0,0,0.1)',color:dateRange===d?'#fff':'#6b6a58',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
              {d.replace('last_','').replace('d',' days')}
            </button>
          ))}
          <button onClick={loadInsights} style={{background:'none',border:'1px solid rgba(0,0,0,0.08)',color:'#7a9a7a',padding:'7px 14px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Refresh</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:grid(4), gap:14, marginBottom:28}}>
        {[
          {label:'Total Spend', value:fmt(totals.spend, campaigns[0]?.currency), color:'#c0392b'},
          {label:'Total Revenue', value:fmt(totals.revenue, campaigns[0]?.currency), color:'#ef4a1e'},
          {label:'Blended ROAS', value:totals.roas.toFixed(2)+'x', color:totals.roas>=2?'#ef4a1e':totals.roas>=1?'#b8860b':'#c0392b'},
          {label:'Conversions', value:String(totals.conversions), color:'#2563eb'},
        ].map(k => (
          <div key={k.label} style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.06)',borderRadius:16,padding:20}}>
            <div style={{fontSize:11,fontWeight:700,color:'#7a9a7a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:900,color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:20,padding:48,textAlign:'center'}}>
          <div className="selfmade-loading" style={{width:44,height:44,borderRadius:12,margin:'0 auto 16px'}}/>
          <div style={{fontSize:15,color:'#141d15',fontWeight:700}}>Analyzing your campaigns...</div>
        </div>
      ) : noAccount ? (
        <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:20,padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>🔗</div>
          <div style={{fontSize:16,fontWeight:700,color:'#141d15',marginBottom:8}}>No ad account linked to this brand yet</div>
          <div style={{fontSize:13,color:'#7a9a7a',marginBottom:20,maxWidth:420,margin:'0 auto 20px'}}>Link this brand&apos;s Facebook ad account and its campaigns show up here — nothing from your other brands.</div>
          <a href='/connect/meta' style={{background:'#ff5a2c',color:'#fff',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,textDecoration:'none',display:'inline-block'}}>Connect an ad account →</a>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:20,padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:16,fontWeight:700,color:'#141d15',marginBottom:8}}>No campaign data yet</div>
          <div style={{fontSize:13,color:'#7a9a7a',marginBottom:20}}>Launch your first M4 campaign, let it run for a few days, then come back here.</div>
          <a href='/m4' style={{background:'#ff5a2c',color:'#fff',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,textDecoration:'none',display:'inline-block'}}>Launch M4 Campaign</a>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {campaigns.map(campaign => (
            <div key={campaign.id} style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:20,overflow:'hidden'}}>
              {/* Campaign Header */}
              <div onClick={()=>setExpanded(p=>({...p,[campaign.id]:!p[campaign.id]}))} style={{padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',borderBottom:expanded[campaign.id]?'1px solid rgba(255,255,255,0.06)':'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:campaign.status==='ACTIVE'?'#ef4a1e':'rgba(255,255,255,0.2)',flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:'#141d15'}}>{campaign.name}</div>
                    <div style={{fontSize:11,color:'#8b8a72',marginTop:2}}>{campaign.status} · {campaign.objective?.replace('OUTCOME_','')} · {campaign.adsets.length} ad sets</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  {campaign.adsets.some(a=>a.rec_type==='scale') && (
                    <div style={{background:'rgba(239,74,30,0.12)',border:'1px solid rgba(239,74,30,0.25)',borderRadius:100,padding:'4px 12px',fontSize:11,fontWeight:700,color:'#ef4a1e'}}>🚀 Has Winner</div>
                  )}
                  <div style={{fontSize:18,color:'#8b8a72'}}>{expanded[campaign.id]?'▲':'▼'}</div>
                </div>
              </div>

              {/* Ad Sets */}
              {expanded[campaign.id] && campaign.adsets.map(adset => {
                const rc = recColor[adset.rec_type] || '#b8860b'
                const isActing = acting === adset.id
                return (
                  <div key={adset.id} style={{borderBottom:'1px solid rgba(0,0,0,0.04)'}}>
                    <div style={{padding:'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        {/* Top ad thumbnail */}
                        <div style={{width:44,height:44,borderRadius:8,overflow:'hidden',flexShrink:0,background:'#f4f0e6',border:'1px solid rgba(0,0,0,0.08)'}}>
                          {adset.top_thumbnail_url ? (
                            <img src={adset.top_thumbnail_url} alt={adset.name} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={(e:any)=>{e.target.style.display='none'}} />
                          ) : (
                            <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🎨</div>
                          )}
                        </div>
                        <div style={{width:6,height:6,borderRadius:'50%',background:adset.status==='ACTIVE'?'#ef4a1e':'rgba(255,255,255,0.15)',flexShrink:0}}/>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:'#141d15'}}>{adset.name}</div>
                          <div style={{fontSize:11,color:'#8b8a72',display:'flex',alignItems:'center',gap:8}}>
                            <span>{adset.status}</span>
                            {adset.top_preview_url && (
                              <a href={adset.top_preview_url} target="_blank" rel="noopener noreferrer"
                                style={{fontSize:11,fontWeight:700,color:'#fff',background:'#ff5a2c',padding:'2px 10px',borderRadius:100,textDecoration:'none'}}>
                                👁 View Ad
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{background:rc+'15',border:'1px solid '+rc+'30',borderRadius:100,padding:'4px 12px',fontSize:11,fontWeight:700,color:rc}}>
                          {recEmoji[adset.rec_type]} {recLabel[adset.rec_type]}
                        </div>
                        {adset.rec_type==='scale' && (
                          <button onClick={()=>{setScaleModal({campaign,adset});setScaleFactor('2');setIsBudgetIncrease(false)}} disabled={!!isActing} style={{background:'#ef4a1e',color:'#fff',border:'none',padding:'8px 20px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                            {isActing?'Scaling...':'Scale Now'}
                          </button>
                        )}
                        {adset.rec_type==='pause' && (
                          <button onClick={()=>pauseAdset(adset.id)} disabled={!!isActing} style={{background:'rgba(248,113,113,0.15)',border:'1px solid rgba(248,113,113,0.3)',color:'#c0392b',padding:'6px 16px',borderRadius:100,fontSize:12,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                            {isActing?'Pausing...':'Pause'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{padding:isMobile?'0 14px 14px':'0 24px 14px',display:'grid',gridTemplateColumns:grid(6),gap:10}}>
                      {[
                        {label:'Spend', value:fmt(adset.spend,adset.currency)},
                        {label:'Revenue', value:fmt(adset.revenue,adset.currency)},
                        {label:'ROAS', value:adset.roas.toFixed(2)+'x', color:adset.roas>=2?'#ef4a1e':adset.roas>=1?'#b8860b':'#c0392b'},
                        {label:'Conversions', value:String(adset.conversions)},
                        {label:'CTR', value:adset.ctr.toFixed(2)+'%'},
                        {label:'CPA', value:fmt(adset.cpa,adset.currency)},
                      ].map(m => (
                        <div key={m.label} style={{textAlign:'center',background:'#f9f5ec',borderRadius:10,padding:'10px 6px'}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#8b8a72',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{m.label}</div>
                          <div style={{fontSize:14,fontWeight:800,color:m.color||'#141d15'}}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{padding:'0 24px 14px',display:'flex',gap:8,alignItems:'flex-start'}}>
                      <div style={{width:3,minHeight:32,background:rc,borderRadius:100,flexShrink:0,marginTop:2}}/>
                      <div style={{fontSize:12,color:'#6f7d70',lineHeight:1.6}}>{adset.recommendation}</div>
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
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.1)',borderRadius:20,boxShadow:'0 20px 60px rgba(0,0,0,0.1)',width:'100%',maxWidth:520,display:'flex',flexDirection:'column',maxHeight:'92vh'}}>
            
            {/* Fixed Header */}
            <div style={{padding:'20px 24px 16px',borderBottom:'1px solid rgba(0,0,0,0.06)',flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:900,color:'#141d15',marginBottom:4}}>Scale This Winner</div>
              <div style={{fontSize:13,color:'#6f7d70'}}>
                <strong style={{color:'#141d15'}}>{scaleModal.adset.name}</strong> is beating your account average.
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{overflowY:'auto',flex:1,padding:'16px 24px'}}>
              
              {/* What Scale Does */}
              <div style={{background:'rgba(239,74,30,0.06)',border:'1px solid rgba(239,74,30,0.12)',borderRadius:12,padding:14,marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:'#ef4a1e',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em'}}>What Scale Does</div>
                <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:12,color:'#141d15'}}>
                  <div>✅ <strong style={{color:'#141d15'}}>Duplicate this ad set</strong> — same creative + audience, higher budget, goes ACTIVE</div>
                  <div>✅ <strong style={{color:'#141d15'}}>Original stays untouched</strong> — your control data keeps running</div>
                </div>
              </div>

              {/* First time vs already scaled */}
              {scaleModal && (scaleModal.adset.name.includes('Scale') || scaleModal.adset.name.includes('Duplic')) ? (
                <div style={{display:'flex',gap:8,marginBottom:16}}>
                  <button onClick={()=>{setIsBudgetIncrease(false);setScaleFactor('2')}} style={{flex:1,padding:'8px 0',borderRadius:10,border:'2px solid '+(!isBudgetIncrease?'#141d15':'#e2e8f0'),background:!isBudgetIncrease?'#ef4a1e':'#f8fafc',color:!isBudgetIncrease?'#fff':'#6b7280',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                    Duplicate Again
                  </button>
                  <button onClick={()=>{setIsBudgetIncrease(true);setScaleFactor('10')}} style={{flex:1,padding:'8px 0',borderRadius:10,border:'2px solid '+(isBudgetIncrease?'#b45309':'#e2e8f0'),background:isBudgetIncrease?'#fef3c7':'#f8fafc',color:isBudgetIncrease?'#92400e':'#6b7280',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                    Increase Budget (max 15%)
                  </button>
                </div>
              ) : (
                <div style={{marginBottom:16,padding:'10px 14px',background:'#fff7f3',border:'1px solid #f6d8cc',borderRadius:10,fontSize:12,color:'#9a3412'}}>
                  First time scaling — duplicate will go ACTIVE, original stays untouched.
                </div>
              )}

              {/* Budget Multiplier */}
              {!isBudgetIncrease ? (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#6f7d70',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em'}}>Budget Multiplier for Duplicate</div>
                  <div style={{display:'grid',gridTemplateColumns:grid(4),gap:8,marginBottom:8}}>
                    {['1.5','2','3','5'].map(x=>(
                      <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:'2px solid '+(scaleFactor===x?'#ef4a1e':'#e2e8f0'),background:scaleFactor===x?'#ef4a1e':'#f8fafc',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#fff':'#374151',transition:'all .12s'}}>
                        {x}x
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'#8b8a72'}}>
                    Current: {fmt(scaleModal.campaign.budget||scaleModal.adset.budget, scaleModal.adset.currency)}/day → Duplicate gets: {fmt((scaleModal.campaign.budget||scaleModal.adset.budget)*parseFloat(scaleFactor||'2'), scaleModal.adset.currency)}/day
                  </div>
                </div>
              ) : (
                <div style={{marginBottom:16}}>
                  <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:12,marginBottom:10}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#b8860b',marginBottom:4}}>Max 15% — Protects Learning Phase</div>
                    <div style={{fontSize:11,color:'#6f7d70'}}>Increasing by more than 20% resets Meta learning. Stay under 15%.</div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:grid(3),gap:8}}>
                    {['5','10','15'].map(x=>(
                      <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:'2px solid '+(scaleFactor===x?'#f59e0b':'#e2e8f0'),background:scaleFactor===x?'#fef3c7':'#f8fafc',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#92400e':'#6b7280',transition:'all .12s'}}>
                        +{x}%
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Fixed Footer */}
            <div style={{padding:'14px 24px',borderTop:'1px solid rgba(0,0,0,0.07)',display:'flex',gap:10,flexShrink:0,background:'#ffffff',borderRadius:'0 0 20px 20px'}}>
              <button onClick={()=>setScaleModal(null)} style={{flex:1,background:'none',border:'1.5px solid #e2e8f0',color:'#6b7280',padding:'11px 0',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>Cancel</button>
              <button onClick={executeScale} style={{flex:2,background:'#ef4a1e',color:'#fff',border:'none',padding:'11px 0',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                {isBudgetIncrease ? 'Increase Budget +'+scaleFactor+'%' : 'Scale '+scaleFactor+'x — Duplicate Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Gate: needs a connected Meta ad account. MetaGate keys off the connection (BYO or OAuth),
// not the old META_LIVE flag — connected users get the surface, everyone else a connect prompt. ──
export default function InsightsPageGate() {
  return <MetaGate feature="Scale & Insights"><InsightsPage /></MetaGate>
}
