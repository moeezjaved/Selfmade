'use client'
export default function BillingPage() {
  return (
    <div style={{padding:28,maxWidth:600}}>
      <h1 style={{fontSize:22,fontWeight:800,color:'white',marginBottom:6}}>Billing</h1>
      <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Manage your subscription and payment method.</p>
      <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.22)',borderRadius:20,padding:32,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}/>
        <div style={{fontSize:13,fontWeight:700,color:'#dffe95',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Selfmade Pro</div>
        <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:6}}>
          <span style={{fontSize:48,fontWeight:900,color:'white'}}>$99</span>
          <span style={{fontSize:15,color:'rgba(255,255,255,0.4)'}}>/month</span>
        </div>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:24}}>Trial active · No charge yet</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:24}}>
          {['Live KPI Dashboard','AI Recommendations','Approval-First','Ad Engine','Creative Studio','Activity Log'].map(f => (
            <div key={f} style={{display:'flex',alignItems:'center',gap:7,fontSize:13,color:'rgba(255,255,255,0.6)'}}><span style={{color:'#dffe95',fontWeight:900}}>✓</span>{f}</div>
          ))}
        </div>
        <button onClick={() => alert('Stripe integration coming soon!')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'12px 28px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
          Manage Subscription →
        </button>
      </div>
    </div>
  )
}
