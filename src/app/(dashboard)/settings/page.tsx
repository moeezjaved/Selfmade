'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  // Notification prefs (migration 054): how the user hears about new ads on brands they follow.
  const [prefs, setPrefs] = useState<{ in_app: boolean; instant_email: boolean; digest_frequency: string }>({ in_app: true, instant_email: false, digest_frequency: 'weekly' })
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) { router.push('/login'); return }
      setEmail(user.email || '')
      // user_metadata holds whatever was set at signup or via updateUser
      const meta = (user.user_metadata || {}) as Record<string, string>
      setFullName(meta.full_name || meta.name || '')
      setLoading(false)
      // load notification prefs (non-blocking)
      fetch('/api/notifications/prefs').then(r => r.json()).then(j => { if (!cancelled && j.prefs) setPrefs(j.prefs) }).catch(() => {})
    })()
    return () => { cancelled = true }
  }, [])

  const savePrefs = async (next: typeof prefs) => {
    setPrefs(next)
    setPrefsSaving(true); setPrefsSaved(false)
    try {
      await fetch('/api/notifications/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      setPrefsSaved(true); setTimeout(() => setPrefsSaved(false), 1800)
    } finally { setPrefsSaving(false) }
  }

  const saveProfile = async () => {
    setSaving(true)
    setSaved(false)
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName },
    })
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

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
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Full Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              placeholder={loading ? 'Loading…' : 'Your name'}
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'}}
            />
          </div>
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Email</label>
            <input
              disabled
              value={loading ? 'Loading…' : email}
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.06)',background:'#f8fcf6',color:'#7a9a7a',fontSize:14,fontFamily:'inherit',outline:'none',cursor:'not-allowed'}}
            />
          </div>
          <button
            onClick={saveProfile}
            disabled={saving || loading}
            style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'10px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:saving||loading?'not-allowed':'pointer',alignSelf:'flex-start',opacity:saving||loading?0.6:1}}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Notifications — controls the new-ad alerts + weekly digest for followed brands */}
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Notifications</div>
          <span style={{fontSize:12,color:prefsSaved?'#16a34a':'#9ca3af'}}>{prefsSaving ? 'Saving…' : prefsSaved ? '✓ Saved' : ''}</span>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:4}}>
          <ToggleRow
            label="In-app alerts"
            hint="Show a bell notification when a brand you follow launches a new ad."
            checked={prefs.in_app}
            onChange={(v) => savePrefs({ ...prefs, in_app: v })}
          />
          <div style={{height:1,background:'#f1f5f9',margin:'4px 0'}} />
          <ToggleRow
            label="Instant email alerts"
            hint="Email me the moment a followed brand ships new ads. Costs 2 credits per email."
            checked={prefs.instant_email}
            onChange={(v) => savePrefs({ ...prefs, instant_email: v })}
          />
          <div style={{height:1,background:'#f1f5f9',margin:'4px 0'}} />
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',gap:12}}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:'#1a3a1a'}}>Email digest</div>
              <div style={{fontSize:12,color:'#7a9a7a',marginTop:2}}>What your followed brands shipped + brands to follow in your niche. Costs 2 credits per email.</div>
            </div>
            <select
              value={prefs.digest_frequency}
              onChange={(e) => savePrefs({ ...prefs, digest_frequency: e.target.value })}
              style={{padding:'7px 12px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#f8fcf6',color:'#1a3a1a',fontSize:13,fontFamily:'inherit',fontWeight:600,cursor:'pointer'}}
            >
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
              <option value="off">Off</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Connected Accounts</div>
        </div>
        <div style={{padding:22}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
            <div style={{fontSize:14,color:'#3a5a3a'}}>Meta / Facebook — Connected ✓</div>
            <a href="/connect-meta" style={{fontSize:13,color:'#1a3a1a',fontWeight:700,textDecoration:'none'}}>Manage →</a>
          </div>
        </div>
      </div>

      <div style={{background:'rgba(248,113,113,0.05)',border:'1px solid rgba(248,113,113,0.15)',borderRadius:18,padding:22}}>
        <div style={{fontSize:15,fontWeight:700,color:'#c0392b',marginBottom:8}}>Danger Zone</div>
        <div style={{fontSize:13,color:'#7a9a7a',marginBottom:14}}>Sign out of your Selfmade account.</div>
        <button onClick={signOut} style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.25)',color:'#c0392b',padding:'8px 18px',borderRadius:100,fontSize:13,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>Sign Out</button>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',gap:12}}>
      <div>
        <div style={{fontSize:14,fontWeight:600,color:'#1a3a1a'}}>{label}</div>
        <div style={{fontSize:12,color:'#7a9a7a',marginTop:2}}>{hint}</div>
      </div>
      <button
        role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        style={{width:44,height:26,borderRadius:100,border:'none',cursor:'pointer',flexShrink:0,padding:0,position:'relative',background:checked?'#1a3a1a':'#d1d5db',transition:'background .15s'}}
      >
        <span style={{position:'absolute',top:3,left:checked?21:3,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .15s'}} />
      </button>
    </div>
  )
}
