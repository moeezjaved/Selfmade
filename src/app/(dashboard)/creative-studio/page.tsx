'use client'
import { useState } from 'react'

export default function CreativeStudioPage() {
  const [step, setStep] = useState<'input'|'loading'|'results'>('input')
  const [product, setProduct] = useState('')
  const [winner, setWinner] = useState('')
  const [results, setResults] = useState<any[]>([])

  const generate = async () => {
    if (!product || !winner) return
    setStep('loading')
    await new Promise(r => setTimeout(r, 2500))
    setResults([
      {n:1,angle:'Pain Point Direct',hook:'Still struggling with '+product+'?',body:'Most people don\'t know this simple trick that changed everything. Try it risk-free.',cta:'Learn More',img:'High contrast before/after split image'},
      {n:2,angle:'Social Proof',hook:'10,000+ customers can\'t be wrong',body:'See why everyone is switching to '+product+'. Real results, real people.',cta:'Shop Now',img:'Grid of customer testimonials with star ratings'},
      {n:3,angle:'Curiosity Gap',hook:'The secret behind '+product,body:'We\'re not supposed to share this but... here\'s exactly what makes it work.',cta:'Discover Why',img:'Mysterious close-up product shot with blur effect'},
      {n:4,angle:'Urgency/Scarcity',hook:'Only 48 hours left',body:'Our biggest sale of the year ends soon. Get '+product+' before it\'s gone.',cta:'Get Offer',img:'Bold countdown timer graphic with red accents'},
      {n:5,angle:'Education/Value',hook:'3 things you need to know about '+product,body:'We break down exactly what to look for, what to avoid, and why it matters.',cta:'Read More',img:'Clean infographic-style with icons and numbers'},
      {n:6,angle:'Direct Response',hook:'Get '+product+' today',body:'Free shipping. 30-day guarantee. No questions asked. Order now.',cta:'Buy Now',img:'Clean product shot on white with price badge'},
    ])
    setStep('results')
  }

  return (
    <div style={{padding:28}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,fontWeight:800,color:'#1a3a1a'}}>Creative Studio</h1>
        <p style={{fontSize:13,color:'#7a9a7a',marginTop:3}}>Generate 6 strategic ad variation briefs from your winning creative.</p>
      </div>

      {step==='input' && (
        <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,padding:28,maxWidth:580}}>
          <div style={{marginBottom:16}}>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>What product/service are you advertising?</label>
            <input value={product} onChange={e=>setProduct(e.target.value)} placeholder="e.g. Hair loss treatment, SaaS tool for HR teams..." style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Describe your current best-performing ad</label>
            <textarea value={winner} onChange={e=>setWinner(e.target.value)} placeholder="What does the ad say? What image does it use? Why do you think it works?" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none',resize:'vertical',minHeight:100,lineHeight:1.6}}/>
          </div>
          <button onClick={generate} disabled={!product||!winner} style={{background:product&&winner?'#dffe95':'rgba(223,254,149,0.2)',color:product&&winner?'#10211f':'rgba(255,255,255,0.3)',border:'none',padding:'12px 28px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:product&&winner?'pointer':'not-allowed'}}>
            ✦ Generate 6 Variations
          </button>
        </div>
      )}

      {step==='loading' && (
        <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,padding:48,textAlign:'center',maxWidth:580}}>
          <div style={{width:48,height:48,border:'3px solid rgba(223,254,149,0.2)',borderTopColor:'#dffe95',borderRadius:'50%',animation:'spin 1s linear infinite',margin:'0 auto 20px'}}/>
          <div style={{fontSize:16,fontWeight:700,color:'#1a3a1a',marginBottom:8}}>Generating variations…</div>
          <div style={{fontSize:13,color:'#7a9a7a'}}>Claude is analysing your winning ad and creating 6 strategic briefs</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {step==='results' && (
        <>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
            <div style={{fontSize:14,color:'#6b8f6b'}}>6 variation briefs generated</div>
            <button onClick={()=>{setStep('input');setResults([])}} style={{background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'#6b8f6b',padding:'7px 16px',borderRadius:100,fontSize:13,fontFamily:'inherit',cursor:'pointer'}}>← Start Over</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14}}>
            {results.map(r => (
              <div key={r.n} style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:16,padding:22}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                  <div style={{width:28,height:28,borderRadius:8,background:'rgba(223,254,149,0.1)',border:'1px solid rgba(74,138,0,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#dffe95'}}>V{r.n}</div>
                  <div style={{fontSize:13,fontWeight:700,color:'#dffe95'}}>{r.angle}</div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#8aaa8a',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Hook</div>
                  <div style={{fontSize:14,fontWeight:700,color:'#1a3a1a'}}>{r.hook}</div>
                </div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#8aaa8a',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Body Copy</div>
                  <div style={{fontSize:13,color:'#5a7a5a',lineHeight:1.6}}>{r.body}</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div style={{background:'#f8fcf6',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#8aaa8a',marginBottom:3}}>CTA</div>
                    <div style={{fontSize:12,fontWeight:700,color:'#1a3a1a'}}>{r.cta}</div>
                  </div>
                  <div style={{background:'#f8fcf6',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#8aaa8a',marginBottom:3}}>Image Direction</div>
                    <div style={{fontSize:11,color:'#5a7a5a',lineHeight:1.4}}>{r.img}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
