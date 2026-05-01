'use client'
import React, { useState } from 'react'

type Step = 'welcome' | 'pixel' | 'creatives' | 'retargeting' | 'interests' | 'budget' | 'review' | 'grades'
interface Creative { id: string; name: string; pack: number; type?: string; hash?: string; uploading?: boolean; uploaded?: boolean; mimeType?: string }
interface Interest { name: string; category: string; why: string; size: string; confidence: number; selected: boolean; custom?: boolean }
interface Grade { campaign_name: string; grade: string; emoji: string; label: string; why: string; action: string; action_reason: string; applied?: boolean }

const S = {
  input: {width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'} as React.CSSProperties,
  label: {display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6,textTransform:'uppercase',letterSpacing:'.06em'} as React.CSSProperties,
  card: {background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:20,overflow:'hidden'} as React.CSSProperties,
  head: {padding:'20px 24px',borderBottom:'1px solid rgba(223,254,149,0.08)'} as React.CSSProperties,
  body: {padding:24} as React.CSSProperties,
  foot: {padding:'16px 24px',borderTop:'1px solid rgba(255,255,255,0.04)',display:'flex',justifyContent:'space-between'} as React.CSSProperties,
  back: {background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'#7a9a7a',padding:'10px 22px',borderRadius:100,fontSize:14,fontFamily:'inherit',cursor:'pointer'} as React.CSSProperties,
}


// Location picker with Meta API search
function LocationPicker({selected, onChange}: {selected: any[], onChange: (v: any[]) => void}) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)

  const search = async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/m4/locations?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results || [])
    } catch(e) {}
    setLoading(false)
  }

  React.useEffect(() => {
    const t = setTimeout(() => search(query), 400)
    return () => clearTimeout(t)
  }, [query])

  const add = (loc: any) => {
    if (!selected.find((s:any) => s.key === loc.key)) {
      onChange([...selected, loc])
    }
    setQuery('')
    setResults([])
  }

  const remove = (key: string) => onChange(selected.filter((s:any) => s.key !== key))

  const typeLabel = (type: string) => {
    if (type === 'country') return '🌍'
    if (type === 'city') return '🏙'
    if (type === 'region') return '📍'
    if (type === 'zip') return '📮'
    return '📍'
  }

  return (
    <div style={{position:'relative'}}>
      {/* Selected locations */}
      {selected.length > 0 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
          {selected.map((loc:any) => (
            <span key={loc.key} style={{display:'inline-flex',alignItems:'center',gap:4,background:'#1a3a1a',color:'#dffe95',padding:'3px 10px',borderRadius:100,fontSize:11,fontWeight:700}}>
              {typeLabel(loc.type)} {loc.name}{loc.country_code ? `, ${loc.country_code}` : ''}
              <button onClick={()=>remove(loc.key)} style={{background:'none',border:'none',color:'#dffe95',cursor:'pointer',fontSize:12,padding:0,lineHeight:1}}>×</button>
            </span>
          ))}
        </div>
      )}
      {/* Search input */}
      <input
        value={query}
        onChange={e=>setQuery(e.target.value)}
        placeholder="Search country, city, region..."
        style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid rgba(0,0,0,0.1)',fontSize:13,fontFamily:'inherit',outline:'none',background:'#ffffff',color:'#1a3a1a',boxSizing:'border-box' as any}}
      />
      {/* Results dropdown */}
      {(results.length > 0 || loading) && (
        <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid rgba(0,0,0,0.1)',borderRadius:10,marginTop:4,zIndex:100,maxHeight:200,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.1)'}}>
          {loading && <div style={{padding:'10px 14px',fontSize:12,color:'#8aaa8a'}}>Searching...</div>}
          {results.map((r:any) => (
            <button key={r.key} onClick={()=>add(r)} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:'10px 14px',background:'none',border:'none',cursor:'pointer',textAlign:'left',borderBottom:'1px solid rgba(0,0,0,0.04)'}}>
              <span style={{fontSize:14}}>{typeLabel(r.type)}</span>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'#1a3a1a'}}>{r.name}</div>
                <div style={{fontSize:11,color:'#8aaa8a'}}>{r.type}{r.country_name ? ` · ${r.country_name}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {selected.length === 0 && query.length === 0 && (
        <div style={{fontSize:11,color:'#8aaa8a',marginTop:4}}>Search and add multiple countries, cities, or regions</div>
      )}
    </div>
  )
}

export default function M4Page() {
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Grade[]>([])
  const [interests, setInterests] = useState<Interest[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [applying, setApplying] = useState<string|null>(null)
  const [scaling, setScaling] = useState<string|null>(null)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [retargetingCreatives, setRetargetingCreatives] = useState<Creative[]>([])
  const [retainerCreatives, setRetainerCreatives] = useState<Creative[]>([])
  const [pixelChoice, setPixelChoice] = useState<'existing'|'new'|null>(null)
  const [pages, setPages] = useState<{id:string,name:string,category:string,instagram?:{id:string,username:string}|null}[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [selectedInstagramId, setSelectedInstagramId] = useState('')
  const [adCopy, setAdCopy] = useState({primaryText:'',headline:'',cta:'SHOP_NOW',destinationUrl:''})
  const [retargetingCopy, setRetargetingCopy] = useState({primaryText:'',headline:'',cta:'SHOP_NOW',destinationUrl:''})
  const [retainerCopy, setRetainerCopy] = useState({primaryText:'',headline:'',cta:'SHOP_NOW',destinationUrl:''})
  const [includeRetainer, setIncludeRetainer] = useState(false)
  const [pixelId, setPixelId] = useState('')
  const [pixels, setPixels] = useState<{id:string,name:string,active:boolean}[]>([])
  const [loadingPixels, setLoadingPixels] = useState(false)
  const [accountCurrency, setAccountCurrency] = useState('USD')
  const [genCopy, setGenCopy] = useState<'main'|'retargeting'|'retainer'|null>(null)
  const [form, setForm] = useState({
    product:'', description:'',
    competitorDomains:'', competitorFBPages:'', competitorIGHandles:'',
    targetCustomer:'', location:'', locations:[] as any[], ageMin:'18', ageMax:'65', gender:'ALL',
    budget:'500', campaignName:'', objective:'OUTCOME_SALES',
  })

  const set = (k: string, v: string) => setForm(p => ({...p, [k]: v}))
  const selectedInterests = interests.filter(i => i.selected)
  const STEPS: Step[] = ['welcome','pixel','creatives','retargeting','interests','budget','review','grades']
  const gc: Record<string,{bg:string,border:string,color:string}> = {
    GRADUATE:{bg:'rgba(134,239,172,.08)',border:'rgba(134,239,172,.25)',color:'#2d7a2d'},
    HOLD:{bg:'rgba(251,191,36,.08)',border:'rgba(251,191,36,.2)',color:'#fbbf24'},
    CATCHY_NOT_CONVERTING:{bg:'rgba(248,113,113,.08)',border:'rgba(248,113,113,.2)',color:'#c0392b'},
    PAUSE_POOR:{bg:'rgba(248,113,113,.06)',border:'rgba(248,113,113,.15)',color:'#c0392b'},
  }

  React.useEffect(()=>{
    fetch('/api/meta/accounts').then(r=>r.json()).then(d=>{const p=d.accounts?.find((a:any)=>a.is_primary);if(p?.currency)setAccountCurrency(p.currency)}).catch(()=>{})
    fetch('/api/m4/pages').then(r=>r.json()).then(d=>{setPages(d.pages||[]);if(d.pages?.[0]){setSelectedPageId(d.pages[0].id);if(d.pages[0].instagram?.id)setSelectedInstagramId(d.pages[0].instagram.id)}}).catch(()=>{})
  },[])

  const uploadFile = async (file: File, setter: React.Dispatch<React.SetStateAction<Creative[]>>) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2,9)
    const isVid = file.type.startsWith('video/')
    setter(prev=>[...prev,{id,name:file.name.replace(/\.[^.]+$/,''),pack:1,type:isVid?'video':'image',mimeType:file.type,uploading:true}])
    if (isVid && file.size > 5242880) {
      alert('Video too large — max 5MB. For larger videos, add directly in Meta Ads Manager.')
      setter(prev=>prev.filter(x=>x.id!==id))
      return
    }
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string)?.split(',')[1]
      try {
        const res = await fetch('/api/m4/upload-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64,mimeType:file.type,name:file.name,isVideo:isVid})})
        const data = await res.json()
        setter(prev=>prev.map(x=>x.id===id?{...x,hash:data.hash||data.videoId,uploading:false,uploaded:!!(data.hash||data.videoId)}:x))
      } catch { setter(prev=>prev.map(x=>x.id===id?{...x,uploading:false}:x)) }
    }
    reader.readAsDataURL(file)
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<Creative[]>>) => {
    Array.from(e.target.files||[]).forEach(f=>uploadFile(f,setter))
    e.target.value=''
  }

  const fetchPixels = async () => {
    setLoadingPixels(true)
    try{const d=await fetch('/api/m4/pixels').then(r=>r.json());setPixels(d.pixels||[])}catch{}
    setLoadingPixels(false)
  }

  const generateInterests = async () => {
    setLoading(true)
    try{const d=await fetch('/api/m4/interests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:form.product,description:form.description,competitorDomains:form.competitorDomains,competitorFBPages:form.competitorFBPages,competitorIGHandles:form.competitorIGHandles,targetCustomer:form.targetCustomer})}).then(r=>r.json());setInterests((d.interests||[]).map((i:Interest)=>({...i,selected:false})))}catch{alert('Failed to generate interests')}
    setLoading(false)
  }

  const generateCopy = async (type: 'main'|'retargeting'|'retainer') => {
    setGenCopy(type)
    try{
      const d=await fetch('/api/m4/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:form.product,description:form.description,targetCustomer:form.targetCustomer,type})}).then(r=>r.json())
      if(type==='main')setAdCopy(p=>({...p,primaryText:d.primaryText||p.primaryText,headline:d.headline||p.headline}))
      if(type==='retargeting')setRetargetingCopy(p=>({...p,primaryText:d.primaryText||p.primaryText,headline:d.headline||p.headline}))
      if(type==='retainer')setRetainerCopy(p=>({...p,primaryText:d.primaryText||p.primaryText,headline:d.headline||p.headline}))
    }catch{}
    setGenCopy(null)
  }

  const gradeNow = async () => {
    setLoading(true)
    try{const d=await fetch('/api/m4/grade',{method:'POST'}).then(r=>r.json());setGrades(d.grades||[]);setStep('grades')}catch{alert('Failed')}
    setLoading(false)
  }

  const scaleWinner = async (grade: Grade) => {
    setScaling(grade.campaign_name)
    try{
      const res=await fetch('/api/m4/scale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignName:grade.campaign_name,product:form.product,description:form.description,competitorDomains:form.competitorDomains})})
      const data=await res.json()
      if(data.error)alert('Scale failed: '+data.error)
      else{alert('Scaled! Duplicate created with 2x budget. '+data.new_interests+' new interests added.');setGrades(prev=>prev.map(g=>g.campaign_name===grade.campaign_name?{...g,applied:true}:g))}
    }catch(e:any){alert('Error: '+e.message)}
    setScaling(null)
  }

  const applyAction = async (grade: Grade) => {
    if(grade.grade==='GRADUATE'){await scaleWinner(grade);return}
    setApplying(grade.campaign_name)
    await new Promise(r=>setTimeout(r,1500))
    setApplying(null)
    setGrades(prev=>prev.map(g=>g.campaign_name===grade.campaign_name?{...g,applied:true}:g))
  }

  const launch = async () => {
    setLoading(true)
    try{
      const res=await fetch('/api/m4/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignName:form.campaignName||'M4',creatives,retargetingCreatives,retainerCreatives,interests:selectedInterests,budget:form.budget,location:form.location,ageMin:form.ageMin,ageMax:form.ageMax,gender:form.gender,pixelId,objective:form.objective,pageId:selectedPageId,instagramActorId:selectedInstagramId,primaryText:adCopy.primaryText,headline:adCopy.headline,cta:adCopy.cta,websiteUrl:adCopy.destinationUrl,retargetingCopy,retainerCopy,includeRetainer})})
      const data=await res.json()
      if(data.error)alert('Launch failed: '+data.error)
      else{alert('LAUNCHED in '+data.account+'!\n\nBroad: '+data.broad_adsets+' ad sets\nInterest: '+data.interest_adsets+' ad sets\nRetargeting: '+(data.retargeting_adsets||0)+' ad sets\n'+(includeRetainer?'Retainer: '+(data.retainer_adsets||0)+' ad sets\n':'')+'\nAll PAUSED. Activate in Meta Ads Manager.');setStep('grades')}
    }catch(e:any){alert('Error: '+e.message)}
    setLoading(false)
  }

  const CopyBox = ({copy,setCopy,type,title}:{copy:any,setCopy:any,type:'main'|'retargeting'|'retainer',title:string}) => (
    <div style={{background:'#f8fcf6',borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',padding:18,marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:800,color:'#1a3a1a'}}>{title}</div>
        <button onClick={()=>generateCopy(type)} disabled={genCopy!==null||!form.product} style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(74,138,0,0.2)',color:'#1a3a1a',padding:'6px 14px',borderRadius:100,fontSize:12,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:genCopy!==null||!form.product?0.5:1}}>
          {genCopy===type?'Writing…':'AI Write'}
        </button>
      </div>
      <div style={{marginBottom:10}}><label style={S.label}>Primary Text</label><textarea value={copy.primaryText} onChange={e=>setCopy((p:any)=>({...p,primaryText:e.target.value}))} placeholder="Your ad copy..." style={{...S.input,resize:'vertical',minHeight:70,lineHeight:1.6} as React.CSSProperties}></textarea></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div><label style={S.label}>Headline</label><input value={copy.headline} onChange={e=>setCopy((p:any)=>({...p,headline:e.target.value}))} placeholder="Punchy headline" style={S.input}/></div>
        <div><label style={S.label}>CTA</label><select value={copy.cta} onChange={e=>setCopy((p:any)=>({...p,cta:e.target.value}))} style={{...S.input,background:'#ffffff'}}>
          {['SHOP_NOW','LEARN_MORE','GET_OFFER','SIGN_UP','ORDER_NOW','BOOK_NOW','CONTACT_US','SUBSCRIBE'].map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
        </select></div>
      </div>
      <div><label style={S.label}>Destination URL</label><input value={copy.destinationUrl} onChange={e=>setCopy((p:any)=>({...p,destinationUrl:e.target.value}))} placeholder="https://yourwebsite.com" style={S.input}/></div>
    </div>
  )

  const UploadBox = ({list,setter,label}:{list:Creative[],setter:React.Dispatch<React.SetStateAction<Creative[]>>,label:string}) => (
    <div style={{marginBottom:16}}>
      {list.length===0?<div style={{padding:20,textAlign:'center',border:'2px dashed rgba(255,255,255,0.08)',borderRadius:12,fontSize:13,color:'#8aaa8a',marginBottom:10}}>{label}</div>:(
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:10}}>
          {list.map((c,i)=>(
            <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:10,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(0,0,0,0.07)'}}>
              <div style={{width:26,height:26,borderRadius:7,background:'rgba(223,254,149,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#1a3a1a',flexShrink:0}}>A{i+1}</div>
              <input value={c.name} onChange={e=>setter(prev=>prev.map(x=>x.id===c.id?{...x,name:e.target.value}:x))} style={{flex:1,background:'none',border:'none',color:'#1a3a1a',fontSize:13,fontFamily:'inherit',outline:'none'}}/>
              <span style={{fontSize:11,color:c.uploaded?'#86efac':c.uploading?'#fbbf24':'rgba(255,255,255,0.3)'}}>{c.uploading?'Uploading…':c.uploaded?'Uploaded':c.type==='video'?'Video':'Image'}</span>
              <button onClick={()=>setter(prev=>prev.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:'#8aaa8a',cursor:'pointer',fontSize:16,padding:0}}>x</button>
            </div>
          ))}
        </div>
      )}
      <label style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(74,138,0,0.2)',color:'#1a3a1a',padding:'8px 16px',borderRadius:100,fontSize:13,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
        Upload Image / Video (max 10MB)<input type="file" accept="image/*,video/*" multiple onChange={e=>handleUpload(e,setter)} style={{display:'none'}}/>
      </label>
    </div>
  )

  const nb = (onClick:()=>void,label:string,disabled=false) => (
    <button onClick={onClick} disabled={disabled} style={{background:disabled?'rgba(223,254,149,0.2)':'#dffe95',color:disabled?'rgba(255,255,255,0.3)':'#10211f',border:'none',padding:'10px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:disabled?'not-allowed':'pointer'}}>{label}</button>
  )

  return (
    <div style={{padding:28,maxWidth:860,margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(74,138,0,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:900,color:'#1a3a1a'}}>M4</div>
          <div><h1 style={{fontSize:22,fontWeight:800,color:'#1a3a1a'}}>M4 Method</h1><p style={{fontSize:13,color:'#7a9a7a'}}>Find winners, scale them, retarget everyone</p></div>
        </div>
        <div style={{display:'flex',gap:3}}>{STEPS.map((s,i)=><div key={s} style={{flex:1,height:4,borderRadius:100,background:step===s?'#dffe95':STEPS.indexOf(step)>i?'rgba(223,254,149,0.4)':'rgba(255,255,255,0.08)'}}/>)}</div>
      </div>

      {step==='welcome'&&(
        <div style={{...S.card,padding:36,position:'relative'}}>
          <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
          <h2 style={{fontSize:24,fontWeight:900,color:'#1a3a1a',marginBottom:8}}>The complete M4 ad system.</h2>
          <p style={{fontSize:14,color:'#5a7a5a',lineHeight:1.8,marginBottom:24}}>4 campaigns. Every customer lifecycle stage. Zero guesswork.</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:28}}>
            {[{color:'#2d7a2d',label:'Campaign 1 — Broad',title:'Find winning creative',desc:'Advantage+ audience. One creative per ad set.'},{color:'#2563eb',label:'Campaign 2 — Interest',title:'Find winning audience',desc:'Manual interests from competitor data. One per ad set.'},{color:'#fbbf24',label:'Campaign 3 — Retargeting',title:'Convert warm visitors',desc:'Website visitors last 60 days. Different message.'},{color:'#f9a8d4',label:'Campaign 4 — Retainer',title:'Reward your buyers',desc:'Past purchasers. Loyalty offers. Maximize LTV.'}].map(c=>(
              <div key={c.label} style={{background:`${c.color}08`,border:`1px solid ${c.color}25`,borderRadius:16,padding:18}}>
                <div style={{fontSize:11,fontWeight:800,color:c.color,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:6}}>{c.label}</div>
                <div style={{fontSize:14,fontWeight:700,color:'#1a3a1a',marginBottom:4}}>{c.title}</div>
                <div style={{fontSize:12,color:'#6b8f6b',lineHeight:1.6}}>{c.desc}</div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:12}}>
            <button onClick={()=>setStep('pixel')} style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'13px 32px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Start M4 Setup</button>
            <button onClick={gradeNow} disabled={loading} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#1a3a1a',padding:'13px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',opacity:loading?0.6:1}}>{loading?'Analysing…':'Grade and Scale My Campaigns'}</button>
          </div>
        </div>
      )}

      {step==='pixel'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 1 — Product and Competitor Intelligence</div><div style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>The more detail you give, the smarter Selfmade targets your audience.</div></div>
          <div style={S.body}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
              <div><label style={S.label}>Product Name</label><div style={{fontSize:11,color:'#8aaa8a',marginBottom:6}}>What do you call your brand? This helps us name your campaigns.</div><input value={form.product} onChange={e=>set('product',e.target.value)} placeholder="e.g. HairResQ" style={S.input}/></div>
              <div><label style={S.label}>Campaign Name</label><div style={{fontSize:11,color:'#8aaa8a',marginBottom:6}}>Give this launch a name so you can track it. E.g. Hair Fall — May 2025</div><input value={form.campaignName} onChange={e=>set('campaignName',e.target.value)} placeholder="e.g. Hair Fall M4 May 2025" style={S.input}/></div>
            </div>
            <div style={{marginBottom:14}}><label style={S.label}>What do you sell?</label><div style={{fontSize:11,color:'#8aaa8a',marginBottom:6}}>The juicier the details, the smarter our targeting. Benefits, guarantees, who it is for.</div><textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe your product, unique benefits, guarantee..." style={{...S.input,resize:'vertical',minHeight:70,lineHeight:1.6} as React.CSSProperties}></textarea></div>
            <div style={{marginBottom:20}}><label style={S.label}>Target Customer</label><div style={{fontSize:11,color:'#8aaa8a',marginBottom:6}}>Paint a picture of your ideal buyer — age, gender, pain points. Claude uses this to speak directly to them.</div><input value={form.targetCustomer} onChange={e=>set('targetCustomer',e.target.value)} placeholder="e.g. Men and women 25-45 with hair loss" style={S.input}/></div>
            <div style={{background:'rgba(147,197,253,0.05)',border:'1px solid rgba(147,197,253,0.15)',borderRadius:14,padding:18,marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:800,color:'#2563eb',marginBottom:4}}>Competitor Intelligence</div>
              <div style={{fontSize:12,color:'#6b8f6b',marginBottom:14,lineHeight:1.7}}>Selfmade searches Meta's interest database for your competitors' audiences. <strong style={{color:'#2563eb'}}>Add as many as you want</strong> — more competitors = better targeting. Separate each with a comma.</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div><label style={S.label}>Competitor Websites <span style={{color:'#8aaa8a',fontWeight:400,textTransform:'none'}}>— paste their domain names</span></label><input value={form.competitorDomains} onChange={e=>set('competitorDomains',e.target.value)} placeholder="minoxidil.com, regaine.com, foligain.com" style={S.input}/></div>
                <div><label style={S.label}>Competitor Facebook Pages <span style={{color:'#8aaa8a',fontWeight:400,textTransform:'none'}}>— their page URLs or names</span></label><input value={form.competitorFBPages} onChange={e=>set('competitorFBPages',e.target.value)} placeholder="facebook.com/Regaine, Minoxidil" style={S.input}/></div>
                <div><label style={S.label}>Competitor Instagram Handles <span style={{color:'#8aaa8a',fontWeight:400,textTransform:'none'}}>— their @handles</span></label><input value={form.competitorIGHandles} onChange={e=>set('competitorIGHandles',e.target.value)} placeholder="@regaine_uk, @minoxidilfor.men" style={S.input}/></div>
              </div>
            </div>
            <div style={{marginBottom:8}}><label style={S.label}>Meta Pixel</label></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
              <div onClick={()=>{setPixelChoice('existing');if(pixels.length===0)fetchPixels()}} style={{padding:14,borderRadius:12,border:`2px solid ${pixelChoice==='existing'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='existing'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                <div style={{fontSize:18,marginBottom:4}}>Yes</div><div style={{fontSize:13,fontWeight:700,color:'#1a3a1a'}}>I have a pixel</div>
              </div>
              <div onClick={()=>setPixelChoice('new')} style={{padding:14,borderRadius:12,border:`2px solid ${pixelChoice==='new'?'#dffe95':'rgba(255,255,255,0.08)'}`,background:pixelChoice==='new'?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer'}}>
                <div style={{fontSize:18,marginBottom:4}}>No</div><div style={{fontSize:13,fontWeight:700,color:'#1a3a1a'}}>I need one</div>
              </div>
            </div>
            {pixelChoice==='existing'&&(loadingPixels?<div style={{fontSize:13,color:'#7a9a7a'}}>Loading…</div>:pixels.length>0?<select value={pixelId} onChange={e=>setPixelId(e.target.value)} style={{...S.input,background:'#ffffff'}}><option value="">Select pixel…</option>{pixels.map(p=><option key={p.id} value={p.id}>{p.name} {p.id}</option>)}</select>:<input value={pixelId} onChange={e=>setPixelId(e.target.value)} placeholder="Enter Pixel ID" style={S.input}/>)}
            {pixelChoice==='new'&&<div style={{background:'rgba(223,254,149,0.05)',border:'1px solid rgba(223,254,149,0.15)',borderRadius:10,padding:14,fontSize:13,color:'#5a7a5a',lineHeight:1.8}}>Meta Events Manager → Connect Data Sources → Web → Pixel → Copy ID<br/><a href="https://business.facebook.com/events_manager" target="_blank" rel="noreferrer" style={{color:'#1a3a1a',fontWeight:700}}>Open Events Manager</a></div>}
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('welcome')} style={S.back}>Back</button>
            {nb(async()=>{if(interests.length===0)await generateInterests();setStep('creatives')},loading?'Loading…':'Continue →',!pixelChoice||!form.product||!form.campaignName||!form.description||loading)}
          </div>
        </div>
      )}

      {step==='creatives'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 2 — Prospecting Creatives and Ad Copy</div><div style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>For Broad and Interest campaigns targeting new audiences only.</div></div>
          <div style={S.body}>
            <div style={{background:'rgba(134,239,172,0.05)',border:'1px solid rgba(134,239,172,0.15)',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',gap:12}}>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.7}}><strong style={{color:'#2d7a2d'}}>One creative per ad set.</strong> Each image gets its own ad set so you know exactly which creative wins.</div>
            </div>
            <div style={{marginBottom:6,fontSize:13,fontWeight:700,color:'#1a3a1a'}}>Prospecting Creatives</div>
            <UploadBox list={creatives} setter={setCreatives} label="Upload prospecting creatives"/>
            <CopyBox copy={adCopy} setCopy={setAdCopy} type="main" title="Prospecting Ad Copy"/>
            <div style={{background:'#f8fcf6',borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',padding:16}}>
              <div style={{fontSize:13,fontWeight:800,color:'#1a3a1a',marginBottom:10}}>Facebook Page and Instagram</div>
              {pages.length>0?(
                <div>
                  <select value={selectedPageId} onChange={e=>{setSelectedPageId(e.target.value);const pg=pages.find(p=>p.id===e.target.value);setSelectedInstagramId(pg?.instagram?.id||'')}} style={{...S.input,background:'#ffffff',marginBottom:8}}>
                    {pages.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {pages.find(p=>p.id===selectedPageId)?.instagram?(
                    <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:10,background:'#f8fcf6',border:'1px solid rgba(134,239,172,0.2)'}}>
                      <span>Instagram Connected</span><span style={{color:'#2d7a2d',fontWeight:700}}>@{pages.find(p=>p.id===selectedPageId)?.instagram?.username}</span>
                    </div>
                  ):(
                    <div style={{background:'rgba(251,191,36,0.06)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:14,marginTop:4}}>
                      <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginBottom:6}}>Instagram Not Connected</div>
                      <div style={{fontSize:12,color:'#6b8f6b',marginBottom:10,lineHeight:1.6}}>Your ads run on both Facebook and Instagram. To auto-connect: go to Meta Business Suite → Instagram Accounts → connect your Instagram to this Facebook page, then <a href="/connect-meta" style={{color:'#1a3a1a',fontWeight:700}}>reconnect Selfmade here</a>.</div>
                      <input value={selectedInstagramId} onChange={e=>setSelectedInstagramId(e.target.value)} placeholder="Or paste Instagram Account ID manually (find in Meta Business Suite)" style={{...S.input,fontSize:12}}/>
                    </div>
                  )}
                </div>
              ):<div style={{fontSize:13,color:'#8aaa8a'}}>Loading pages…</div>}
            </div>
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('pixel')} style={S.back}>Back</button>
            {nb(()=>setStep('retargeting'),`Set Up Retargeting (${creatives.length} creative${creatives.length!==1?'s':''}) →`,creatives.length<1||!adCopy.primaryText||!adCopy.headline||!adCopy.destinationUrl||!selectedPageId)}
          </div>
        </div>
      )}

      {step==='retargeting'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 3 — Retargeting and Retainer Campaigns</div><div style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>Convert warm visitors and reward past buyers with different messaging.</div></div>
          <div style={S.body}>
            <div style={{background:'rgba(251,191,36,0.06)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:14,padding:18,marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:800,color:'#fbbf24',marginBottom:10}}>Smart Budget Split</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div style={{textAlign:'center',padding:12,background:'rgba(255,255,255,0.04)',borderRadius:10}}><div style={{fontSize:28,fontWeight:900,color:'#1a3a1a'}}>60%</div><div style={{fontSize:12,color:'#6b8f6b',marginTop:4}}>Broad + Interest — New customers</div></div>
                <div style={{textAlign:'center',padding:12,background:'rgba(255,255,255,0.04)',borderRadius:10}}><div style={{fontSize:28,fontWeight:900,color:'#fbbf24'}}>40%</div><div style={{fontSize:12,color:'#6b8f6b',marginTop:4}}>Retargeting + Retainer — Warm audiences</div></div>
              </div>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:800,color:'#1a3a1a',marginBottom:4}}>Retargeting Campaign</div>
              <div style={{fontSize:12,color:'#7a9a7a',marginBottom:12}}>Website visitors last 60 days — audiences created automatically from your pixel</div>
              <UploadBox list={retargetingCreatives} setter={setRetargetingCreatives} label="Upload retargeting creative — remind them why they visited"/>
              <CopyBox copy={retargetingCopy} setCopy={setRetargetingCopy} type="retargeting" title="Retargeting Ad Copy"/>
            </div>
            <div style={{border:'1px solid rgba(249,168,212,0.2)',borderRadius:14,padding:18,background:'rgba(249,168,212,0.03)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:includeRetainer?16:0}}>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:'#1a3a1a'}}>Retainer Campaign <span style={{fontSize:10,padding:'2px 8px',borderRadius:100,background:'rgba(249,168,212,0.1)',color:'#f9a8d4',marginLeft:6}}>OPTIONAL</span></div>
                  <div style={{fontSize:12,color:'#7a9a7a',marginTop:2}}>Past purchasers — loyalty offers, repeat buyers, LTV maximization</div>
                </div>
                <div onClick={()=>setIncludeRetainer(v=>!v)} style={{width:44,height:24,borderRadius:100,background:includeRetainer?'#dffe95':'rgba(255,255,255,0.1)',cursor:'pointer',position:'relative',flexShrink:0}}>
                  <div style={{position:'absolute',top:3,left:includeRetainer?22:3,width:18,height:18,borderRadius:'50%',background:includeRetainer?'#10211f':'white',transition:'left .2s'}}/>
                </div>
              </div>
              {includeRetainer&&(
                <div>
                  <UploadBox list={retainerCreatives} setter={setRetainerCreatives} label="Upload retainer creative — loyalty offer for past buyers"/>
                  <CopyBox copy={retainerCopy} setCopy={setRetainerCopy} type="retainer" title="Retainer Ad Copy"/>
                </div>
              )}
            </div>
          </div>
          <div style={S.foot}>
            <button onClick={()=>setStep('creatives')} style={S.back}>Back</button>
            {nb(()=>setStep('interests'),'Select Interests →',retargetingCreatives.length<1||!retargetingCopy.primaryText||!retargetingCopy.destinationUrl)}
          </div>
        </div>
      )}

      {step==='interests'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 4 — Select Interests</div><div style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>Claude used your competitor data to suggest the best audiences.</div></div>
          <div style={S.body}>
            {interests.length===0?(
              <div style={{textAlign:'center',padding:32}}>
                <button onClick={generateInterests} disabled={loading} style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'12px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:loading?0.7:1}}>{loading?'Claude is thinking…':'Generate Interest Suggestions'}</button>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {interests.map((interest,i)=>(
                  <div key={i} onClick={()=>setInterests(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{padding:14,borderRadius:14,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.08)'}`,background:interest.selected?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:12}}>
                    <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${interest.selected?'#dffe95':'rgba(255,255,255,0.2)'}`,background:interest.selected?'#dffe95':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900,color:'#1a3a1a',flexShrink:0,marginTop:2}}>{interest.selected?'V':''}</div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontSize:14,fontWeight:700,color:'#1a3a1a'}}>{interest.name}</span><span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'#f8fcf6',color:'#7a9a7a',textTransform:'uppercase'}}>{interest.category}</span></div>
                      <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>{interest.why}</div>
                    </div>
                    <div style={{fontSize:11,color:interest.confidence>80?'#86efac':'#fbbf24',flexShrink:0}}>{interest.confidence}%</div>
                  </div>
                ))}
                <div style={{display:'flex',gap:8,marginTop:4}}>
                  <input value={customInterest} onChange={e=>setCustomInterest(e.target.value)} onKeyDown={e=>e.key==='Enter'&&customInterest.trim()&&(setInterests(prev=>[...prev,{name:customInterest.trim(),category:'Custom',why:'Added by you.',size:'Unknown',confidence:70,selected:true,custom:true}]),setCustomInterest(''))} placeholder="Add custom interest…" style={{flex:1,...S.input}}/>
                  <button onClick={()=>{if(customInterest.trim()){setInterests(prev=>[...prev,{name:customInterest.trim(),category:'Custom',why:'Added by you.',size:'Unknown',confidence:70,selected:true,custom:true}]);setCustomInterest('')}}} style={{background:'rgba(223,254,149,0.1)',border:'1px solid rgba(74,138,0,0.2)',color:'#1a3a1a',padding:'10px 16px',borderRadius:10,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>Add</button>
                </div>
              </div>
            )}
          </div>
          <div style={S.foot}>
            <div><button onClick={()=>setStep('retargeting')} style={S.back}>Back</button><span style={{marginLeft:14,fontSize:13,color:'#7a9a7a'}}>{selectedInterests.length} selected</span></div>
            {nb(()=>setStep('budget'),'Set Budget →',selectedInterests.length<2)}
          </div>
        </div>
      )}

      {step==='budget'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 5 — Budget and Targeting</div><div style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>Total budget split 60% new users and 40% warm audiences automatically.</div></div>
          <div style={S.body}>
            <div style={{marginBottom:20}}>
              <label style={S.label}>Campaign Goal</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[{id:'OUTCOME_SALES',icon:'Cart',title:'Sales'},{id:'OUTCOME_LEADS',icon:'Target',title:'Leads'},{id:'OUTCOME_TRAFFIC',icon:'Globe',title:'Traffic'},{id:'OUTCOME_AWARENESS',icon:'Bell',title:'Awareness'}].map(o=>(
                  <div key={o.id} onClick={()=>set('objective',o.id)} style={{padding:12,borderRadius:12,border:`2px solid ${form.objective===o.id?'#dffe95':'rgba(255,255,255,0.08)'}`,background:form.objective===o.id?'rgba(223,254,149,0.06)':'rgba(255,255,255,0.02)',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                    <span style={{fontSize:13,fontWeight:700,color:'#1a3a1a'}}>{o.title}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
              <div>
                <label style={S.label}>Total Daily Budget ({accountCurrency})</label>
                <input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} style={S.input}/>
                <div style={{fontSize:11,color:'#8aaa8a',marginTop:4}}>60% = {Math.round(parseFloat(form.budget||'0')*0.6)} new users — 40% = {Math.round(parseFloat(form.budget||'0')*0.4)} retargeting</div>
              </div>
              <div><label style={S.label}>Gender</label><select value={form.gender} onChange={e=>set('gender',e.target.value)} style={{...S.input,background:'#ffffff'}}><option value="ALL">All</option><option value="MALE">Men</option><option value="FEMALE">Women</option></select></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
              <div><label style={S.label}>Min Age</label><input type="number" value={form.ageMin} onChange={e=>set('ageMin',e.target.value)} style={S.input}/></div>
              <div><label style={S.label}>Max Age</label><input type="number" value={form.ageMax} onChange={e=>set('ageMax',e.target.value)} style={S.input}/></div>
              <div style={{gridColumn:'span 1'}}><label style={S.label}>Location</label><LocationPicker selected={form.locations||[]} onChange={(locs:any[])=>{set('locations',locs as any);set('location',locs.map((l:any)=>l.key).join(','))}}/></div>
            </div>
          </div>
          <div style={S.foot}><button onClick={()=>setStep('interests')} style={S.back}>Back</button>{nb(()=>setStep('review'),'Review & Launch →',!form.budget||parseFloat(form.budget)<=0)}</div>
        </div>
      )}

      {step==='review'&&(
        <div style={S.card}>
          <div style={S.head}><div style={{fontSize:15,fontWeight:800,color:'#1a3a1a'}}>Step 6 — Review and Launch</div></div>
          <div style={S.body}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
              {[{color:'#2d7a2d',label:'Broad',count:creatives.length,pct:30},{color:'#2563eb',label:'Interest',count:selectedInterests.length,pct:30},{color:'#fbbf24',label:'Retargeting',count:retargetingCreatives.length,pct:40},...(includeRetainer?[{color:'#f9a8d4',label:'Retainer',count:retainerCreatives.length,pct:20}]:[])].map(c=>(
                <div key={c.label} style={{background:`${c.color}08`,border:`1px solid ${c.color}20`,borderRadius:14,padding:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:c.color,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6}}>{c.label}</div>
                  <div style={{fontSize:22,fontWeight:900,color:'#1a3a1a',marginBottom:4}}>{c.count} <span style={{fontSize:12,fontWeight:500,color:'#7a9a7a'}}>ad sets</span></div>
                  <div style={{fontSize:12,color:'#6b8f6b'}}>{accountCurrency} {Math.round(parseFloat(form.budget||'0')*c.pct/100)}/day</div>
                </div>
              ))}
            </div>
            <button onClick={launch} disabled={loading} style={{width:'100%',background:loading?'rgba(223,254,149,0.5)':'#dffe95',color:'#1a3a1a',border:'none',padding:15,borderRadius:14,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:loading?'not-allowed':'pointer'}}>
              {loading?'Creating in Meta Ads Manager…':'Launch All Campaigns (PAUSED for review)'}
            </button>
          </div>
          <div style={{padding:'12px 24px'}}><button onClick={()=>setStep('budget')} style={{background:'none',border:'none',color:'#8aaa8a',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>Back to budget</button></div>
        </div>
      )}

      {step==='grades'&&(
        <div>
          <div style={{marginBottom:20}}><h2 style={{fontSize:20,fontWeight:800,color:'#1a3a1a',marginBottom:4}}>M4 Campaign Grades</h2><p style={{fontSize:13,color:'#7a9a7a'}}>Based on ROAS vs account average. Scale winners, pause losers.</p></div>
          {loading?(
            <div style={{...S.card,padding:48,textAlign:'center'}}>
              <img src='/favicon.png' alt='' style={{width:44,height:44,borderRadius:11,animation:'spin 1s linear infinite',margin:'0 auto 16px',display:'block'}}/>
              <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Analysing campaigns…</div>
            </div>
          ):grades.length===0?(
            <div style={{...S.card,padding:48,textAlign:'center'}}>
              <div style={{fontSize:32,marginBottom:12}}>Chart</div>
              <div style={{fontSize:16,fontWeight:700,color:'#1a3a1a',marginBottom:8}}>No campaign data yet</div>
              <div style={{fontSize:13,color:'#7a9a7a',marginBottom:20}}>Run campaigns for 7 days then grade.</div>
              <button onClick={gradeNow} style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>Grade Now</button>
            </div>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {grades.map((grade,i)=>{
                const cfg=gc[grade.grade]||gc.HOLD
                return(
                  <div key={i} style={{background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:18,padding:24,opacity:grade.applied?0.6:1}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                          <span style={{fontSize:24}}>{grade.emoji}</span>
                          <div><div style={{fontSize:13,fontWeight:800,color:cfg.color,textTransform:'uppercase'}}>{grade.label}</div><div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>{grade.campaign_name}</div></div>
                          {grade.applied&&<span style={{fontSize:11,padding:'3px 10px',borderRadius:100,background:'rgba(134,239,172,0.15)',color:'#2d7a2d'}}>Applied</span>}
                        </div>
                        <div style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:10,fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7}}>{grade.why}</div>
                        <div style={{background:'rgba(0,0,0,0.15)',borderLeft:`3px solid ${cfg.color}`,borderRadius:'0 10px 10px 0',padding:'12px 16px'}}>
                          <div style={{fontSize:13,color:'#1a3a1a',fontWeight:600,marginBottom:4}}>{grade.action}</div>
                          <div style={{fontSize:12,color:'#6b8f6b',lineHeight:1.6}}>{grade.action_reason}</div>
                        </div>
                      </div>
                      {!grade.applied&&(
                        <div style={{display:'flex',flexDirection:'column',gap:8,flexShrink:0}}>
                          <button onClick={()=>applyAction(grade)} disabled={!!applying||!!scaling} style={{background:cfg.color,color:'#1a3a1a',border:'none',padding:'10px 18px',borderRadius:100,fontSize:13,fontWeight:800,fontFamily:'inherit',cursor:'pointer',opacity:(applying||scaling)?0.7:1,whiteSpace:'nowrap'}}>
                            {scaling===grade.campaign_name?'Scaling…':applying===grade.campaign_name?'Applying…':grade.grade==='GRADUATE'?'Scale Winner':grade.grade==='HOLD'?'Keep Running':'Pause This Ad'}
                          </button>
                          <button style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'#7a9a7a',padding:'8px 16px',borderRadius:100,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Skip</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <button onClick={()=>setStep('welcome')} style={{background:'none',border:'1.5px solid rgba(223,254,149,0.2)',color:'#1a3a1a',padding:'11px 24px',borderRadius:100,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer',alignSelf:'flex-start'}}>Launch Another Campaign</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
