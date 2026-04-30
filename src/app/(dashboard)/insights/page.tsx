'use client'
import React, { useState, useEffect } from 'react'

interface CampaignInsight {
  id: string; name: string; status: string; objective: string
  spend: number; revenue: number; roas: number; conversions: number
  ctr: number; cpc: number; cpa: number; currency: string
  recommendation: string; rec_type: string; budget: number
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<CampaignInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string|null>(null)
  const [scaleModal, setScaleModal] = useState<CampaignInsight|null>(null)
  const [scaleFactor, setScaleFactor] = useState('2')
  const [isBudgetIncrease, setIsBudgetIncrease] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [totals, setTotals] = useState({spend:0,revenue:0,roas:0,conversions:0})
  const [dateRange, setDateRange] = useState('last_7d')

  useEffect(() => { loadInsights() }, [dateRange])

  const loadInsights = async () => {
    setLoading(true)
    try {
      const url = '/api/insights/campaigns?dateRange=' + dateRange
      const res = await fetch(url)
      const data = await res.json()
      setInsights(data.campaigns || [])
      setAccountName(data.account || '')
      setTotals(data.totals || {spend:0,revenue:0,roas:0,conversions:0})
    } catch {}
    setLoading(false)
  }

  const takeAction = async (campaign: CampaignInsight, action: string) => {
    if (action === 'scale') { setScaleModal(campaign); setScaleFactor('2'); setIsBudgetIncrease(false); return }
    setActing(campaign.id)
    try {
      if (action === 'pause') {
        await fetch('/api/insights/action', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({campaignId: campaign.id, action: 'pause'})})
        alert('Campaign paused successfully.')
      } else if (action === 'hold') {
        alert('Noted. Check back in 3-7 days once the campaign has more data.')
      }
      await loadInsights()
    } catch(e: any) { alert('Error: ' + e.message) }
    setActing(null)
  }

  const executeScale = async () => {
    if (!scaleModal) return
    setActing(scaleModal.id)
    setScaleModal(null)
    try {
      const res = await fetch('/api/m4/scale', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          campaignName: scaleModal.name,
          budgetMultiplier: parseFloat(scaleFactor),
          isBudgetIncrease,
          product: '', description: '', competitorDomains: ''
        })
      })
      const data = await res.json()
      if (data.error) alert('Scale failed: ' + data.error)
      else alert('Scaled successfully!\n\nDuplicate campaign created with ' + scaleFactor + 'x budget.\n' + (data.new_interests||0) + ' new interests added to original.\n\nCheck Meta Ads Manager to activate.')
      await loadInsights()
    } catch(e: any) { alert('Error: ' + e.message) }
    setActing(null)
  }

  const recColor: Record<string,string> = {scale:'#86efac', hold:'#fbbf24', pause:'#f87171', retarget:'#93c5fd'}
  const recLabel: Record<string,string> = {scale:'Scale Winner', hold:'Hold & Monitor', pause:'Pause — Poor ROI', retarget:'Build Retargeting'}
  const recEmoji: Record<string,string> = {scale:'🚀', hold:'⏳', pause:'⏸', retarget:'🔁'}

  const fmt = (n: number, cur = 'PKR') => {
    try { return new Intl.NumberFormat('en', {style:'currency', currency:cur, maximumFractionDigits:0}).format(n) }
    catch { return cur + ' ' + Math.round(n) }
  }

  const card = {background:'#152928', border:'1px solid rgba(223,254,149,0.13)', borderRadius:20, overflow:'hidden'} as React.CSSProperties

  return (
    <div style={{padding:28, maxWidth:1100, margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:16}}>
        <div>
          <h1 style={{fontSize:24, fontWeight:900, color:'white', marginBottom:4}}>Scale & Insights</h1>
          <p style={{fontSize:13, color:'rgba(255,255,255,0.4)'}}>{accountName} — Your daily action center.</p>
        </div>
        <div style={{display:'flex', gap:8}}>
          {['last_3d','last_7d','last_14d','last_30d'].map(d => (
            <button key={d} onClick={() => setDateRange(d)} style={{
              background: dateRange===d ? 'rgba(223,254,149,0.15)' : 'rgba(255,255,255,0.04)',
              border: dateRange===d ? '1px solid rgba(223,254,149,0.3)' : '1px solid rgba(255,255,255,0.08)',
              color: dateRange===d ? '#dffe95' : 'rgba(255,255,255,0.4)',
              padding:'7px 14px', borderRadius:100, fontSize:12, fontWeight:700, fontFamily:'inherit', cursor:'pointer'
            }}>{d.replace('last_','').replace('d',' days')}</button>
          ))}
          <button onClick={loadInsights} style={{background:'none', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', padding:'7px 14px', borderRadius:100, fontSize:12, fontFamily:'inherit', cursor:'pointer'}}>Refresh</button>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:28}}>
        {[
          {label:'Total Spend', value: fmt(totals.spend, insights[0]?.currency), color:'#f87171'},
          {label:'Total Revenue', value: fmt(totals.revenue, insights[0]?.currency), color:'#86efac'},
          {label:'Blended ROAS', value: totals.roas.toFixed(2) + 'x', color: totals.roas>=2?'#86efac':totals.roas>=1?'#fbbf24':'#f87171'},
          {label:'Conversions', value: String(totals.conversions), color:'#93c5fd'},
        ].map(k => (
          <div key={k.label} style={{background:'#152928', border:'1px solid rgba(255,255,255,0.06)', borderRadius:16, padding:20}}>
            <div style={{fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26, fontWeight:900, color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{...card, padding:48, textAlign:'center'}}>
          <img src='/favicon.png' alt='' style={{width:44, height:44, borderRadius:11, animation:'spin 1s linear infinite', margin:'0 auto 16px', display:'block'}}/>
          <div style={{fontSize:15, color:'white', fontWeight:700}}>Loading campaign data...</div>
        </div>
      ) : insights.length === 0 ? (
        <div style={{...card, padding:48, textAlign:'center'}}>
          <div style={{fontSize:32, marginBottom:12}}>📊</div>
          <div style={{fontSize:16, fontWeight:700, color:'white', marginBottom:8}}>No campaign data yet</div>
          <div style={{fontSize:13, color:'rgba(255,255,255,0.4)', marginBottom:20}}>Launch your first M4 campaign, let it run for a few days, then come back here.</div>
          <a href='/m4' style={{background:'#dffe95', color:'#10211f', padding:'11px 24px', borderRadius:100, fontSize:14, fontWeight:800, textDecoration:'none', display:'inline-block'}}>Launch M4 Campaign</a>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          {insights.map(campaign => {
            const rc = recColor[campaign.rec_type] || '#fbbf24'
            const isActing = acting === campaign.id
            return (
              <div key={campaign.id} style={{background:'#152928', border:'1px solid ' + rc + '22', borderRadius:20, overflow:'hidden'}}>
                <div style={{padding:'16px 24px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
                  <div style={{display:'flex', alignItems:'center', gap:12}}>
                    <div style={{width:8, height:8, borderRadius:'50%', background: campaign.status==='ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.2)'}}/>
                    <div>
                      <div style={{fontSize:14, fontWeight:700, color:'white'}}>{campaign.name}</div>
                      <div style={{fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:2}}>{campaign.status} · {campaign.objective?.replace('OUTCOME_','')}</div>
                    </div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <div style={{background: rc + '15', border:'1px solid ' + rc + '30', borderRadius:100, padding:'5px 14px', fontSize:12, fontWeight:700, color:rc}}>
                      {recEmoji[campaign.rec_type]} {recLabel[campaign.rec_type]}
                    </div>
                    {campaign.rec_type === 'scale' && (
                      <button onClick={() => takeAction(campaign, 'scale')} disabled={!!isActing} style={{background:'#86efac', color:'#10211f', border:'none', padding:'8px 18px', borderRadius:100, fontSize:13, fontWeight:800, fontFamily:'inherit', cursor:'pointer', opacity:isActing?0.7:1}}>
                        {isActing ? 'Scaling...' : 'Scale Now'}
                      </button>
                    )}
                    {campaign.rec_type === 'pause' && (
                      <button onClick={() => takeAction(campaign, 'pause')} disabled={!!isActing} style={{background:'rgba(248,113,113,0.15)', border:'1px solid rgba(248,113,113,0.3)', color:'#f87171', padding:'8px 18px', borderRadius:100, fontSize:13, fontWeight:800, fontFamily:'inherit', cursor:'pointer', opacity:isActing?0.7:1}}>
                        {isActing ? 'Pausing...' : 'Pause Campaign'}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{padding:20, display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:12}}>
                  {[
                    {label:'Spend', value: fmt(campaign.spend, campaign.currency)},
                    {label:'Revenue', value: fmt(campaign.revenue, campaign.currency)},
                    {label:'ROAS', value: campaign.roas.toFixed(2) + 'x', color: campaign.roas>=2?'#86efac':campaign.roas>=1?'#fbbf24':'#f87171'},
                    {label:'Conversions', value: String(campaign.conversions)},
                    {label:'CTR', value: campaign.ctr.toFixed(2) + '%'},
                    {label:'CPC', value: fmt(campaign.cpc, campaign.currency)},
                    {label:'CPA', value: fmt(campaign.cpa, campaign.currency)},
                  ].map(m => (
                    <div key={m.label} style={{textAlign:'center'}}>
                      <div style={{fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6}}>{m.label}</div>
                      <div style={{fontSize:16, fontWeight:800, color: m.color || 'white'}}>{m.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:'0 20px 16px', display:'flex', alignItems:'flex-start', gap:10}}>
                  <div style={{width:3, minHeight:40, background:rc, borderRadius:100, flexShrink:0, marginTop:2}}/>
                  <div style={{fontSize:13, color:'rgba(255,255,255,0.6)', lineHeight:1.7}}>{campaign.recommendation}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {/* Scale Modal */}
      {scaleModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:24}}>
          <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.2)',borderRadius:20,padding:32,maxWidth:500,width:'100%'}}>
            <div style={{fontSize:18,fontWeight:900,color:'white',marginBottom:6}}>Scale This Winner</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:24,lineHeight:1.7}}>
              <strong style={{color:'#dffe95'}}>{scaleModal.name}</strong> is performing above your account average. Here is what will happen:
            </div>

            <div style={{background:'rgba(134,239,172,0.06)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:12,padding:16,marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:700,color:'#86efac',marginBottom:10,textTransform:'uppercase',letterSpacing:'.06em'}}>What Scale Does</div>
              <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13,color:'rgba(255,255,255,0.7)'}}>
                <div>✅ <strong style={{color:'white'}}>Duplicate this campaign</strong> — exact copy with increased budget</div>
                <div>✅ <strong style={{color:'white'}}>Add new interests</strong> — Selfmade finds 6 fresh audiences for the original</div>
                <div>✅ <strong style={{color:'white'}}>Duplicate goes ACTIVE</strong> — original keeps running, no learning reset</div>
              </div>
            </div>

            {!isBudgetIncrease ? (
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:10,textTransform:'uppercase',letterSpacing:'.06em'}}>Budget Multiplier for Duplicate</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:10}}>
                  {['1.5','2','3','5'].map(x=>(
                    <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:`2px solid ${scaleFactor===x?'#dffe95':'rgba(255,255,255,0.1)'}`,background:scaleFactor===x?'rgba(223,254,149,0.1)':'rgba(255,255,255,0.02)',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#dffe95':'rgba(255,255,255,0.5)'}}>
                      {x}x
                    </div>
                  ))}
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>
                  Current budget: {fmt(scaleModal.budget, scaleModal.currency)}/day → Duplicate gets: {fmt(scaleModal.budget * parseFloat(scaleFactor||'2'), scaleModal.currency)}/day
                </div>
              </div>
            ) : (
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Budget Increase %</label>
                <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:12,marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginBottom:4}}>Max 15% — Protects Learning Phase</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>This increases budget on your EXISTING campaign. Meta resets learning if you go above 20% at once. Stay under 15% to keep conversions stable.</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                  {['5','10','15'].map(x=>(
                    <div key={x} onClick={()=>setScaleFactor(x)} style={{padding:'10px 0',textAlign:'center',borderRadius:10,border:`2px solid ${scaleFactor===x?'#fbbf24':'rgba(255,255,255,0.1)'}`,background:scaleFactor===x?'rgba(251,191,36,0.1)':'rgba(255,255,255,0.02)',cursor:'pointer',fontSize:15,fontWeight:800,color:scaleFactor===x?'#fbbf24':'rgba(255,255,255,0.5)'}}>
                      +{x}%
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:10,marginBottom:20}}>
              <button onClick={()=>setIsBudgetIncrease(false)} style={{flex:1,padding:'8px 0',borderRadius:10,border:`2px solid ${!isBudgetIncrease?'#dffe95':'rgba(255,255,255,0.1)'}`,background:!isBudgetIncrease?'rgba(223,254,149,0.1)':'transparent',color:!isBudgetIncrease?'#dffe95':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                Duplicate + Scale
              </button>
              <button onClick={()=>{setIsBudgetIncrease(true);setScaleFactor('10')}} style={{flex:1,padding:'8px 0',borderRadius:10,border:`2px solid ${isBudgetIncrease?'#fbbf24':'rgba(255,255,255,0.1)'}`,background:isBudgetIncrease?'rgba(251,191,36,0.1)':'transparent',color:isBudgetIncrease?'#fbbf24':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                Increase Budget Only
              </button>
            </div>
            {isBudgetIncrease && <div style={{background:'rgba(251,191,36,0.06)',border:'1px solid rgba(251,191,36,0.15)',borderRadius:10,padding:10,marginBottom:12,fontSize:12,color:'rgba(255,255,255,0.5)'}}>Use this only on campaigns that have <strong style={{color:'#fbbf24'}}>already been running</strong>. Duplicating first is usually better.</div>}

            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setScaleModal(null)} style={{flex:1,background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'11px 0',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>Cancel</button>
              <button onClick={executeScale} style={{flex:2,background:'#dffe95',color:'#10211f',border:'none',padding:'11px 0',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
                {isBudgetIncrease ? `Increase Budget +${scaleFactor}%` : `Scale ${scaleFactor}x — Duplicate Now`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
