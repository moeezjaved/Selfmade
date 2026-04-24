'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PaymentPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<'monthly'|'annual'>('monthly')
  const [loading, setLoading] = useState(false)

  const handleCheckout = async () => {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({plan}),
    })
    const { url, error } = await res.json()
    if (error) { setLoading(false); alert(error); return }
    window.location.href = url
  }

  return (
    <div style={{minHeight:'100vh',background:'#10211f',display:'flex',flexDirection:'column'}}>
      <div style={{background:'#152928',borderBottom:'1px solid rgba(223,254,149,0.13)',padding:'0 40px',height:64,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:22,fontWeight:900,color:'#dffe95',fontFamily:'Georgia,serif',fontStyle:'italic'}}>Selfmade</span>
        <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)'}}>
          Account ✓ › Setup ✓ › <span style={{color:'#dffe95'}}>Payment</span> › Connect Meta › Dashboard
        </div>
        <div style={{width:120}}/>
      </div>
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'48px 20px'}}>
        <div style={{width:'100%',maxWidth:520}}>
          <div style={{textAlign:'center',marginBottom:32}}>
            <h1 style={{fontSize:36,fontWeight:900,color:'white',letterSpacing:'-.025em',marginBottom:10}}>Start your <span style={{color:'#dffe95'}}>free 7-day trial</span></h1>
            <p style={{fontSize:15,color:'rgba(255,255,255,0.4)'}}>No charge until your trial ends. Cancel anytime.</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:24}}>
            {(['monthly','annual'] as const).map(p => (
              <div key={p} onClick={() => setPlan(p)} style={{background:'#152928',border:`2px solid ${plan===p?'#dffe95':'rgba(223,254,149,0.1)'}`,borderRadius:18,padding:24,cursor:'pointer',position:'relative',transition:'all .2s'}}>
                {p==='annual' && <div style={{position:'absolute',top:-11,right:14,background:'#dffe95',color:'#10211f',fontSize:10,fontWeight:800,padding:'2px 10px',borderRadius:100}}>Save 20%</div>}
                <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>{p==='monthly'?'Monthly':'Annual'}</div>
                <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:4}}>
                  <span style={{fontSize:36,fontWeight:900,color:'white'}}>{p==='monthly'?'$99':'$79'}</span>
                  <span style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>/mo</span>
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.35)'}}>{p==='monthly'?'Billed monthly':'$948 billed yearly'}</div>
                <div style={{position:'absolute',top:14,right:14,width:20,height:20,borderRadius:'50%',border:`2px solid ${plan===p?'#dffe95':'rgba(255,255,255,0.15)'}`,background:plan===p?'#dffe95':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:900,color:'#10211f'}}>{plan===p?'✓':''}</div>
              </div>
            ))}
          </div>
          <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.1)',borderRadius:18,padding:22,marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:'rgba(255,255,255,0.3)',marginBottom:14}}>Everything included</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {['Live KPI Dashboard','AI Recommendations','Approval-First','Ad Engine','Creative Studio','Multiple Accounts','Activity Log','Cancel Anytime'].map(f => (
                <div key={f} style={{display:'flex',alignItems:'center',gap:7,fontSize:13,color:'rgba(255,255,255,0.6)'}}>
                  <span style={{color:'#dffe95',fontWeight:900,flexShrink:0}}>✓</span> {f}
                </div>
              ))}
            </div>
          </div>
          <button onClick={handleCheckout} disabled={loading} style={{width:'100%',background:'#dffe95',color:'#10211f',border:'none',padding:16,borderRadius:14,fontSize:16,fontWeight:800,fontFamily:'inherit',cursor:loading?'not-allowed':'pointer',opacity:loading?.7:1,marginBottom:12}}>
            {loading?'Redirecting to Stripe…':'🔒 Start Free Trial — No charge today'}
          </button>
          <p style={{textAlign:'center',fontSize:12,color:'rgba(255,255,255,0.25)',marginBottom:16}}>Secured by Stripe · Cancel anytime</p>
          <div style={{textAlign:'center'}}>
            <button onClick={() => router.push('/connect-meta')} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:13,cursor:'pointer',textDecoration:'underline',fontFamily:'inherit'}}>
              Skip for now — connect Meta first
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
