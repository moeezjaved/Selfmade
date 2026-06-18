'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const STEPS = ['Business Type','Your Niche','Ad Spend','Primary Goal','Experience']

const BIZ = [
  {id:'ecommerce',icon:'🛒',title:'E-Commerce',desc:'Shopify, DTC, online store'},
  {id:'saas',icon:'💻',title:'SaaS / Software',desc:'Apps, tools, subscriptions'},
  {id:'leadgen',icon:'🎯',title:'Lead Generation',desc:'Real estate, finance, services'},
  {id:'service',icon:'🏢',title:'Service Business',desc:'Agency, coach, consultant'},
  {id:'solo',icon:'🧑‍💻',title:'Solo Entrepreneur',desc:'Building independently'},
  {id:'other',icon:'✨',title:'Other',desc:'Something else'},
]
const SPEND = [
  {id:'under1k',label:'Under $1,000',desc:'Just getting started'},
  {id:'1k-3k',label:'$1k – $3k',desc:'Building traction'},
  {id:'3k-10k',label:'$3k – $10k',desc:'Growing fast'},
  {id:'10k-30k',label:'$10k – $30k',desc:'Scaling seriously'},
  {id:'30k+',label:'$30k+',desc:'High volume'},
  {id:'planning',label:'Just planning',desc:"Haven't started yet"},
]
const GOALS = [
  {id:'scale',icon:'🚀',title:'Scale Revenue',desc:'Find winners and pour budget in'},
  {id:'cpa',icon:'💰',title:'Lower CPA / CPL',desc:'More results for less money'},
  {id:'waste',icon:'🛑',title:'Stop Budget Waste',desc:"Kill what's losing money"},
  {id:'roas',icon:'📈',title:'Improve ROAS',desc:'More revenue per ad dollar'},
  {id:'understand',icon:'🧠',title:'Understand My Ads',desc:"Learn what's working"},
  {id:'all',icon:'⚡',title:'All of the Above',desc:'Full optimisation'},
]
const EXP = [
  {id:'beginner',icon:'🌱',title:'Beginner',desc:'Still learning Meta ads'},
  {id:'intermediate',icon:'📊',title:'Intermediate',desc:'Running ads 1–2 years'},
  {id:'advanced',icon:'🏆',title:'Advanced',desc:'3+ years, know my metrics'},
  {id:'expert',icon:'🚀',title:'Expert',desc:'Full-time focus'},
]

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [answers, setAnswers] = useState({biz:'',niche:'',spend:'',goal:'',exp:''})

  const sel = (field: string, val: string) => setAnswers(p => ({...p,[field]:val}))

  const canNext = [
    !!answers.biz, !!answers.niche, !!answers.spend, !!answers.goal, !!answers.exp
  ][step]

  const finish = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    await supabase.from('user_profiles').update({
      business_type: answers.biz as any,
      niche: answers.niche,
      monthly_ad_spend: answers.spend,
      experience_level: answers.exp as any,
      onboarding_completed: true,
    }).eq('user_id', user.id)
    router.push('/payment')
  }

  const optStyle = (selected: boolean) => ({
    background: selected ? 'rgba(223,254,149,0.08)' : '#1c3533',
    border: `2px solid ${selected ? '#dffe95' : 'rgba(223,254,149,0.1)'}`,
    borderRadius: 14, padding: '18px 16px', cursor: 'pointer',
    transition: 'all .2s', position: 'relative' as const,
  })

  return (
    <div style={{minHeight:'100vh',background:'#10211f',display:'flex',flexDirection:'column'}}>
      {/* Header */}
      <div style={{background:'#152928',borderBottom:'1px solid rgba(223,254,149,0.13)',padding:'0 40px',height:64,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:22,fontWeight:900,color:'#dffe95',fontFamily:'Georgia,serif',fontStyle:'italic'}}>Selfmade</span>
        <div style={{display:'flex',gap:6}}>
          {STEPS.map((_,i) => (
            <div key={i} style={{height:8,borderRadius:100,background:i===step?'#dffe95':i<step?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)',width:i===step?24:8,transition:'all .3s'}}/>
          ))}
        </div>
        <span style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Step {step+1} of {STEPS.length}</span>
      </div>
      <div style={{height:3,background:'rgba(255,255,255,0.05)'}}>
        <div style={{height:'100%',background:'#dffe95',width:`${((step+1)/STEPS.length)*100}%`,transition:'width .5s'}}/>
      </div>

      <div style={{flex:1,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'48px 20px'}}>
        <div style={{width:'100%',maxWidth:560,background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:24,overflow:'hidden',position:'relative'}}>
          <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
          <div style={{padding:36}}>
            <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.1em',color:'#dffe95',marginBottom:14}}>Step {step+1} of {STEPS.length} — {STEPS[step]}</div>

            {/* Step 0 */}
            {step===0 && <>
              <h2 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:8,letterSpacing:'-.02em'}}>What kind of business<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>do you run?</em></h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Selfmade personalises your dashboard based on your business model.</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {BIZ.map(b => (
                  <div key={b.id} style={optStyle(answers.biz===b.id)} onClick={() => sel('biz',b.id)}>
                    {answers.biz===b.id && <div style={{position:'absolute',top:10,right:10,width:20,height:20,borderRadius:'50%',background:'#dffe95',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f'}}>✓</div>}
                    <div style={{fontSize:26,marginBottom:8}}>{b.icon}</div>
                    <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>{b.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{b.desc}</div>
                  </div>
                ))}
              </div>
            </>}

            {/* Step 1 */}
            {step===1 && <>
              <h2 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:8,letterSpacing:'-.02em'}}>Tell us about<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>your niche.</em></h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Helps Selfmade benchmark your metrics against similar businesses.</p>
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:13,fontWeight:700,color:'rgba(255,255,255,0.7)',marginBottom:6}}>What do you sell?</label>
                <input className="input" placeholder="e.g. Women's activewear, B2B SaaS, Real estate leads…" value={answers.niche} onChange={e=>sel('niche',e.target.value)} style={{width:'100%'}}/>
              </div>
            </>}

            {/* Step 2 */}
            {step===2 && <>
              <h2 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:8,letterSpacing:'-.02em'}}>What&apos;s your<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>monthly ad spend?</em></h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Selfmade tailors recommendations to your budget level.</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {SPEND.map(s => (
                  <div key={s.id} style={optStyle(answers.spend===s.id)} onClick={() => sel('spend',s.id)}>
                    {answers.spend===s.id && <div style={{position:'absolute',top:10,right:10,width:20,height:20,borderRadius:'50%',background:'#dffe95',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f'}}>✓</div>}
                    <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>{s.label}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{s.desc}</div>
                  </div>
                ))}
              </div>
            </>}

            {/* Step 3 */}
            {step===3 && <>
              <h2 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:8,letterSpacing:'-.02em'}}>What&apos;s your<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>primary goal?</em></h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:24}}>We&apos;ll focus recommendations on what matters most.</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {GOALS.map(g => (
                  <div key={g.id} style={optStyle(answers.goal===g.id)} onClick={() => sel('goal',g.id)}>
                    {answers.goal===g.id && <div style={{position:'absolute',top:10,right:10,width:20,height:20,borderRadius:'50%',background:'#dffe95',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f'}}>✓</div>}
                    <div style={{fontSize:22,marginBottom:8}}>{g.icon}</div>
                    <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>{g.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{g.desc}</div>
                  </div>
                ))}
              </div>
            </>}

            {/* Step 4 */}
            {step===4 && <>
              <h2 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:8,letterSpacing:'-.02em'}}>One last thing —<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>your experience.</em></h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Selfmade adjusts its language to match your level.</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {EXP.map(e => (
                  <div key={e.id} style={optStyle(answers.exp===e.id)} onClick={() => sel('exp',e.id)}>
                    {answers.exp===e.id && <div style={{position:'absolute',top:10,right:10,width:20,height:20,borderRadius:'50%',background:'#dffe95',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f'}}>✓</div>}
                    <div style={{fontSize:22,marginBottom:8}}>{e.icon}</div>
                    <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>{e.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{e.desc}</div>
                  </div>
                ))}
              </div>
            </>}

          </div>
          {/* Nav */}
          <div style={{padding:'16px 36px',borderTop:'1px solid rgba(223,254,149,0.1)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{display:'flex',gap:6}}>
              {STEPS.map((_,i) => <div key={i} style={{width:i===step?24:8,height:8,borderRadius:100,background:i===step?'#dffe95':i<step?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)',transition:'all .3s'}}/>)}
            </div>
            <div style={{display:'flex',gap:10}}>
              {step > 0 && <button onClick={() => setStep(s=>s-1)} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button>}
              {step < STEPS.length-1
                ? <button onClick={() => setStep(s=>s+1)} disabled={!canNext} style={{background:canNext?'#dffe95':'rgba(223,254,149,0.2)',color:canNext?'#10211f':'rgba(255,255,255,0.3)',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:canNext?'pointer':'not-allowed'}}>Next →</button>
                : <button onClick={finish} disabled={!canNext||saving} style={{background:canNext?'#dffe95':'rgba(223,254,149,0.2)',color:canNext?'#10211f':'rgba(255,255,255,0.3)',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:canNext?'pointer':'not-allowed'}}>{saving?'Saving…':'Finish →'}</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
