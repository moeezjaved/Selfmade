'use client'
import { useState } from 'react'

type Step = 'welcome' | 'pixel' | 'creatives' | 'interests' | 'budget' | 'review' | 'grades'
interface Creative { id: string; name: string; pack: number; type?: string; base64?: string; mimeType?: string }
interface Interest { name: string; category: string; why: string; size: string; confidence: number; selected: boolean; custom?: boolean }
interface Grade { campaign_name: string; grade: string; emoji: string; label: string; why: string; action: string; action_reason: string; applied?: boolean }

const S = {
  input: {width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'white',fontSize:14,fontFamily:'inherit',outline:'none'} as React.CSSProperties,
  label: {display:'block',fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'} as React.CSSProperties,
  card: {background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,overflow:'hidden'} as React.CSSProperties,
  head: {padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'} as React.CSSProperties,
  body: {padding:24} as React.CSSProperties,
  foot: {padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between'} as React.CSSProperties,
  back: {background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'} as React.CSSProperties,
}

import React from 'react'

export default function M4Page() {
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Grade[]>([])
  const [interests, setInterests] = useState<Interest[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [applying, setApplying] = useState<string|null>(null)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [pixelChoice, setPixelChoice] = useState<'existing'|'new'|null>(null)
  const [pages, setPages] = useState<{id:string,name:string,category:string}[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [adCopy, setAdCopy] = useState({primaryText:'',headline:'',cta:'SHOP_NOW',destinationUrl:''})
  const [pixelId, setPixelId] = useState('')
  const [pixels, setPixels] = useState<{id:string,name:string,active:boolean}[]>([])
  const [loadingPixels, setLoadingPixels] = useState(false)
  const [audiences, setAudiences] = useState<{key:string,id:string,name:string}[]>([])
  const [creatingAudiences, setCreatingAudiences] = useState(false)
  const [accountCurrency, setAccountCurrency] = useState('USD')

  const [form, setForm] = useState({
    product:'', description:'', competitors:'', targetCustomer:'',
    location:'', ageMin:'18', ageMax:'65', gender:'ALL',
    budget:'50', campaignName:'', objective:'OUTCOME_SALES',
  })

  const set = (k: string, v: string) => setForm(p => ({...p, [k]: v}))
  const selectedInterests = interests.filter(i => i.selected)
  const STEPS: Step[] = ['welcome','pixel','creatives','interests','budget','review','grades']

  const gradeColors: Record<string,{bg:string,border:string,color:string}> = {
    GRADUATE: {bg:'rgba(134,239,172,.08)',border:'rgba(134,239,172,.25)',color:'#86efac'},
    HOLD: {bg:'rgba(251,191,36,.08)',border:'rgba(251,191,36,.2)',color:'#fbbf24'},
    CATCHY_NOT_CONVERTING: {bg:'rgba(248,113,113,.08)',border:'rgba(248,113,113,.2)',color:'#f87171'},
    PAUSE_POOR: {bg:'rgba(248,113,113,.06)',border:'rgba(248,113,113,.15)',color:'#f87171'},
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files||[]).forEach(file => {
      const reader = new FileReader()
      const id = Date.now().toString() + Math.random()
      const type = file.type.startsWith('video') ? 'video' : 'image'
      const mimeType = file.type
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string)?.split(',')[1]
        setCreatives(prev => [...prev, {id, name:file.name.replace(/\.[^.]+$/,''), pack:1, type, base64, mimeType}])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  React.useEffect(() => {
    fetch('/api/meta/accounts').then(r=>r.json()).then(d => {
      const primary = d.accounts?.find((a:any)=>a.is_primary)
      if (primary?.currency) setAccountCurrency(primary.currency)
    }).catch(()=>{})
  }, [])

  const fetchPixels = async () => {
    setLoadingPixels(true)
    try { const d = await fetch('/api/m4/pixels').then(r=>r.json()); setPixels(d.pixels||[]) } catch {}
    setLoadingPixels(false)
  }

  const fetchPages = async () => {
    try { const d = await fetch('/api/m4/pages').then(r=>r.json()); setPages(d.pages||[]); if(d.pages?.[0]) setSelectedPageId(d.pages[0].id) } catch {}
  }

  const createAudiences = async () => {
    if (!pixelId) return
    setCreatingAudiences(true)
    try { const d = await fetch('/api/m4/audiences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pixelId,campaignName:form.campaignName||'M4'})}).then(r=>r.json()); setAudiences(d.created||[]) } catch {}
    setCreatingAudiences(false)
  }

  const generateInterests = async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/m4/interests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:form.product,description:form.description,competitors:form.competitors,targetCustomer:form.targetCustomer})}).then(r=>r.json())
      setInterests((d.interests||[]).map((i:Interest)=>({...i,selected:false})))
    } catch { alert('Failed to generate interests') }
    setLoading(false)
  }

  const gradeNow = async () => {
    setLoading(true)
    try { const d = await fetch('/api/m4/grade',{method:'POST'}).then(r=>r.json()); setGrades(d.grades||[]); setStep('grades') } catch { alert('Failed to grade') }
    setLoading(false)
  }

  const applyAction = async (grade: Grade) => {
    setApplying(grade.campaign_name)
    await new Promise(r=>setTimeout(r,1500))
    setApplying(null)
    setGrades(prev=>prev.map(g=>g.campaign_name===grade.campaign_name?{...g,applied:true}:g))
  }

  const launch = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/m4/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        campaignName:form.campaignName||'M4 Campaign',
        creatives, interests:selectedInterests,
        budget:form.budget, location:form.location,
        ageMin:form.ageMin, ageMax:form.ageMax, gender:form.gender,
        pixelId, objective:form.objective,
        pageId:selectedPageId,
        primaryText:adCopy.primaryText,
        headline:adCopy.headline,
        cta:adCopy.cta,
        websiteUrl:adCopy.destinationUrl,
      })})
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (data.error) { alert('Launch failed: '+data.error) }
      else { alert('✅ Campaigns created in '+data.account+'!\n\n📦 Broad: '+data.broad_adsets+' ad sets\n🎯 Interests: '+data.interest_adsets+' ad sets\n\nAll PAUSED — activate in Meta Ads Manager.'+(data.errors?.length?'\n\n⚠️ '+data.errors.slice(0,2).join('\n'):'')); setStep('grades') }
    } catch(e:any) { alert('Error: '+e.message) }
    setLoading(false)
  }

  const nextBtn = (onClick:()=>void, label:string, disabled=false) => (
    <button onClick={onClick} disabled={disabled} style={{background:disabled?'rgba(223,254,149,0.2)':'#dffe95',color:disabled?'rgba(255,255,255,0.3)':'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:disabled?'not-allowed':'pointer'}}>
      {label}
    </button>
  )

  return (
    <div style={{padding:28,maxWidth:820,margin:'0 auto'}}>

      {/* Progress */}
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:900,color:'#dffe95'}}>M4</div>
          <div><h1 style={{fontSize:22,fontWeight:800,color:'white'}}>M4 Method</h1><p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Find winners → Graduate them → Scale what works</p></div>
        </div>
        <div style={{display:'flex',gap:3}}>
          {STEPS.map((s,i) => <div key={s} style={{flex:1,height:4,borderRadius:100,background:step===s?'#dffe95':STEPS.indexOf(step)>i?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)'}}/>)}
        </div>
      </div>

      {/* WELCOME */}
      {step==='welcome' && (
        <div style={{...S.card,padding:36,position:'relative'}}>
          <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
          <h2 style={{fontSize:24,fontWeight:900,color:'white',marginBottom:10}}>Welcome to M4 — <em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>the smart way to run Meta ads.</em></h2>
          <p style={{fontSize:14,color:'rgba(255,255,255,0.6)',lineHeight:1.8,marginBottom:24}}>Two campaigns, two layers of testing, zero guesswork. Find your winning creative, then find your winning audience.</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:28}}>
            <div style={{background:'rgba(134,239,172,0.06)',border:'1px solid rgba(134,239,172,0.2)',borderRadius:16,padding:20}}>
              <div style={{fontSize:11,fontWeight:800,color:'#86efac',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>Campaign 1 — Broad</div>
              <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:6}}>Find your winning creative</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.65}}>Each ad set = same broad audience + 1 creative. No interest targeting. Meta finds who responds.</div>
            </div>
            <div style={{background:'rgba(147,197,253,0.06)',border:'1px solid rgba(147,197,253,0.2)',borderRadius:16,padding:20}}>
              <div style={{fontSize:11,fontWeight:800,color:'#93c5fd',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>Campaign 2 — Interest</div>
              <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:6}}>Find your winning audience</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.65}}>Each ad set = 1 interest + winning creative. Tells you exactly which audience converts best.</div>
            </div>
          </div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <button onClick={()=>setStep('pixel')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'13px 32px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Start M4 Setup →</button>
            <button onClick={gradeNow} disabled={loading} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'13px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:loading?.6:1}}>
              {loading?'Analysing…':'⭐ Grade My Current Campaigns'}
            </button>
          </div>
        </div>
      )}

      {/* PIXEL */}
      {step==='pixel' && (
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 1 — Product Info & Pixel</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Tell us about your product so Claude can suggest the best audiences.</div></div>
          <div style={S.body}>
            <div style={{marginBottom:14}}><label style={S.label}>Product / Website Name</label><input value={form.product} onChange={e=>set('product',e.target.value)} placeholder="e.g. HairFallSolution.com" style={S.input}/></div>
            <div style={{marginBottom:14}}><label style={S.label}>What do you sell?</label><textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="e.g. DHT-blocking serum for men and women experiencing hair thinning" style={{...S.input,resize:'vertical',minHeight:80,lineHeight:1.6} as React.CSSProperties}></textarea></div>
            <div style={{marginBottom:14}}><label style={S.label}>Competitors</label><input value={form.competitors} onChange={e=>set('competitors',e.target.value)} placeholder="e.g. Minoxidil, Regaine, Foligain" style={S.input}/></div>
            <div style={{marginBottom:14}}><label style={S.label}>Target Customer</label><input value={form.targetCustomer} onChange={e=>set('targetCustomer',e.target.value)} placeholder="e.g. Men and women 25-45 experiencing hair loss" style={S.input}/></div>
            <div style={{marginBottom:20}}><label style={S.label}>Campaign Name</label><input value={form.campaignName} onChange={e=>set('campaignName',e.target.value)} placeholder="e.g. Hair Fall — M4 — Apr 2025" style={S.input}/></div>

            <div style={{marginBottom:8}}><label style={S.label}>Do you have a Meta Pixel?</label></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
              <div onClick={()=>{setPixelChoice('existing');if(pixels.length===0)fetchPixels()}} style={{padding:16,borderRadius:12,border:`2px solid ${pixelChoice==='existing'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='existing'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                <div style={{fontSize:20,marginBottom:6}}>✅</div><div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>Yes, I have a pixel</div><div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Select from your account</div>
              </div>
              <div onClick={()=>setPixelChoice('new')} style={{padding:16,borderRadius:12,border:`2px solid ${pixelChoice==='new'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='new'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                <div style={{fontSize:20,marginBottom:6}}>🆕</div><div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:3}}>No, I need one</div><div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>We will guide you</div>
              </div>
            </div>

            {pixelChoice==='existing' && (
              <div style={{marginBottom:16}}>
                <label style={S.label}>Select Your Pixel</label>
                {loadingPixels ? <div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Loading pixels…</div>
                : pixels.length>0 ? (
                  <select value={pixelId} onChange={e=>setPixelId(e.target.value)} style={{...S.input,background:'#152928'}}>
                    <option value="">Select a pixel…</option>
                    {pixels.map(p=><option key={p.id} value={p.id}>{p.name} — {p.id} {p.active?'✓':''}</option>)}
                  </select>
                ) : <input value={pixelId} onChange={e=>setPixelId(e.target.value)} placeholder="Enter Pixel ID manually" style={S.input}/>}
                {pixelId && audiences.length===0 && (
                  <button onClick={createAudiences} disabled={creatingAudiences} style={{marginTop:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'8px 18px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                    {creatingAudiences?'Creating audiences…':'🛡️ Create Exclusion Audiences'}
                  </button>
                )}
                {audiences.length>0 && <div style={{marginTop:10,fontSize:12,color:'#86efac'}}>✓ {audiences.length} exclusion audiences created</div>}
              </div>
            )}

            {pixelChoice==='new' && (
              <div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:'#dffe95',marginBottom:8}}>How to create a Meta Pixel:</div>
                {['1. Go to Meta Events Manager → Connect Data Sources → Web','2. Choose "Meta Pixel" and name it after your business','3. Copy the Pixel ID','4. Paste it on your website (Shopify: Theme Settings, WordPress: PixelYourSite plugin)','5. Come back and enter the Pixel ID above'].map((s,i)=><div key={i} style={{fontSize:13,color:'rgba(255,255,255,0.65)',marginBottom:6}}>{s}</div>)}
                <a href="https://business.facebook.com/events_manager" target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:8,fontSize:13,fontWeight:700,color:'#dffe95',textDecoration:'none'}}>→ Open Meta Events Manager</a>
              </div>
            )}
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('welcome')} style={S.back}>← Back</button>
            {nextBtn(async()=>{if(interests.length===0)await generateInterests();setStep('creatives')}, loading?'Loading…':'Continue →', !pixelChoice||!form.product||loading)}
          </div>
        </div>
      )}

      {/* CREATIVES */}
      {step==='creatives' && (
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 2 — Upload Creatives & Ad Copy</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each creative = one ad set in your Broad Campaign.</div></div>
          <div style={S.body}>
            <div style={{background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>🖼️</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color:'#86efac'}}>One creative per ad set.</strong> Never mix creatives. This is how M4 finds your winner clearly.</div>
            </div>

            {/* Creative list */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'white',marginBottom:10}}>Your creatives:</div>
              {creatives.length===0 ? (
                <div style={{padding:24,textAlign:'center',border:'2px dashed rgba(255,255,255,0.08)',borderRadius:12,fontSize:13,color:'rgba(255,255,255,0.3)'}}>No creatives yet — upload from your computer below</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:12}}>
                  {creatives.map((c,i) => (
                    <div key={c.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',borderRadius:10,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
                      <div style={{width:28,height:28,borderRadius:7,background:'rgba(223,254,149,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#dffe95',flexShrink:0}}>A{i+1}</div>
                      <input value={c.name} onChange={e=>setCreatives(prev=>prev.map(x=>x.id===c.id?{...x,name:e.target.value}:x))} style={{flex:1,background:'none',border:'none',color:'white',fontSize:14,fontWeight:600,fontFamily:'inherit',outline:'none'}}/>
                      <span style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>{c.type==='video'?'🎬 Video':'🖼 Image'}</span>
                      <button onClick={()=>setCreatives(prev=>prev.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:18,padding:0}}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <label style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'9px 18px',borderRadius:100,fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                  📁 Upload from Computer
                  <input type="file" accept="image/*,video/*" multiple onChange={handleFileUpload} style={{display:'none'}}/>
                </label>
                <button onClick={()=>setCreatives(prev=>[...prev,{id:Date.now().toString(),name:`Creative ${prev.length+1}`,pack:1}])} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)',padding:'9px 18px',borderRadius:100,fontSize:13,fontFamily:'inherit',cursor:'pointer'}}>+ Add Name Only</button>
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 16px',borderRadius:100,background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)'}}>
                  <span style={{fontSize:12,fontWeight:700,color:'#93c5fd'}}>✨ AI Creative Studio</span>
                  <span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:100,background:'rgba(147,197,253,0.15)',color:'#93c5fd'}}>SOON</span>
                </div>
              </div>
            </div>

            {/* Ad Copy */}
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',padding:18,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:800,color:'white',marginBottom:4}}>Ad Copy</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:14}}>This text appears on every ad in your campaign.</div>
              <div style={{marginBottom:12}}><label style={S.label}>Primary Text</label><textarea value={adCopy.primaryText} onChange={e=>setAdCopy(p=>({...p,primaryText:e.target.value}))} placeholder="e.g. Tired of hair fall? Our serum works in 4 weeks. 30-day guarantee." style={{...S.input,resize:'vertical',minHeight:80,lineHeight:1.6} as React.CSSProperties}></textarea></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div><label style={S.label}>Headline</label><input value={adCopy.headline} onChange={e=>setAdCopy(p=>({...p,headline:e.target.value}))} placeholder="e.g. Stop Hair Fall in 4 Weeks" style={S.input}/></div>
                <div><label style={S.label}>Call to Action</label>
                  <select value={adCopy.cta} onChange={e=>setAdCopy(p=>({...p,cta:e.target.value}))} style={{...S.input,background:'#152928'}}>
                    {['SHOP_NOW','LEARN_MORE','GET_OFFER','SIGN_UP','CONTACT_US','ORDER_NOW','GET_QUOTE','SUBSCRIBE','DOWNLOAD','BOOK_NOW'].map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                  </select>
                </div>
              </div>
              <div><label style={S.label}>Destination URL (where people land when they click)</label><input value={adCopy.destinationUrl} onChange={e=>setAdCopy(p=>({...p,destinationUrl:e.target.value}))} placeholder="https://yourwebsite.com/product" style={S.input}/></div>
            </div>

            {/* Facebook Page */}
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',padding:16}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div><div style={{fontSize:13,fontWeight:800,color:'white'}}>Facebook Page</div><div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>Required — all ads run from your Facebook Page</div></div>
                {pages.length===0 && <button onClick={fetchPages} style={{background:'rgba(147,197,253,0.1)',border:'1px solid rgba(147,197,253,0.2)',color:'#93c5fd',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>Load My Pages</button>}
              </div>
              {pages.length>0 && <select value={selectedPageId} onChange={e=>setSelectedPageId(e.target.value)} style={{...S.input,background:'#152928'}}>{pages.map(p=><option key={p.id} value={p.id}>{p.name} — {p.category}</option>)}</select>}
              {pages.length===0 && <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',marginTop:6}}>Click "Load My Pages" to see your connected Facebook pages</div>}
            </div>
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('pixel')} style={S.back}>← Back</button>
            {nextBtn(()=>setStep('interests'), `Choose Interests (${creatives.length} creative${creatives.length!==1?'s':''}) →`, creatives.length<1)}
          </div>
        </div>
      )}

      {/* INTERESTS */}
      {step==='interests' && (
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 3 — Select Interests for Campaign 2</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Each interest = one ad set. Pick at least 2.</div></div>
          <div style={S.body}>
            <div style={{background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>🎯</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color:'#93c5fd'}}>One interest per ad set.</strong> Mixing interests hides what is working. One interest per ad set means you know exactly which audience converts — so you scale winners and pause losers.</div>
            </div>
            {interests.length===0 ? (
              <div style={{textAlign:'center',padding:32}}>
                <button onClick={generateInterests} disabled={loading} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'12px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:loading?.7:1}}>
                  {loading?'✦ Claude is thinking…':'✦ Generate Interest Suggestions'}
                </button>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {interests.map((interest,i) => (
                  <div key={i} onClick={()=>setInterests(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{padding:16,borderRadius:14,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.08)'}`,background:interest.selected?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:14}}>
                    <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.2)'}`,background:interest.selected?'#dffe95':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#10211f',flexShrink:0,marginTop:2}}>{interest.selected?'✓':''}</div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                        <span style={{fontSize:14,fontWeight:700,color:'white'}}>{interest.name}</span>
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em'}}>{interest.category}</span>
                        {interest.custom && <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'rgba(223,254,149,0.1)',color:'#dffe95'}}>Custom</span>}
                      </div>
                      <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>{interest.why}</div>
                    </div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',flexShrink:0,textAlign:'right'}}><div>{interest.size}</div><div style={{color:interest.confidence>80?'#86efac':'#fbbf24',marginTop:2}}>{interest.confidence}%</div></div>
                  </div>
                ))}
                <div style={{display:'flex',gap:8,marginTop:4}}>
                  <input value={customInterest} onChange={e=>setCustomInterest(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(setInterests(prev=>[...prev,{name:customInterest.trim(),category:'Custom',why:'Added by you.',size:'Unknown',confidence:70,selected:true,custom:true}]),setCustomInterest(''))} placeholder="Add your own interest…" style={{flex:1,...S.input}}/>
                  <button onClick={()=>{if(customInterest.trim()){setInterests(prev=>[...prev,{name:customInterest.trim(),category:'Custom',why:'Added by you.',size:'Unknown',confidence:70,selected:true,custom:true}]);setCustomInterest('')}}} style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'10px 18px',borderRadius:10,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>+ Add</button>
                </div>
              </div>
            )}
          </div>
          <div style={S.foot}>
            <div><button onClick={()=>setStep('creatives')} style={S.back}>← Back</button><span style={{marginLeft:14,fontSize:13,color:'rgba(255,255,255,0.4)'}}>{selectedInterests.length} selected</span></div>
            {nextBtn(()=>setStep('budget'), `Set Budget (${selectedInterests.length} interests) →`, selectedInterests.length<2)}
          </div>
        </div>
      )}

      {/* BUDGET */}
      {step==='budget' && (
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 4 — Budget & Targeting</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Set your campaign budget and who you want to reach.</div></div>
          <div style={S.body}>
            {/* Objective */}
            <div style={{marginBottom:20}}>
              <label style={S.label}>Campaign Goal</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[{id:'OUTCOME_SALES',icon:'🛒',title:'Sales / Purchases'},{id:'OUTCOME_LEADS',icon:'🎯',title:'Lead Generation'},{id:'OUTCOME_TRAFFIC',icon:'🌐',title:'Website Traffic'},{id:'OUTCOME_AWARENESS',icon:'📢',title:'Brand Awareness'}].map(o=>(
                  <div key={o.id} onClick={()=>set('objective',o.id)} style={{padding:12,borderRadius:12,border:`2px solid ${form.objective===o.id?'#dffe95':'rgba(255,255,255,0.08)'}`,background:form.objective===o.id?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                    <span style={{fontSize:20}}>{o.icon}</span><span style={{fontSize:13,fontWeight:700,color:'white'}}>{o.title}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
              <div><label style={S.label}>Daily Budget per Campaign ({accountCurrency})</label>
                <div style={{position:'relative'}}><span style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.5)'}}>$</span><input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} style={{...S.input,paddingLeft:28}}/></div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>Min $10/day recommended. Both campaigns share this budget.</div>
              </div>
              <div><label style={S.label}>Gender</label>
                <select value={form.gender} onChange={e=>set('gender',e.target.value)} style={{...S.input,background:'#152928'}}>
                  <option value="ALL">All Genders</option><option value="MALE">Men Only</option><option value="FEMALE">Women Only</option>
                </select>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
              <div><label style={S.label}>Min Age</label><input type="number" value={form.ageMin} onChange={e=>set('ageMin',e.target.value)} style={S.input}/></div>
              <div><label style={S.label}>Max Age</label><input type="number" value={form.ageMax} onChange={e=>set('ageMax',e.target.value)} style={S.input}/></div>
              <div><label style={S.label}>Location</label><input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="e.g. PK, Lahore, US" style={S.input}/></div>
            </div>
            <div style={{background:'rgba(147,197,253,0.05)',borderRadius:12,border:'1px solid rgba(147,197,253,0.15)',padding:'12px 16px',display:'flex',gap:12}}>
              <span style={{fontSize:20,flexShrink:0}}>🛡️</span>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color:'#93c5fd'}}>Exclusions applied automatically.</strong> We exclude website visitors and existing customers from both campaigns. Your budget only reaches brand new audiences.</div>
            </div>
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('interests')} style={S.back}>← Back</button>
            {nextBtn(()=>setStep('review'), 'Review & Launch →')}
          </div>
        </div>
      )}

      {/* REVIEW */}
      {step==='review' && (
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'white'}}>Step 5 — Review & Launch</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:3}}>Here is exactly what will be created in your Meta account.</div></div>
          <div style={S.body}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
              <div style={{background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:16,padding:18}}>
                <div style={{fontSize:11,fontWeight:800,color:'#86efac',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>Campaign 1 — Broad</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:6}}>{form.campaignName||'M4 Broad'}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:8}}>💰 ${form.budget}/day · {form.objective.replace('OUTCOME_','')}</div>
                <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:6}}>AD SETS ({creatives.length})</div>
                {creatives.map((c,i)=><div key={c.id} style={{fontSize:12,color:'rgba(255,255,255,0.55)',padding:'3px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><span style={{color:'#86efac',fontWeight:700,marginRight:6}}>A{i+1}</span>{c.name}</div>)}
              </div>
              <div style={{background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)',borderRadius:16,padding:18}}>
                <div style={{fontSize:11,fontWeight:800,color:'#93c5fd',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>Campaign 2 — Interests</div>
                <div style={{fontSize:14,fontWeight:700,color:'white',marginBottom:6}}>{form.campaignName||'M4 Interests'}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:8}}>💰 ${form.budget}/day · {form.objective.replace('OUTCOME_','')}</div>
                <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:6}}>AD SETS ({selectedInterests.length})</div>
                {selectedInterests.map((int,i)=><div key={i} style={{fontSize:12,color:'rgba(255,255,255,0.55)',padding:'3px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><span style={{color:'#93c5fd',fontWeight:700,marginRight:6}}>I{i+1}</span>{int.name}</div>)}
              </div>
            </div>

            <div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:12,padding:'14px 18px',marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:'#dffe95',marginBottom:4}}>✓ What happens next</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',lineHeight:1.7}}>Both campaigns launch <strong style={{color:'white'}}>PAUSED</strong>. Review in Meta Ads Manager then activate. After 7 days, come back and click "Grade My Campaigns" — Claude will tell you exactly what to do.</div>
            </div>

            <button onClick={launch} disabled={loading} style={{width:'100%',background:loading?'rgba(223,254,149,0.5)':'#dffe95',color:'#10211f',border:'none',padding:15,borderRadius:14,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:loading?'not-allowed':'pointer'}}>
              {loading?'🚀 Creating in Meta Ads Manager…':'🚀 Launch Both M4 Campaigns (PAUSED for review)'}
            </button>
          </div>
          <div style={{padding:'12px 24px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            <button onClick={()=>setStep('budget')} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>← Back to budget</button>
          </div>
        </div>
      )}

      {/* GRADES */}
      {step==='grades' && (
        <div>
          <div style={{marginBottom:20}}>
            <h2 style={{fontSize:20,fontWeight:800,color:'white',marginBottom:4}}>M4 Creative Grades</h2>
            <p style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>Claude analysed your campaigns using M4 logic. Here is what to do.</p>
          </div>
          {loading ? (
            <div style={{...S.card,padding:48,textAlign:'center'}}>
              <div style={{width:44,height:44,border:'3px solid rgba(223,254,149,0.2)',borderTopColor:'#dffe95',borderRadius:'50%',animation:'spin 1s linear infinite',margin:'0 auto 16px'}}/>
              <div style={{fontSize:15,fontWeight:700,color:'white'}}>Analysing campaigns…</div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : grades.length===0 ? (
            <div style={{...S.card,padding:48,textAlign:'center'}}>
              <div style={{fontSize:32,marginBottom:12}}>📊</div>
              <div style={{fontSize:16,fontWeight:700,color:'white',marginBottom:8}}>No campaign data yet</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:20}}>Run your campaigns for at least 7 days then come back here.</div>
              <button onClick={gradeNow} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>⭐ Analyse Now</button>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {grades.map((grade,i) => {
                const cfg = gradeColors[grade.grade]||gradeColors.HOLD
                return (
                  <div key={i} style={{background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:18,padding:24,opacity:grade.applied?.6:1}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
                          <span style={{fontSize:24}}>{grade.emoji}</span>
                          <div><div style={{fontSize:13,fontWeight:800,color:cfg.color,textTransform:'uppercase',letterSpacing:'.06em'}}>{grade.label}</div><div style={{fontSize:15,fontWeight:700,color:'white',marginTop:2}}>"{grade.campaign_name}"</div></div>
                          {grade.applied && <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:100,background:'rgba(134,239,172,0.15)',color:'#86efac',border:'1px solid rgba(134,239,172,0.2)'}}>✓ Applied</span>}
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
                      {!grade.applied && (
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
              <button onClick={()=>setStep('welcome')} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#dffe95',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',alignSelf:'flex-start'}}>+ Launch Another M4 Campaign</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
