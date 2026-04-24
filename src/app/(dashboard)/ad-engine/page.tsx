'use client'
import { useState } from 'react'

const STEPS = ['Campaign Goal','Target Audience','Budget & Schedule','Ad Creative','Review & Launch']

export default function AdEnginePage() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    objective: '', audience: '', budget: '', startDate: '', endDate: '',
    headline: '', primaryText: '', cta: 'LEARN_MORE', landingUrl: ''
  })
  const [launching, setLaunching] = useState(false)
  const [launched, setLaunched] = useState(false)

  const set = (k: string, v: string) => setForm(p => ({...p, [k]: v}))

  const launch = async () => {
    setLaunching(true)
    await new Promise(r => setTimeout(r, 2000))
    setLaunched(true)
    setLaunching(false)
  }

  if (launched) return (
    <div style={{padding:28,display:'flex',alignItems:'center',justifyContent:'center',minHeight:'60vh'}}>
      <div style={{textAlign:'center',maxWidth:440}}>
        <div style={{fontSize:56,marginBottom:16}}>🚀</div>
        <h2 style={{fontSize:26,fontWeight:900,color:'white',marginBottom:10}}>Campaign Launched!</h2>
        <p style={{fontSize:15,color:'rgba(255,255,255,0.5)',marginBottom:24}}>Your campaign is live on Meta. Check your dashboard for performance data.</p>
        <button onClick={() => {setLaunched(false);setStep(0)}} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'12px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Launch Another →</button>
      </div>
    </div>
  )

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'white'}}>Ad Engine</h1>
        <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Create and launch Meta campaigns without opening Ads Manager.</p>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:24}}>
        {STEPS.map((s,i) => (
          <div key={s} onClick={() => i < step && setStep(i)} style={{flex:1,padding:'10px 12px',borderRadius:10,background:i===step?'rgba(223,254,149,0.1)':i<step?'rgba(223,254,149,0.05)':'#152928',border:`1px solid ${i===step?'rgba(223,254,149,0.3)':i<step?'rgba(223,254,149,0.15)':'rgba(255,255,255,0.06)'}`,cursor:i<step?'pointer':'default',textAlign:'center'}}>
            <div style={{fontSize:10,fontWeight:800,color:i<=step?'#dffe95':'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{i<step?'✓ ':''}{s}</div>
          </div>
        ))}
      </div>

      <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,padding:28}}>
        {step===0 && <>
          <h3 style={{fontSize:18,fontWeight:800,color:'white',marginBottom:20}}>What's your campaign goal?</h3>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            {[{id:'OUTCOME_SALES',icon:'🛒',title:'Sales / Conversions',desc:'Drive purchases on your website'},
              {id:'OUTCOME_LEADS',icon:'🎯',title:'Lead Generation',desc:'Collect leads via forms'},
              {id:'OUTCOME_TRAFFIC',icon:'🌐',title:'Traffic',desc:'Send people to your website'},
              {id:'OUTCOME_AWARENESS',icon:'📢',title:'Brand Awareness',desc:'Reach a broad audience'}].map(o => (
              <div key={o.id} onClick={() => set('objective', o.id)} style={{padding:20,borderRadius:14,border:`2px solid ${form.objective===o.id?'#dffe95':'rgba(255,255,255,0.08)'}`,background:form.objective===o.id?'rgba(223,254,149,0.06)':'transparent',cursor:'pointer',transition:'all .2s'}}>
                <div style={{fontSize:28,marginBottom:10}}>{o.icon}</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:4}}>{o.title}</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{o.desc}</div>
              </div>
            ))}
          </div>
        </>}

        {step===1 && <>
          <h3 style={{fontSize:18,fontWeight:800,color:'white',marginBottom:20}}>Who are you targeting?</h3>
          <div style={{marginBottom:16}}><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Describe your target audience</label>
          <textarea value={form.audience} onChange={e=>set('audience',e.target.value)} placeholder="e.g. Women aged 25-45 interested in fitness and wellness, located in United States..." style={{width:'100%',padding:'12px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none',resize:'vertical',minHeight:120,lineHeight:1.6}}/></div>
        </>}

        {step===2 && <>
          <h3 style={{fontSize:18,fontWeight:800,color:'white',marginBottom:20}}>Budget & Schedule</h3>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
            <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Daily Budget ($)</label>
            <input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} placeholder="50" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
            <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Start Date</label>
            <input type="date" value={form.startDate} onChange={e=>set('startDate',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
            <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>End Date (optional)</label>
            <input type="date" value={form.endDate} onChange={e=>set('endDate',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
          </div>
        </>}

        {step===3 && <>
          <h3 style={{fontSize:18,fontWeight:800,color:'white',marginBottom:20}}>Ad Creative</h3>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Headline</label>
            <input value={form.headline} onChange={e=>set('headline',e.target.value)} placeholder="Stop Losing Money on Bad Ads" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
            <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Primary Text</label>
            <textarea value={form.primaryText} onChange={e=>set('primaryText',e.target.value)} placeholder="Your ad copy here..." style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none',resize:'vertical',minHeight:100}}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Call to Action</label>
              <select value={form.cta} onChange={e=>set('cta',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#152928',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}>
                {['LEARN_MORE','SHOP_NOW','SIGN_UP','GET_QUOTE','CONTACT_US','DOWNLOAD'].map(c=><option key={c} value={c}>{c.replace('_',' ')}</option>)}
              </select></div>
              <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Landing URL</label>
              <input value={form.landingUrl} onChange={e=>set('landingUrl',e.target.value)} placeholder="https://yoursite.com" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
            </div>
          </div>
        </>}

        {step===4 && <>
          <h3 style={{fontSize:18,fontWeight:800,color:'white',marginBottom:20}}>Review & Launch</h3>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:24}}>
            {[['Objective',form.objective?.replace('OUTCOME_','')],['Daily Budget','$'+form.budget],['Headline',form.headline],['CTA',form.cta?.replace('_',' ')],['Landing URL',form.landingUrl],['Start Date',form.startDate]].map(([k,v]) => (
              <div key={k} style={{background:'#1c3533',borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:3,textTransform:'uppercase',letterSpacing:'.06em'}}>{k}</div>
                <div style={{fontSize:13,color:'white',fontWeight:600}}>{v||'—'}</div>
              </div>
            ))}
          </div>
          <div style={{background:'rgba(223,254,149,0.06)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'14px 18px',marginBottom:20,fontSize:13,color:'rgba(255,255,255,0.6)'}}>
            ✓ Campaign will be created in PAUSED state, then activated. You can pause it anytime from your dashboard.
          </div>
          <button onClick={launch} disabled={launching} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'14px 36px',borderRadius:100,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:launching?'not-allowed':'pointer',opacity:launching?.7:1}}>
            {launching?'Launching on Meta…':'🚀 Launch Campaign'}
          </button>
        </>}

        <div style={{display:'flex',justifyContent:'space-between',marginTop:28,paddingTop:20,borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          {step>0 ? <button onClick={()=>setStep(s=>s-1)} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button> : <div/>}
          {step<4 && <button onClick={()=>setStep(s=>s+1)} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Next →</button>}
        </div>
      </div>
    </div>
  )
}
