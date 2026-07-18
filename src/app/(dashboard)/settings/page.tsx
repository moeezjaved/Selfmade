'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

// Chrome Web Store listing (approved 2026-07-08).
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/selfmade-%E2%80%94-save-winning-a/eekbcgdoonpmhoojoaggpfmfgcplaefi'

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
  const [autopilots, setAutopilots] = useState<{ id: string; brand_name: string | null; media_type: string; runs: number }[]>([])
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null)  // null = still loading
  const [disconnecting, setDisconnecting] = useState(false)
  const [newPw, setNewPw] = useState(''); const [confirmPw, setConfirmPw] = useState(''); const [pwSaving, setPwSaving] = useState(false)
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
      // Real Meta-connection status (was hardcoded "Connected ✓" even with nothing linked).
      supabase.from('meta_accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active')
        .then(({ count }) => { if (!cancelled) setMetaConnected((count || 0) > 0) })
      // load notification prefs (non-blocking)
      fetch('/api/notifications/prefs').then(r => r.json()).then(j => { if (!cancelled && j.prefs) setPrefs(j.prefs) }).catch(() => {})
      // load daily-autopilot enrollments (non-blocking)
      fetch('/api/autopilot').then(r => r.json()).then(j => { if (!cancelled && Array.isArray(j.items)) setAutopilots(j.items) }).catch(() => {})
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

  const stopAutopilot = async (id: string) => {
    await fetch(`/api/autopilot?id=${id}`, { method: 'DELETE' }).catch(() => {})
    setAutopilots((a) => a.filter((x) => x.id !== id))
    toast.success('Daily ads turned off for this brand')
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

  const changePassword = async () => {
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { toast.error('Passwords don’t match.'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwSaving(false)
    if (error) { toast.error(error.message || 'Could not update password.'); return }
    setNewPw(''); setConfirmPw(''); toast.success('Password updated.')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const disconnectMeta = async () => {
    if (!confirm('Disconnect your Meta / Facebook account? Your ad accounts will be removed from Selfmade until you reconnect.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/meta/accounts', { method: 'DELETE' })
      if (res.ok) { setMetaConnected(false); toast.success('Meta account disconnected') }
      else { const j = await res.json().catch(() => ({})); toast.error(j?.error || 'Failed to disconnect') }
    } catch { toast.error('Failed to disconnect') }
    finally { setDisconnecting(false) }
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

      {/* Change password — Supabase updateUser({password}); works for email users and lets Google
          sign-in users SET a password too. No current-password field (the session already proves identity). */}
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Change Password</div>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>New Password</label>
            <input
              type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              placeholder="At least 8 characters" autoComplete="new-password"
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'}}
            />
          </div>
          <div>
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#6b8f6b',marginBottom:6}}>Confirm New Password</label>
            <input
              type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password" autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === 'Enter') changePassword() }}
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid rgba(255,255,255,0.1)',background:'#f8fcf6',color:'#1a3a1a',fontSize:14,fontFamily:'inherit',outline:'none'}}
            />
          </div>
          <button
            onClick={changePassword}
            disabled={pwSaving || !newPw || !confirmPw}
            style={{background:'#dffe95',color:'#1a3a1a',border:'none',padding:'10px 24px',borderRadius:100,fontSize:14,fontWeight:800,fontFamily:'inherit',cursor:(pwSaving||!newPw||!confirmPw)?'not-allowed':'pointer',alignSelf:'flex-start',opacity:(pwSaving||!newPw||!confirmPw)?0.6:1}}
          >
            {pwSaving ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* Daily Ad Autopilot — one fresh ad per enrolled brand, emailed daily ($0.15/ad) */}
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>🚀 Daily Ad Autopilot</div>
          <div style={{fontSize:12,color:'#7a9a7a',marginTop:2}}>A fresh ad for each brand below, generated and emailed every day at $0.15/ad. We skip days you’re out of credits. Runs until you turn it off.</div>
        </div>
        <div style={{padding:autopilots.length?12:22}}>
          {autopilots.length === 0 ? (
            <div style={{fontSize:13,color:'#7a9a7a'}}>No brands on autopilot yet. Turn it on from the Remake screen — the last step has a “Put this ad on autopilot” option.</div>
          ) : autopilots.map((a) => (
            <div key={a.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 10px',borderRadius:12,background:'#f8fcf6',marginBottom:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:'#1a3a1a'}}>{a.brand_name || 'Your brand'} <span style={{fontSize:11,fontWeight:600,color:'#3b6d11',background:'#eaf3de',borderRadius:20,padding:'2px 8px',marginLeft:4}}>{a.media_type === 'video' ? 'Video' : 'Image'}</span></div>
                <div style={{fontSize:12,color:'#7a9a7a',marginTop:2}}>{a.runs} ad{a.runs === 1 ? '' : 's'} sent so far · $0.15/day</div>
              </div>
              <button onClick={() => stopAutopilot(a.id)} style={{padding:'7px 14px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',color:'#b91c1c',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Turn off</button>
            </div>
          ))}
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

      {/* Save Ads Anywhere — Chrome extension + (coming soon) mobile Instagram save */}
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Save ads anywhere</div>
          <div style={{fontSize:12.5,color:'#7a9a7a',marginTop:3}}>Grab winning ads while you browse — they land in your boards.</div>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:16}}>
          {/* Browser extension */}
          <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
            <div style={{width:42,height:42,borderRadius:12,background:'#f0fdf4',border:'1px solid #bbf7d0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🧩</div>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontSize:14,fontWeight:700,color:'#1a3a1a'}}>Browser extension</div>
              <div style={{fontSize:12.5,color:'#7a9a7a',marginTop:2}}>One-click save on Instagram, the Facebook Ad Library & TikTok. Sign in once with your Selfmade account.</div>
            </div>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
              style={{background:'#dffe95',color:'#1a3a1a',padding:'9px 18px',borderRadius:100,fontSize:13,fontWeight:800,textDecoration:'none',whiteSpace:'nowrap'}}>
              Get the extension →
            </a>
          </div>
          <div style={{height:1,background:'#f1f5f9'}} />
          {/* Mobile Instagram save — coming soon */}
          <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',opacity:0.85}}>
            <div style={{width:42,height:42,borderRadius:12,background:'#faf5ff',border:'1px solid #e9d5ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📱</div>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontSize:14,fontWeight:700,color:'#1a3a1a'}}>Save from Instagram on mobile</div>
              <div style={{fontSize:12.5,color:'#7a9a7a',marginTop:2}}>Forward any ad or reel to our Instagram bot and it saves to your boards — no extension needed.</div>
            </div>
            <span style={{background:'#f3f4f6',color:'#6b7280',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:800,whiteSpace:'nowrap'}}>Coming soon</span>
          </div>
        </div>
      </div>

      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:18,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(223,254,149,0.08)'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1a3a1a'}}>Connected Accounts</div>
        </div>
        <div style={{padding:22}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
            <div style={{fontSize:14,color: metaConnected ? '#3a5a3a' : '#9ca3af'}}>
              {metaConnected == null ? 'Meta / Facebook — checking…' : metaConnected ? 'Meta / Facebook — Connected ✓' : 'Meta / Facebook — Not connected'}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              <a href="/connect-meta" style={{fontSize:13,color:'#1a3a1a',fontWeight:700,textDecoration:'none'}}>{metaConnected ? 'Reconnect →' : 'Connect →'}</a>
              {metaConnected && (
                <button onClick={disconnectMeta} disabled={disconnecting} style={{fontSize:13,color:'#c0392b',fontWeight:700,background:'none',border:'none',fontFamily:'inherit',cursor:disconnecting?'default':'pointer',opacity:disconnecting?0.5:1,padding:0}}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>
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
