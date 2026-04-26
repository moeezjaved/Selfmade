'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ConnectMetaContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [state, setState] = useState<'idle'|'connecting'|'success'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (params.get('success')) setState('success')
    if (params.get('error')) { setState('error'); setErrorMsg(decodeURIComponent(params.get('error')!)) }
  }, [params])

  const handleConnect = () => {
    setState('connecting')
    const appId = process.env.NEXT_PUBLIC_META_APP_ID
    const redirectUri = "https://www.tryselfmade.ai/api/auth/callback"
    const scopes = 'ads_management,ads_read,business_management,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish'
    const url = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`
    window.location.href = '/api/meta/init'
  }

  return (
    <div style={{minHeight:'100vh',background:'#10211f',display:'flex',flexDirection:'column'}}>
      <div style={{background:'#152928',borderBottom:'1px solid rgba(223,254,149,0.13)',padding:'0 40px',height:64,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:22,fontWeight:900,color:'#dffe95',fontFamily:'Georgia,serif',fontStyle:'italic'}}>Selfmade</span>
        <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.4)'}}>
          Account ✓ › Setup ✓ › Payment ✓ › <span style={{color:'#dffe95'}}>Connect Meta</span> › Dashboard
        </div>
        <div style={{width:120}}/>
      </div>

      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'48px 20px'}}>
        {state==='success' ? (
          <div style={{textAlign:'center',maxWidth:440}}>
            <div style={{fontSize:64,marginBottom:16}}>🎉</div>
            <h1 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:10}}>Meta account connected!</h1>
            <p style={{fontSize:15,color:'rgba(255,255,255,0.5)',marginBottom:28,lineHeight:1.7}}>Your campaigns are syncing. Your dashboard will be ready in seconds.</p>
            <button onClick={() => router.push('/dashboard')} style={{background:'#dffe95',color:'#10211f',border:'none',padding:'14px 36px',borderRadius:100,fontSize:15,fontWeight:800,fontFamily:'inherit',cursor:'pointer'}}>
              Go to Dashboard →
            </button>
          </div>
        ) : (
          <div style={{width:'100%',maxWidth:480}}>
            <div style={{textAlign:'center',marginBottom:28}}>
              <div style={{width:64,height:64,background:'#1877F2',borderRadius:18,display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,margin:'0 auto 18px'}}>📘</div>
              <h1 style={{fontSize:28,fontWeight:900,color:'white',marginBottom:10}}>Connect your Meta account</h1>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.5)',lineHeight:1.7}}>Link your Facebook ad account so Selfmade can read your data and execute approved actions.</p>
            </div>

            {state==='error' && <div style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:12,padding:'12px 16px',marginBottom:16,fontSize:13,color:'#f87171'}}>⚠️ {errorMsg || 'Connection failed. Please try again.'}</div>}

            <div style={{background:'#152928',border:'1px solid rgba(223,254,149,0.1)',borderRadius:18,padding:20,marginBottom:16}}>
              {[
                {icon:'📊',title:'Campaign & ad performance data',desc:'Read spend, ROAS, CPA, CTR across all campaigns.'},
                {icon:'⚡',title:'Full ads_management access',desc:'Execute approved actions — pause, scale, create campaigns.'},
                {icon:'✅',title:'Approval-first always',desc:'Nothing changes without your explicit approval.'},
                {icon:'🔒',title:'Secure OAuth',desc:'No password stored. Revoke anytime from Facebook Settings.'},
              ].map(p => (
                <div key={p.title} style={{display:'flex',gap:12,padding:'12px 0',borderBottom:'1px solid rgba(223,254,149,0.06)'}}>
                  <div style={{width:36,height:36,borderRadius:10,background:'rgba(223,254,149,0.08)',border:'1px solid rgba(223,254,149,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{p.icon}</div>
                  <div><div style={{fontSize:13,fontWeight:700,color:'white',marginBottom:2}}>{p.title}</div><div style={{fontSize:12,color:'rgba(255,255,255,0.4)',lineHeight:1.5}}>{p.desc}</div></div>
                </div>
              ))}
            </div>

            <button onClick={handleConnect} disabled={state==='connecting'} style={{width:'100%',background:'#1877F2',color:'white',border:'none',padding:15,borderRadius:14,fontSize:15,fontWeight:700,fontFamily:'inherit',cursor:state==='connecting'?'not-allowed':'pointer',opacity:state==='connecting'?.7:1,marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              {state==='connecting' ? 'Connecting…' : 'Connect with Facebook / Meta'}
            </button>
            <button onClick={() => router.push('/dashboard')} style={{width:'100%',background:'none',border:'1.5px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.4)',padding:12,borderRadius:14,fontSize:14,fontFamily:'inherit',cursor:'pointer'}}>
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ConnectMetaPage() {
  return <Suspense fallback={<div style={{minHeight:'100vh',background:'#10211f'}}/>}><ConnectMetaContent/></Suspense>
}
