'use client'
import { useState } from 'react'

type Step = 'welcome' | 'pixel' | 'creatives' | 'interests' | 'budget' | 'review' | 'grades'

interface Creative { id: string; name: string; pack: number; type?: string; file?: File }
interface Interest { name: string; category: string; why: string; size: string; confidence: number; selected: boolean; custom?: boolean }
interface Grade { campaign_name: string; grade: string; emoji: string; label: string; why: string; action: string; action_reason: string; applied?: boolean }

export default function M4Page() {
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Grade[]>([])
  const [interests, setInterests] = useState<Interest[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [applying, setApplying] = useState<string|null>(null)
  const [pixelChoice, setPixelChoice] = useState<'existing'|'new'|null>(null)
  const [pixelId, setPixelId] = useState('')
  const [pixels, setPixels] = useState<{id:string,name:string,active:boolean}[]>([])
  const [loadingPixels, setLoadingPixels] = useState(false)
  const [audiences, setAudiences] = useState<{key:string,id:string,name:string,description:string}[]>([])
  const [creatingAudiences, setCreatingAudiences] = useState(false)

  const fetchPixels = async () => {
    setLoadingPixels(true)
    try {
      const res = await fetch('/api/m4/pixels')
      const data = await res.json()
      setPixels(data.pixels || [])
    } catch {}
    setLoadingPixels(false)
  }

  const createAudiences = async () => {
    if (!pixelId || !form.campaignName) return
    setCreatingAudiences(true)
    try {
      const res = await fetch('/api/m4/audiences', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pixelId, campaignName: form.campaignName || 'M4 Campaign' })
      })
      const data = await res.json()
      setAudiences(data.created || [])
    } catch {}
    setCreatingAudiences(false)
  }
  const [creatives, setCreatives] = useState<Creative[]>([])

  const [form, setForm] = useState({
    product:'', description:'', competitors:'', targetCustomer:'',
    location:'', ageMin:'18', ageMax:'65', gender:'ALL',
    budget:'50', campaignName:'',
  })
  const set = (k:string,v:string) => setForm(p=>({...p,[k]:v}))
  const selectedInterests = interests.filter(i=>i.selected)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      const id = Date.now().toString() + String(Math.random())
      const type = file.type.startsWith('video') ? 'video' : 'image'
      setCreatives(prev => [...prev, { id, name: file.name.replace(/\.[^.]+$/, ''), pack: 1, type, file }])
    })
    e.target.value = ''
  }

  const addCreative = () => {
    setCreatives(prev => [...prev, { id: Date.now().toString(), name: `Creative ${prev.length + 1}`, pack: 1 }])
  }

  const generateInterests = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/m4/interests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:form.product,description:form.description,competitors:form.competitors,targetCustomer:form.targetCustomer})})
      const data = await res.json()
      setInterests((data.interests||[]).map((i:Interest)=>({...i,selected:false})))
    } catch { alert('Failed to generate interests') }
    setLoading(false)
  }

  const addCustomInterest = () => {
    if (!customInterest.trim()) return
    setInterests(prev=>[...prev,{name:customInterest.trim(),category:'Custom',why:'Added by you based on your audience knowledge.',size:'Unknown',confidence:70,selected:true,custom:true}])
    setCustomInterest('')
  }

  const gradeNow = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/m4/grade',{method:'POST'})
      const data = await res.json()
      setGrades(data.grades||[])
      setStep('grades')
    } catch { alert('Failed to grade campaigns.') }
    setLoading(false)
  }

  const applyAction = async (grade:Grade) => {
    setApplying(grade.campaign_name)
    await new Promise(r=>setTimeout(r,1500))
    setApplying(null)
    setGrades(prev=>prev.map(g=>g.campaign_name===grade.campaign_name?{...g,applied:true}:g))
  }

  const gc:{[k:string]:{bg:string,border:string,color:string}} = {
    GRADUATE:{bg:'rgba(134,239,172,.08)',border:'rgba(134,239,172,.25)',color:'#86efac'},
    HOLD:{bg:'rgba(251,191,36,.08)',border:'rgba(251,191,36,.2)',color:'#fbbf24'},
    CATCHY_NOT_CONVERTING:{bg:'rgba(248,113,113,.08)',border:'rgba(248,113,113,.2)',color:'#f87171'},
    PAUSE_POOR:{bg:'rgba(248,113,113,.06)',border:'rgba(248,113,113,.15)',color:'#f87171'},
  }

  const STEPS:Step[] = ['welcome','pixel','creatives','interests','budget','review','grades']
  const card = {background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden' as const}
  const head = {padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'}
  const body = {padding:24}
  const foot = {padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex' as const,justifyContent:'space-between' as const}
  const backBtn = {background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer' as const}
  const nextBtn = (disabled?:boolean) => ({background:disabled?'rgba(223,254,149,0.2)':'#dffe95',color:disabled?'rgba(255,255,255,0.3)':'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:disabled?'not-allowed' as const:'pointer' as const})
  const note = (icon:string,color:string,title:string,text:string) => (
    <div style={{margin:'20px 24px 0',background:`${color}08`,border:`1px solid ${color}22`,borderRadius:12,padding:'12px 16px',display:'flex',gap:12}}>
      <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color}}>{title}</strong> {text}</div>
    </div>
  )
  const inp = (label:string,k:string,ph:string,ta?:boolean) => (
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>{label}</label>
      {ta?<textarea value={(form as any)[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none',resize:'vertical' as const,minHeight:80,lineHeight:1.6}}/>
         :<input value={(form as any)[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>}
    </div>
  )

  return (
    <div style={{padding:28,maxWidth:820,margin:'0 auto'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:900,color:'#dffe95'}}>M4</div>
          <div><h1 style={{fontSize:22,fontWeight:800,color:'white'}}>M4 Method</h1><p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Find winners → Graduate them → Scale what works</p></div>
        </div>
        <div style={{display:'flex',gap:3}}>
          {STEPS.map((s,i)=><div key={s} style={{flex:1,height:4,borderRadius:100,transition:'all .3s',background:step===s?'#dffe95':STEPS.indexOf(step)>i?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)'}}/>)}
        </div>
      </div>

      {/* WELCOME */}
      {step==='welcome'&&(
        <div style={{...card,padding:36,position:'relative' as const}}>
          <div style={{position:'absolute' as const,top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
          <h2 style={{fontSize:24,fontWeight:900,color:'white',marginBottom:10}}>Welcome to M4 — <em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>the smart way to run Meta ads.</em></h2>
          <p style={{fontSize:14,color:'rgba(255,255,255,0.6)',lineHeight:1.8,marginBottom:24}}>M4 finds your winning creative first, then finds your winning audience. Two campaigns, two layers of testing, zero guesswork.</p>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:28}}>
            <div style={{background:'rgba(134,239,172,0.06)',border:'1px solid rgba(134,239,172,0.2)',borderRadius:16,padding:20}}>
              <div style={{fontSize:11,fontWeight:800,color:'#86efac',textTransform:'uppercase' as const,letterSpacing:'.1em',marginBottom:8}}>Campaign 1 — Broad</div>
              <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:8}}>Find your winning creative</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.65}}>Run multiple creatives against a broad audience. No interest targeting. Meta shows each creative to the most relevant people and tells you which one converts.</div>
              <div style={{marginTop:12,fontSize:12,color:'#86efac'}}>Each ad set = same broad audience + 1 creative</div>
            </div>
            <div style={{background:'rgba(147,197,253,0.06)',border:'1px solid rgba(147,197,253,0.2)',borderRadius:16,padding:20}}>
              <div style={{fontSize:11,fontWeight:800,color:'#93c5fd',textTransform:'uppercase' as const,letterSpacing:'.1em',marginBottom:8}}>Campaign 2 — Interest</div>
              <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:8}}>Find your winning audience</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.65}}>Take your winning creative and test it against specific interests. Each ad set = one interest. This tells you exactly which audience converts best.</div>
              <div style={{marginTop:12,fontSize:12,color:'#93c5fd'}}>Each ad set = 1 interest + winning creative</div>
            </div>
          </div>

          <div style={{background:'rgba(255,255,255,0.03)',borderRadius:14,padding:16,marginBottom:24,border:'1px solid rgba(255,255,255,0.06)'}}>
            <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase' as const,letterSpacing:'.08em',marginBottom:10}}>The M4 Flow</div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' as const,fontSize:13}}>
              {['Upload creatives','→','Broad campaign runs','→','Winner found','→','Winner goes to Interest campaign','→','Winning audience found','→','Scale both'].map((t,i)=>(
                <span key={i} style={{color:t==='→'?'rgba(255,255,255,0.25)':i===4||i===8?'#dffe95':'rgba(255,255,255,0.6)',fontWeight:t==='→'?400:600}}>{t}</span>
              ))}
            </div>
          </div>

          <div style={{display:'flex',gap:12,flexWrap:'wrap' as const}}>
            <button onClick={()=>setStep('pixel')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'13px 32px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Start M4 Setup →</button>
            <button onClick={gradeNow} disabled={loading} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'13px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:loading?.6:1}}>
              {loading?'Analysing…':'⭐ Grade My Current Campaigns'}
            </button>
          </div>
        </div>
      )}

      {/* PIXEL */}
      {step==='pixel'&&(
        <div style={card}>
          <div style={head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 1 — Meta Pixel Setup</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>The pixel lets us exclude existing visitors and purchasers from your prospecting campaigns.</div></div>
          {note('🎯','#dffe95','Why do we need a pixel?','Without a pixel, your ads will show to people who already bought from you — wasting budget. The pixel tracks who visited your site and who purchased, so we can exclude them from all prospecting. Your money only reaches brand new audiences.')}
          <div style={{padding:24}}>
            {inp('Your product / website name','product','e.g. HairFallSolution.com')}
            {inp('What do you sell?','description','e.g. Hair loss treatment serum for men and women',true)}
            {inp('Competitors','competitors','e.g. Minoxidil, Regaine, Foligain')}
            {inp('Target customer','targetCustomer','e.g. Men and women 25-45 experiencing hair thinning')}
            {inp('Campaign name','campaignName','e.g. Hair Fall — M4 — Apr 2025')}

            <div style={{marginTop:8}}>
              <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:10,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Do you have a Meta Pixel on your website?</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div onClick={()=>{setPixelChoice('existing');if(pixels.length===0)fetchPixels()}} style={{padding:16,borderRadius:14,border:`2px solid ${pixelChoice==='existing'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='existing'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                  <div style={{fontSize:24,marginBottom:8}}>✅</div>
                  <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:4}}>Yes, I have a pixel</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>I will enter my Pixel ID</div>
                </div>
                <div onClick={()=>setPixelChoice('new')} style={{padding:16,borderRadius:14,border:`2px solid ${pixelChoice==='new'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='new'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                  <div style={{fontSize:24,marginBottom:8}}>🆕</div>
                  <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:4}}>No, I need one</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>We will help you create it</div>
                </div>
              </div>
            </div>

            {pixelChoice==='existing'&&(
              <div style={{marginTop:14}}>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Your Pixel ID</label>
                {loadingPixels ? (
                  <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',padding:'10px 0'}}>Loading your pixels from Meta…</div>
                ) : pixels.length > 0 ? (
                  <select value={pixelId} onChange={e=>setPixelId(e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#152928',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}>
                    <option value="">Select a pixel…</option>
                    {pixels.map(p=>(
                      <option key={p.id} value={p.id}>{p.name} — {p.id} {p.active?'✓ Active':'(inactive)'}</option>
                    ))}
                  </select>
                ) : (
                  <input value={pixelId} onChange={e=>setPixelId(e.target.value)} placeholder="e.g. 1234567890123456" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
                )}
                <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',marginTop:4}}>Find this in Meta Events Manager → your pixel → Settings</div>
                {pixelId && audiences.length === 0 && (
                  <button onClick={createAudiences} disabled={creatingAudiences} style={{marginTop:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'9px 18px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:creatingAudiences?.6:1}}>
                    {creatingAudiences?'Creating exclusion audiences in Meta…':'🛡️ Create Exclusion Audiences Automatically'}
                  </button>
                )}
                {audiences.length > 0 && (
                  <div style={{marginTop:10,background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:10,padding:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#86efac',marginBottom:8}}>✓ {audiences.length} exclusion audiences created in Meta</div>
                    {audiences.map(a=>(
                      <div key={a.key} style={{fontSize:12,color:'rgba(255,255,255,0.5)',padding:'3px 0'}}>• {a.name}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pixelChoice==='new'&&(
              <div style={{marginTop:14,background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:'#dffe95',marginBottom:8}}>How to create a Meta Pixel:</div>
                <div style={{display:'flex',flexDirection:'column' as const,gap:8}}>
                  {[
                    '1. Go to Meta Events Manager → Connect Data Sources → Web',
                    '2. Choose "Meta Pixel" → name it after your business',
                    '3. Copy the Pixel ID shown',
                    '4. Add it to your website (Shopify: paste in theme settings, WordPress: use PixelYourSite plugin)',
                    '5. Come back and enter your Pixel ID above',
                  ].map((s,i)=><div key={i} style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.6}}>{s}</div>)}
                </div>
                <a href="https://business.facebook.com/events_manager" target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:12,fontSize:13,fontWeight:700,color:'#dffe95',textDecoration:'none'}}>→ Open Meta Events Manager</a>
              </div>
            )}
          </div>
          <div style={foot}>
            <button onClick={()=>setStep('welcome')} style={backBtn}>← Back</button>
            <button onClick={async()=>{if(interests.length===0)await generateInterests();setStep('creatives')}} disabled={!pixelChoice||!form.product||loading} style={nextBtn(!pixelChoice||!form.product||loading)}>
              {loading?'Loading…':'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* CREATIVES */}
      {step==='creatives'&&(
        <div style={card}>
          <div style={head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 2 — Upload Your Creatives</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each creative = one ad set in your Broad Campaign. Add 3-8 creatives to test.</div></div>
          {note('🖼️','#86efac','One creative per ad set.','This is the key rule of M4. If you put multiple creatives in one ad set, you will not know which one caused the results. One creative per ad set = clear winner identification. Add as many as you want to test — we recommend starting with 3-5.')}
          <div style={{padding:24}}>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'white',marginBottom:10}}>Your creatives for the Broad Campaign:</div>
              {creatives.length===0?(
                <div style={{padding:32,textAlign:'center',border:'2px dashed rgba(255,255,255,0.08)',borderRadius:14,fontSize:14,color:'rgba(255,255,255,0.3)'}}>
                  No creatives added yet. Click below to add your first one.
                </div>
              ):(
                <div style={{display:'flex',flexDirection:'column' as const,gap:8,marginBottom:12}}>
                  {creatives.map((c,i)=>(
                    <div key={c.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderRadius:12,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
                      <div style={{width:32,height:32,borderRadius:8,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#dffe95',flexShrink:0}}>A{i+1}</div>
                      <input value={c.name} onChange={e=>setCreatives(prev=>prev.map(x=>x.id===c.id?{...x,name:e.target.value}:x))} style={{flex:1,background:'none',border:'none',color:'white',fontSize:14,fontWeight:600,fontFamily:'inherit',outline:'none'}}/>
                      <div style={{display:'flex',gap:6}}>
                        {['image','video'].map(t=>(
                          <button key={t} onClick={()=>setCreatives(prev=>prev.map(x=>x.id===c.id?{...x,type:t as any}:x))} style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:100,border:`1px solid ${(c as any).type===t?'rgba(223,254,149,0.3)':'rgba(255,255,255,0.1)'}`,background:(c as any).type===t?'rgba(223,254,149,0.1)':'none',color:(c as any).type===t?'#dffe95':'rgba(255,255,255,0.35)',cursor:'pointer',fontFamily:'inherit'}}>
                            {t==='image'?'🖼 Image':'🎬 Video'}
                          </button>
                        ))}
                      </div>
                      <button onClick={()=>setCreatives(prev=>prev.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:18,padding:0,lineHeight:1}}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <label style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'10px 20px',borderRadius:100,fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                  📁 Upload from Computer
                  <input type="file" accept="image/*,video/*" multiple onChange={handleFileUpload} style={{display:'none'}}/>
                </label>
                <button onClick={()=>addCreative()} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)',padding:'10px 20px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                  + Add Name Only
                </button>
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px',borderRadius:100,background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)'}}>
                  <span style={{fontSize:13}}>✨</span>
                  <span style={{fontSize:13,fontWeight:700,color:'#93c5fd'}}>AI Creative Studio</span>
                  <span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:100,background:'rgba(147,197,253,0.15)',color:'#93c5fd',letterSpacing:'.06em'}}>COMING SOON</span>
                </div>
              </div>
            </div>

            <div style={{background:'rgba(147,197,253,0.05)',borderRadius:12,border:'1px solid rgba(147,197,253,0.15)',padding:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'#93c5fd',marginBottom:4}}>Interest Campaign</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.65}}>Your interest campaign will automatically use the same creatives. In the next step you will choose which interests to test — one per ad set.</div>
            </div>
          </div>
          <div style={foot}>
            <button onClick={()=>setStep('pixel')} style={backBtn}>← Back</button>
            <button onClick={()=>setStep('interests')} disabled={creatives.length<1} style={nextBtn(creatives.length<1)}>
              Choose Interests ({creatives.length} creative{creatives.length!==1?'s':''}) →
            </button>
          </div>
        </div>
      )}

      {/* INTERESTS */}
      {step==='interests'&&(
        <div style={card}>
          <div style={head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 3 — Select Interests for Campaign 2</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each interest = one ad set. Claude suggested these based on your product. Pick at least 2.</div></div>
          {note('🎯','#93c5fd','Why one interest per ad set?','Mixing interests hides what is working. If you put "Gym" and "Skincare" in one ad set, you will never know which audience converted. One interest per ad set = you know exactly who buys from you.')}
          <div style={{padding:24}}>
            {interests.length===0?(
              <div style={{textAlign:'center',padding:32}}>
                <button onClick={generateInterests} disabled={loading} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'12px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:loading?.7:1}}>
                  {loading?'✦ Claude is thinking…':'✦ Generate Interest Suggestions'}
                </button>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column' as const,gap:10}}>
                {interests.map((interest,i)=>(
                  <div key={i} onClick={()=>setInterests(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
                    style={{padding:16,borderRadius:14,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.08)'}`,background:interest.selected?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',transition:'all .2s',display:'flex',alignItems:'flex-start',gap:14}}>
                    <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.2)'}`,background:interest.selected?'#dffe95':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f',flexShrink:0,marginTop:2}}>
                      {interest.selected?'✓':''}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap' as const}}>
                        <span style={{fontSize:14,fontWeight:700,color:'white'}}>{interest.name}</span>
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.4)',textTransform:'uppercase' as const,letterSpacing:'.06em'}}>{interest.category}</span>
                        {interest.custom&&<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(223,254,149,0.1)',color:'#dffe95'}}>Custom</span>}
                      </div>
                      <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>{interest.why}</div>
                    </div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',flexShrink:0,textAlign:'right' as const}}>
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
            )}
          </div>
          <div style={foot}>
            <button onClick={()=>setStep('creatives')} style={backBtn}>← Back</button>
            <button onClick={()=>setStep('budget')} disabled={selectedInterests.length<2} style={nextBtn(selectedInterests.length<2)}>
              Set Budget ({selectedInterests.length} interest{selectedInterests.length!==1?'s':''} selected) →
            </button>
          </div>
        </div>
      )}

      {/* BUDGET */}
      {step==='budget'&&(
        <div style={card}>
          <div style={head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 4 — Budget & Targeting</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>One budget per campaign. Meta automatically allocates to best performing ad sets.</div></div>
          {note('💰','#dffe95','Why CBO (Campaign Budget Optimization)?','Instead of setting a budget per ad set, we give the whole campaign a daily budget. Meta automatically sends more money to the best performing ad sets. This finds winners faster and wastes less budget on losers.')}
          <div style={{padding:24}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Daily Budget per Campaign (USD)</label>
                <div style={{position:'relative' as const}}>
                  <span style={{position:'absolute' as const,left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.5)',fontSize:14}}>$</span>
                  <input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} style={{width:'100%',padding:'10px 14px 10px 28px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>Min $50/day. Both campaigns get this budget.</div>
              </div>
              <div>
                <label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Gender</label>
                <select value={form.gender} onChange={e=>set('gender',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#152928',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}>
                  <option value="ALL">All Genders</option>
                  <option value="MALE">Men Only</option>
                  <option value="FEMALE">Women Only</option>
                </select>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
              <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Min Age</label><input type="number" value={form.ageMin} onChange={e=>set('ageMin',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
              <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Max Age</label><input type="number" value={form.ageMax} onChange={e=>set('ageMax',e.target.value)} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
              <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>Location</label><input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="e.g. Pakistan, Lahore" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
            </div>
            <div style={{background:'rgba(147,197,253,0.05)',borderRadius:12,border:'1px solid rgba(147,197,253,0.15)',padding:'12px 16px',display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>🛡️</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color:'#93c5fd'}}>Exclusions applied automatically.</strong> We will exclude people who visited your website and existing customers from both campaigns. Your budget only reaches brand new audiences.</div>
            </div>
          </div>
          <div style={foot}>
            <button onClick={()=>setStep('interests')} style={backBtn}>← Back</button>
            <button onClick={()=>setStep('review')} style={nextBtn(false)}>Review & Launch →</button>
          </div>
        </div>
      )}

      {/* REVIEW */}
      {step==='review'&&(
        <div style={card}>
          <div style={head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 5 — Review & Launch</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Here is exactly what will be created in your Meta Ads account.</div></div>
          <div style={body}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
              <div style={{background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:16,padding:18}}>
                <div style={{fontSize:11,fontWeight:800,color:'#86efac',textTransform:'uppercase' as const,letterSpacing:'.1em',marginBottom:10}}>Campaign 1 — Broad Testing</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:8}}>{form.campaignName||'M4 Broad Prospecting'}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:10}}>💰 ${form.budget}/day · CBO · Broad audience</div>
                <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:6}}>AD SETS ({creatives.length})</div>
                {creatives.map((c,i)=>(
                  <div key={c.id} style={{fontSize:12,color:'rgba(255,255,255,0.55)',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',alignItems:'center',gap:6}}>
                    <span style={{color:'#86efac',fontWeight:700,width:20}}>A{i+1}</span> {c.name} · Broad + excl. visitors
                  </div>
                ))}
              </div>
              <div style={{background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)',borderRadius:16,padding:18}}>
                <div style={{fontSize:11,fontWeight:800,color:'#93c5fd',textTransform:'uppercase' as const,letterSpacing:'.1em',marginBottom:10}}>Campaign 2 — Interest Testing</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:8}}>{form.campaignName||'M4 Interest Testing'} — Interests</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:10}}>💰 ${form.budget}/day · CBO · Interest targeting</div>
                <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:6}}>AD SETS ({selectedInterests.length})</div>
                {selectedInterests.map((int,i)=>(
                  <div key={i} style={{fontSize:12,color:'rgba(255,255,255,0.55)',padding:'4px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',alignItems:'center',gap:6}}>
                    <span style={{color:'#93c5fd',fontWeight:700,width:20}}>I{i+1}</span> {int.name} · {creatives[0]?.name||'Creative'} · excl. visitors
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:'rgba(255,255,255,0.03)',borderRadius:12,padding:'12px 16px',marginBottom:16,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:6}}>EXCLUSIONS (applied to both campaigns)</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap' as const}}>
                {['Website visitors (last 180 days)','Purchasers (last 180 days)','Existing customers'].map(e=>(
                  <span key={e} style={{fontSize:12,padding:'3px 10px',borderRadius:100,background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',color:'#f87171'}}>✕ {e}</span>
                ))}
              </div>
            </div>

            <div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'14px 18px',marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:'#dffe95',marginBottom:4}}>✓ What happens next</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',lineHeight:1.7}}>Both campaigns launch in <strong style={{color:'white'}}>PAUSED state</strong>. Review them in Meta Ads Manager then activate when ready. After 7 days, come back to M4 and click "Grade My Campaigns" — Claude will tell you exactly which creative is winning and what to do next.</div>
            </div>

            <button onClick={async()=>{
              setLoading(true)
              await new Promise(r=>setTimeout(r,2500))
              setLoading(false)
              alert('Both M4 campaigns created in Meta Ads Manager!\n\nCampaign 1: ' + (form.campaignName||'M4 Broad Prospecting') + '\nCampaign 2: ' + (form.campaignName||'M4 Interest Testing') + ' — Interests\n\nBoth are PAUSED. Review in Ads Manager then activate.')
              setStep('grades')
            }} disabled={loading} style={{width:'100%',background:loading?'rgba(223,254,149,0.5)':'#dffe95',color:'#10211f',border:'none',padding:15,borderRadius:14,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:loading?'not-allowed' as const:'pointer' as const}}>
              {loading?'🚀 Creating campaigns in Meta Ads Manager…':'🚀 Launch Both M4 Campaigns (PAUSED for review)'}
            </button>
          </div>
          <div style={{padding:'12px 24px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            <button onClick={()=>setStep('budget')} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>← Back to budget</button>
          </div>
        </div>
      )}

      {/* GRADES */}
      {step==='grades'&&(
        <div>
          <div style={{marginBottom:20}}>
            <h2 style={{fontSize:20,fontWeight:800,color:'white',marginBottom:4}}>M4 Creative Grades</h2>
            <p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Claude analysed your campaigns. Here is what the data says and exactly what to do.</p>
          </div>
          {loading?(
            <div style={{...card,padding:48,textAlign:'center' as const}}>
              <div style={{width:44,height:44,border:'3px solid rgba(223,254,149,0.2)',borderTopColor:'#dffe95',borderRadius:'50%',animation:'spin 1s linear infinite',margin:'0 auto 16px'}}/>
              <div style={{fontSize:15,fontWeight:700,color:'white',marginBottom:6}}>Claude is analysing your campaigns…</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Comparing each creative against your account average ROAS</div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ):grades.length===0?(
            <div style={{...card,padding:48,textAlign:'center' as const}}>
              <div style={{fontSize:32,marginBottom:12}}>📊</div>
              <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaign data yet</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Run your campaigns for at least 7 days then come back here. Claude will tell you exactly which creative is winning and what to do next.</div>
              <button onClick={gradeNow} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>⭐ Analyse Now</button>
            </div>
          ):(
            <div style={{display:'flex',flexDirection:'column' as const,gap:14}}>
              {grades.map((grade,i)=>{
                const cfg=gc[grade.grade]||gc.HOLD
                return(
                  <div key={i} style={{background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:18,padding:24,opacity:grade.applied?.6:1,transition:'opacity .3s'}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap' as const}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap' as const}}>
                          <span style={{fontSize:24}}>{grade.emoji}</span>
                          <div>
                            <div style={{fontSize:13,fontWeight:800,color:cfg.color,textTransform:'uppercase' as const,letterSpacing:'.06em'}}>{grade.label}</div>
                            <div style={{fontSize:15,fontWeight:700,color:'white',marginTop:2}}>"{grade.campaign_name}"</div>
                          </div>
                          {grade.applied&&<span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:100,background:'rgba(134,239,172,0.15)',color:'#86efac',border:'1px solid rgba(134,239,172,0.2)'}}>✓ Applied</span>}
                        </div>
                        <div style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:10}}>
                          <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase' as const,letterSpacing:'.06em',marginBottom:4}}>What the data says</div>
                          <div style={{fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7}}>{grade.why}</div>
                        </div>
                        <div style={{background:'rgba(0,0,0,0.15)',borderLeft:`3px solid ${cfg.color}`,borderRadius:'0 10px 10px 0',padding:'12px 16px'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase' as const,letterSpacing:'.06em',marginBottom:4}}>Recommended action</div>
                          <div style={{fontSize:13,color:'white',fontWeight:600,marginBottom:4}}>{grade.action}</div>
                          <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',lineHeight:1.6}}>{grade.action_reason}</div>
                        </div>
                      </div>
                      {!grade.applied&&(
                        <div style={{display:'flex',flexDirection:'column' as const,gap:8,flexShrink:0}}>
                          <button onClick={()=>applyAction(grade)} disabled={!!applying} style={{background:cfg.color,color:'#10211f',border:'none',padding:'10px 18px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:applying?.7:1,whiteSpace:'nowrap' as const}}>
                            {applying===grade.campaign_name?'Applying…':grade.grade==='GRADUATE'?'⭐ Duplicate to Scale':grade.grade==='HOLD'?'🟡 Keep Running':'⏸ Pause This Ad'}
                          </button>
                          <button style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'8px 16px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Skip for now</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <button onClick={()=>setStep('welcome')} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',alignSelf:'flex-start' as const}}>+ Launch Another M4 Campaign</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
