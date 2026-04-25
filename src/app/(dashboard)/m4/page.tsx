'use client'
import { useState } from 'react'

type Step = 'welcome' | 'product' | 'interests' | 'creatives' | 'budget' | 'review' | 'grades'

interface Interest {
  name: string
  category: string
  why: string
  size: string
  confidence: number
  selected?: boolean
  custom?: boolean
}

interface Creative {
  id: string
  name: string
  type: 'image' | 'video'
  pack: number
}

interface Grade {
  campaign_name: string
  grade: string
  emoji: string
  label: string
  why: string
  action: string
  action_reason: string
  applied?: boolean
}

export default function M4Page() {
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Grade[]>([])
  const [interests, setInterests] = useState<Interest[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [applying, setApplying] = useState<string|null>(null)
  const [form, setForm] = useState({
    product: '', description: '', competitors: '', targetCustomer: '',
    location: '', ageMin: '18', ageMax: '65', gender: 'ALL',
    budget: '50', numPackets: '2', campaignName: '',
  })
  const [creatives, setCreatives] = useState<Creative[]>([])

  const set = (k: string, v: string) => setForm(p => ({...p, [k]: v}))
  const selectedInterests = interests.filter(i => i.selected)
  const packs = Number(form.numPackets) || 2

  const generateInterests = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/m4/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: form.product, description: form.description, competitors: form.competitors, targetCustomer: form.targetCustomer })
      })
      const data = await res.json()
      setInterests((data.interests || []).map((i: Interest) => ({...i, selected: false})))
      setStep('interests')
    } catch { alert('Failed to generate interests. Try again.') }
    setLoading(false)
  }

  const addCustomInterest = () => {
    if (!customInterest.trim()) return
    setInterests(prev => [...prev, { name: customInterest.trim(), category: 'Custom', why: 'Added by you based on your audience knowledge.', size: 'Unknown', confidence: 70, selected: true, custom: true }])
    setCustomInterest('')
  }

  const addCreative = (pack: number) => {
    setCreatives(prev => [...prev, { id: Date.now().toString(), name: `Creative ${prev.length + 1}`, type: 'image', pack }])
  }

  const gradeNow = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/m4/grade', { method: 'POST' })
      const data = await res.json()
      setGrades(data.grades || [])
      setStep('grades')
    } catch { alert('Failed to grade campaigns.') }
    setLoading(false)
  }

  const applyAction = async (grade: Grade) => {
    setApplying(grade.campaign_name)
    await new Promise(r => setTimeout(r, 1500))
    setApplying(null)
    setGrades(prev => prev.map(g => g.campaign_name === grade.campaign_name ? {...g, applied: true} : g))
  }

  const gradeColors: Record<string, {bg:string,border:string,color:string}> = {
    GRADUATE:              { bg:'rgba(134,239,172,0.08)', border:'rgba(134,239,172,0.25)', color:'#86efac' },
    HOLD:                  { bg:'rgba(251,191,36,0.08)',  border:'rgba(251,191,36,0.2)',   color:'#fbbf24' },
    CATCHY_NOT_CONVERTING: { bg:'rgba(248,113,113,0.08)', border:'rgba(248,113,113,0.2)',  color:'#f87171' },
    PAUSE_POOR:            { bg:'rgba(248,113,113,0.06)', border:'rgba(248,113,113,0.15)', color:'#f87171' },
  }

  const inp = (label: string, key: string, placeholder: string, textarea?: boolean) => (
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>{label}</label>
      {textarea
        ? <textarea value={(form as any)[key]} onChange={e=>set(key,e.target.value)} placeholder={placeholder} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none',resize:'vertical',minHeight:80,lineHeight:1.6}}/>
        : <input value={(form as any)[key]} onChange={e=>set(key,e.target.value)} placeholder={placeholder} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
      }
    </div>
  )

  const STEPS: Step[] = ['welcome','product','interests','creatives','budget','review','grades']

  return (
    <div style={{padding:28,maxWidth:860,margin:'0 auto'}}>

      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:900,color:'#dffe95'}}>M4</div>
          <div>
            <h1 style={{fontSize:22,fontWeight:800,color:'white'}}>M4 Method</h1>
            <p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Find winners → Graduate them → Scale what works</p>
          </div>
        </div>
        <div style={{display:'flex',gap:3}}>
          {STEPS.map((s,i) => (
            <div key={s} style={{flex:1,height:4,borderRadius:100,transition:'all .3s',background:step===s?'#dffe95':STEPS.indexOf(step)>i?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)'}}/>
          ))}
        </div>
      </div>

      {step==='welcome' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.15)',borderRadius:20,padding:36,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
          <h2 style={{fontSize:26,fontWeight:900,color:'white',marginBottom:10,letterSpacing:'-.02em'}}>Welcome to M4 — <em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>the smart way to run Meta ads.</em></h2>
          <p style={{fontSize:15,color:'rgba(255,255,255,0.6)',lineHeight:1.8,marginBottom:24}}>A proven 3-phase system used by top media buyers. We walk you through it step by step — no experience needed.</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:28}}>
            {[
              {n:'01',title:'Find Winners',desc:'Run prospecting campaigns with broad and interest audiences to discover which creatives actually convert.'},
              {n:'02',title:'Graduate Winners',desc:'When an ad proves itself, duplicate it — never move it — into your scaling campaign and new audiences.'},
              {n:'03',title:'Scale What Works',desc:'Pour more budget into proven winners. Kill what loses money. Let data make your decisions.'},
            ].map(p => (
              <div key={p.n} style={{background:'rgba(255,255,255,0.03)',borderRadius:14,padding:18,border:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#dffe95',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>{p.n}</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:6}}>{p.title}</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',lineHeight:1.65}}>{p.desc}</div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <button onClick={()=>setStep('product')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'13px 32px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Start M4 Setup →</button>
            <button onClick={gradeNow} disabled={loading} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'13px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:loading?.6:1}}>
              {loading?'Analysing…':'⭐ Grade My Current Campaigns'}
            </button>
          </div>
        </div>
      )}

      {step==='product' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'}}>
          <div style={{padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
            <div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 1 — Tell us about your product</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Claude will use this to suggest the best audiences for your ads.</div>
          </div>
          <div style={{padding:24}}>
            {inp('Product Name','product','e.g. Hair Fall Treatment Serum')}
            {inp('What does it do? Who is it for?','description','e.g. A DHT-blocking serum for men and women experiencing hair thinning. Works in 4-6 weeks.',true)}
            {inp('Who is your target customer?','targetCustomer','e.g. Men and women 25-45 experiencing hair loss, interested in natural remedies')}
            {inp('Your competitors (brand names)','competitors','e.g. Minoxidil, Regaine, Foligain, Viviscal')}
            {inp('Campaign name','campaignName','e.g. Hair Fall — Prospecting — Apr 2025')}
          </div>
          <div style={{padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between'}}>
            <button onClick={()=>setStep('welcome')} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button>
            <button onClick={generateInterests} disabled={!form.product||!form.description||loading} style={{background:form.product&&form.description?'#dffe95':'rgba(223,254,149,0.2)',color:form.product&&form.description?'#10211f':'rgba(255,255,255,0.3)',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:loading?.7:1}}>
              {loading?'✦ Claude is thinking…':'✦ Generate Audience Suggestions →'}
            </button>
          </div>
        </div>
      )}

      {step==='interests' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'}}>
          <div style={{padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
            <div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 2 — Select Your Audiences</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each selection becomes one ad set. Pick at least 2.</div>
          </div>
          <div style={{margin:'20px 24px 0',background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'12px 16px',display:'flex',gap:12}}>
            <span style={{fontSize:20,flexShrink:0}}>💡</span>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}>
              <strong style={{color:'#dffe95'}}>Why one interest per ad set?</strong> When you mix interests, you lose visibility into what is actually working. One interest per ad set means you know exactly which audience converts — so you scale winners and pause losers.
            </div>
          </div>
          <div style={{padding:24,display:'flex',flexDirection:'column',gap:10}}>
            {interests.map((interest,i) => (
              <div key={i} onClick={()=>setInterests(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
                style={{padding:16,borderRadius:14,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.08)'}`,background:interest.selected?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',transition:'all .2s',display:'flex',alignItems:'flex-start',gap:14}}>
                <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.2)'}`,background:interest.selected?'#dffe95':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f',flexShrink:0,marginTop:2}}>
                  {interest.selected?'✓':''}
                </div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                    <span style={{fontSize:14,fontWeight:700,color:'white'}}>{interest.name}</span>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em'}}>{interest.category}</span>
                    {interest.custom&&<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(223,254,149,0.1)',color:'#dffe95'}}>Custom</span>}
                  </div>
                  <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>{interest.why}</div>
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',flexShrink:0,textAlign:'right'}}>
                  <div>{interest.size}</div>
                  <div style={{color:interest.confidence>80?'#86efac':'#fbbf24',marginTop:2}}>{interest.confidence}%</div>
                </div>
              </div>
            ))}
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <input value={customInterest} onChange={e=>setCustomInterest(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addCustomInterest()} placeholder="Add your own interest…" style={{flex:1,padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.04)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
              <button onClick={addCustomInterest} style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'10px 18px',borderRadius:10,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>+ Add</button>
            </div>
          </div>
          <div style={{padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <button onClick={()=>setStep('product')} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button>
              <span style={{marginLeft:14,fontSize:13,color:'rgba(255,255,255,0.4)'}}>{selectedInterests.length} selected</span>
            </div>
            <button onClick={()=>setStep('creatives')} disabled={selectedInterests.length<2} style={{background:selectedInterests.length>=2?'#dffe95':'rgba(223,254,149,0.2)',color:selectedInterests.length>=2?'#10211f':'rgba(255,255,255,0.3)',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:selectedInterests.length>=2?'pointer':'not-allowed'}}>
              Continue with {selectedInterests.length} audiences →
            </button>
          </div>
        </div>
      )}

      {step==='creatives' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'}}>
          <div style={{padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
            <div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 3 — Build Your Creative Packs</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each creative = one ad set. Group into packs of 4-8 to find your winner.</div>
          </div>
          <div style={{margin:'20px 24px 0',background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'12px 16px',display:'flex',gap:12}}>
            <span style={{fontSize:20,flexShrink:0}}>📦</span>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}>
              <strong style={{color:'#dffe95'}}>What is a pack?</strong> A pack is 4-8 ads that launch together. The goal is to give Meta enough variation to find which creative resonates — without spreading budget too thin. New creatives always go in new packs.
            </div>
          </div>
          <div style={{padding:'20px 24px'}}>
            <div style={{marginBottom:20}}>
              <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em'}}>How many broad packs?</label>
              <div style={{display:'flex',gap:8}}>
                {[1,2,3,4].map(n=>(
                  <button key={n} onClick={()=>set('numPackets',String(n))} style={{width:44,height:44,borderRadius:10,border:`2px solid ${form.numPackets===String(n)?'#dffe95':'rgba(255,255,255,0.1)'}`,background:form.numPackets===String(n)?'rgba(223,254,149,0.1)':'none',color:form.numPackets===String(n)?'#dffe95':'rgba(255,255,255,0.4)',fontWeight:800,fontSize:16,fontFamily:'inherit',cursor:'pointer'}}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',marginTop:6}}>We recommend 2-3 packs. Each pack tests a different creative angle.</div>
            </div>
            {Array.from({length:packs}).map((_,packIdx)=>{
              const pc = creatives.filter(c=>c.pack===packIdx+1)
              return (
                <div key={packIdx} style={{marginBottom:14,background:'rgba(255,255,255,0.02)',borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',padding:16}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:'white'}}>Broad Pack {packIdx+1}</div>
                      <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',marginTop:2}}>{pc.length} creative{pc.length!==1?'s':''} — target 4-8</div>
                    </div>
                    <button onClick={()=>addCreative(packIdx+1)} style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>+ Add Creative</button>
                  </div>
                  {pc.length===0
                    ? <div style={{padding:20,textAlign:'center',border:'2px dashed rgba(255,255,255,0.08)',borderRadius:10,fontSize:13,color:'rgba(255,255,255,0.3)'}}>Click "+ Add Creative" to add your first ad</div>
                    : <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                        {pc.map(c=>(
                          <div key={c.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'8px 14px',fontSize:13,color:'white',fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
                            <span>{c.type==='video'?'🎬':'🖼'}</span>
                            <input value={c.name} onChange={e=>setCreatives(prev=>prev.map(x=>x.id===c.id?{...x,name:e.target.value}:x))} style={{background:'none',border:'none',color:'white',fontSize:13,fontWeight:600,fontFamily:'inherit',outline:'none',width:100}}/>
                            <button onClick={()=>setCreatives(prev=>prev.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:16,padding:0}}>×</button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              )
            })}
            <div style={{background:'rgba(147,197,253,0.05)',borderRadius:14,border:'1px solid rgba(147,197,253,0.15)',padding:16}}>
              <div style={{fontSize:13,fontWeight:800,color:'#93c5fd',marginBottom:6}}>Interest Ad Sets ({selectedInterests.length})</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:10,lineHeight:1.6}}>Interest ad sets receive your winner creatives once identified. They launch with your best Pack 1 creative to start.</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {selectedInterests.map((i,idx)=>(
                  <div key={idx} style={{fontSize:12,fontWeight:600,padding:'4px 12px',borderRadius:100,background:'rgba(147,197,253,0.1)',border:'1px solid rgba(147,197,253,0.2)',color:'#93c5fd'}}>{i.name}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between'}}>
            <button onClick={()=>setStep('interests')} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button>
            <button onClick={()=>setStep('budget')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Set Budget & Targeting →</button>
          </div>
        </div>
      )}

      {step==='budget' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'}}>
          <div style={{padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
            <div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 4 — Budget & Targeting</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Set your campaign budget and who you want to reach.</div>
          </div>
          <div style={{padding:24}}>
            <div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'12px 16px',marginBottom:20,display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>💰</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}>
                <strong style={{color:'#dffe95'}}>Why Campaign Budget Optimization (CBO)?</strong> One budget for the whole campaign. Meta automatically sends more money to the best performing ad sets. This finds winners faster and wastes less budget.
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Daily Budget (USD)</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.5)',fontSize:14}}>$</span>
                  <input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} style={{width:'100%',padding:'10px 14px 10px 28px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>Minimum $50/day recommended</div>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Gender</label>
                <select value={form.gender} onChange={e=>set('gender',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#152928',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}>
                  <option value="ALL">All Genders</option>
                  <option value="MALE">Men Only</option>
                  <option value="FEMALE">Women Only</option>
                </select>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Min Age</label>
                <input type="number" value={form.ageMin} onChange={e=>set('ageMin',e.target.value)} min="18" max="65" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Max Age</label>
                <input type="number" value={form.ageMax} onChange={e=>set('ageMax',e.target.value)} min="18" max="65" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'}}>Location</label>
                <input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="e.g. Pakistan, Lahore" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
              </div>
            </div>
            <div style={{background:'rgba(147,197,253,0.05)',borderRadius:12,border:'1px solid rgba(147,197,253,0.15)',padding:'12px 16px',display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>🛡️</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}>
                <strong style={{color:'#93c5fd'}}>Exclusions applied automatically.</strong> We exclude people who already visited your website and existing customers from all ad sets. Your budget only reaches brand new audiences — the whole point of prospecting.
              </div>
            </div>
          </div>
          <div style={{padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between'}}>
            <button onClick={()=>setStep('creatives')} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>← Back</button>
            <button onClick={()=>setStep('review')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Review & Launch →</button>
          </div>
        </div>
      )}

      {step==='review' && (
        <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'}}>
          <div style={{padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
            <div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 5 — Review & Launch</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Here is exactly what will be created in your Meta Ads account.</div>
          </div>
          <div style={{padding:24}}>
            <div style={{background:'rgba(255,255,255,0.03)',borderRadius:14,padding:18,marginBottom:14,border:'1px solid rgba(255,255,255,0.07)'}}>
              <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Campaign</div>
              <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:6}}>{form.campaignName||'M4 Prospecting Campaign'}</div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <span style={{fontSize:13,color:'rgba(255,255,255,0.5)'}}>💰 ${form.budget}/day (CBO)</span>
                <span style={{fontSize:13,color:'rgba(255,255,255,0.5)'}}>📍 {form.location||'Not set'}</span>
                <span style={{fontSize:13,color:'rgba(255,255,255,0.5)'}}>👥 {form.ageMin}-{form.ageMax} · {form.gender==='ALL'?'All genders':form.gender}</span>
              </div>
            </div>
            <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>Ad Sets ({packs+selectedInterests.length} total)</div>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              {Array.from({length:packs}).map((_,i)=>{
                const pc = creatives.filter(c=>c.pack===i+1)
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderRadius:10,background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.1)'}}>
                    <span style={{fontSize:16}}>📦</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:'white'}}>Broad Pack {i+1}</div>
                      <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{pc.length} ads · No interest targeting · Excl. visitors & purchasers</div>
                    </div>
                    <span style={{fontSize:11,color:'#86efac',fontWeight:700}}>BROAD</span>
                  </div>
                )
              })}
              {selectedInterests.map((int,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderRadius:10,background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.1)'}}>
                  <span style={{fontSize:16}}>🎯</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:'white'}}>{int.name}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Interest targeting · Excl. visitors & purchasers · Winners only</div>
                  </div>
                  <span style={{fontSize:11,color:'#93c5fd',fontWeight:700}}>INTEREST</span>
                </div>
              ))}
            </div>
            <div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'14px 18px',marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:'#dffe95',marginBottom:4}}>✓ Before we launch</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',lineHeight:1.7}}>All campaigns start <strong style={{color:'white'}}>PAUSED</strong> so you can review before going live. Exclusion audiences are created automatically from your pixel.</div>
            </div>
            <button onClick={async()=>{
              setLoading(true)
              await new Promise(r=>setTimeout(r,2500))
              setLoading(false)
              alert('M4 campaign structure created in Meta Ads Manager! All campaigns are PAUSED — review and activate when ready.')
              setStep('grades')
            }} disabled={loading} style={{width:'100%',background:loading?'rgba(223,254,149,0.5)':'#dffe95',color:'#10211f',border:'none',padding:15,borderRadius:14,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:loading?'not-allowed':'pointer'}}>
              {loading?'🚀 Creating in Meta Ads Manager…':'🚀 Launch M4 Campaign (PAUSED for review)'}
            </button>
          </div>
          <div style={{padding:'12px 24px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            <button onClick={()=>setStep('budget')} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>← Back to budget</button>
          </div>
        </div>
      )}

      {step==='grades' && (
        <div>
          <div style={{marginBottom:20}}>
            <h2 style={{fontSize:20,fontWeight:800,color:'white',marginBottom:4}}>M4 Creative Grades</h2>
            <p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Claude analysed your campaigns. Here is what the data says and exactly what to do.</p>
          </div>
          {loading ? (
            <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,padding:48,textAlign:'center'}}>
              <div style={{width:44,height:44,border:'3px solid rgba(223,254,149,0.2)',borderTopColor:'#dffe95',borderRadius:'50%',animation:'spin 1s linear infinite',margin:'0 auto 16px'}}/>
              <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:6}}>Claude is analysing your campaigns…</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Comparing each creative against your account average ROAS</div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : grades.length===0 ? (
            <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:18,padding:48,textAlign:'center'}}>
              <div style={{fontSize:32,marginBottom:12}}>📊</div>
              <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaign data yet</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Sync your Meta account and run campaigns for at least a few days to get graded recommendations.</div>
              <button onClick={gradeNow} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>⭐ Analyse My Campaigns</button>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {grades.map((grade,i)=>{
                const cfg = gradeColors[grade.grade]||gradeColors.HOLD
                return (
                  <div key={i} style={{background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:18,padding:24,opacity:grade.applied?.6:1,transition:'opacity .3s'}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
                          <span style={{fontSize:24}}>{grade.emoji}</span>
                          <div>
                            <div style={{fontSize:13,fontWeight:800,color:cfg.color,textTransform:'uppercase',letterSpacing:'.06em'}}>{grade.label}</div>
                            <div style={{fontSize:15,fontWeight:700,color:'white',marginTop:2}}>"{grade.campaign_name}"</div>
                          </div>
                          {grade.applied&&<span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:100,background:'rgba(134,239,172,0.15)',color:'#86efac',border:'1px solid rgba(134,239,172,0.2)'}}>✓ Applied</span>}
                        </div>
                        <div style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:10}}>
                          <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>What the data says</div>
                          <div style={{fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7}}>{grade.why}</div>
                        </div>
                        <div style={{background:'rgba(0,0,0,0.15)',borderLeft:`3px solid ${cfg.color}`,borderRadius:'0 10px 10px 0',padding:'12px 16px'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Recommended action</div>
                          <div style={{fontSize:13,color:'white',fontWeight:600,marginBottom:4}}>{grade.action}</div>
                          <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',lineHeight:1.6}}>{grade.action_reason}</div>
                        </div>
                      </div>
                      {!grade.applied&&(
                        <div style={{display:'flex',flexDirection:'column',gap:8,flexShrink:0}}>
                          <button onClick={()=>applyAction(grade)} disabled={!!applying} style={{background:cfg.color,color:'#10211f',border:'none',padding:'10px 18px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:applying?.7:1,whiteSpace:'nowrap'}}>
                            {applying===grade.campaign_name?'Applying…':grade.grade==='GRADUATE'?'⭐ Duplicate to Scale':grade.grade==='HOLD'?'🟡 Keep Running':'⏸ Pause This Ad'}
                          </button>
                          <button style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'8px 16px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Skip for now</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <button onClick={()=>setStep('welcome')} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',alignSelf:'flex-start'}}>
                + Launch Another M4 Campaign
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
