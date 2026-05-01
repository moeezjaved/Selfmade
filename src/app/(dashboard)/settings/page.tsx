'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const [saved, setSaved] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{padding:28,maxWidth:640}}>
      <h1 style={{fontSize:22,fontWeight:800,color:'#1a3a1a',marginBottom:6}}>Settings</h1>
      <p style={{fontSize:13,color:'#7a9a7a',marginBottom:24}}>Manage your account preferences.</p>

      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Profile</div>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:14}}>
          <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Full Name</label><input className="input" defaultValue="Moeez Javed" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'}}/></div>
          <div><label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Email</label><input disabled value="moeez@virginteez.com" style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.06)',background:'#f8fcf6',color:'#7a9a7a',fontSize:14,fontFamily:'inherit',outline:'none',cursor:'not-allowed'}}/></div>
          <button onClick={() => setSaved(true)} style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'10px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:'pointer',alignSelf:'flex-start'}}>
            {saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Connected Accounts</div>
        </div>
        <div style={{padding:22}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
            <div style={{fontSize:14,color:'#3a5a3a'}}>Meta / Facebook — Connected ✓</div>
            <a href="/connect-meta" style={{fontSize:13,color:'#dffe95',fontWeight:700,textDecoration:'none'}}>Manage →</a>
          </div>
        </div>
      </div>

      <div style={{background:'rgba(248,113,113,0.05)',border:'1px solid rgba(248,113,113,0.15)',borderRadius:18,padding:22}}>
        <div style={{fontSize:15,fontWeight:700,color:'#f87171',marginBottom:8}}>Danger Zone</div>
        <div style={{fontSize:13,color:'#7a9a7a',marginBottom:14}}>Sign out of your Selfmade account.</div>
        <button onClick={signOut} style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.25)',color:'#f87171',padding:'8px 18px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>Sign Out</button>
      </div>
    </div>
  )
}
