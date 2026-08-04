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
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [apBrand, setApBrand] = useState(''); const [apMedia, setApMedia] = useState<'image' | 'video'>('image'); const [apBusy, setApBusy] = useState(false)
  const [apComp, setApComp] = useState('')  // optional competitor page_id — daily ad follows THIS rival's latest ad
  const [competitors, setCompetitors] = useState<{ pageId: string; name: string }[]>([])
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
      // load the user's brands so autopilot can be turned on RIGHT HERE (no dependency on a remake step)
      fetch('/api/brands').then(r => r.json()).then(j => { if (!cancelled && Array.isArray(j.brands)) setBrands(j.brands.map((b: any) => ({ id: b.id, name: b.name }))) }).catch(() => {})
      // load the competitors already in Brand Spy, so the daily ad can FOLLOW one of them for reference
      fetch('/api/follows').then(r => r.json()).then(j => {
        const rows: any[] = Array.isArray(j?.brands) ? j.brands : []
        const spied = rows.filter(f => f && f.spied && f.page_id && f.brand_name)
          .map(f => ({ pageId: String(f.page_id), name: String(f.brand_name) }))
        if (!cancelled) setCompetitors(spied)
      }).catch(() => {})
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

  const enrollAutopilot = async () => {
    if (!apBrand || apBusy) return
    setApBusy(true)
    try {
      const comp = competitors.find(c => c.pageId === apComp)
      const r = await fetch('/api/autopilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId: apBrand, mediaType: apMedia, settings: comp ? { competitorPageId: comp.pageId, competitorName: comp.name } : {} }) }).then(x => x.json()).catch(() => ({}))
      if (r?.id) {
        const j = await fetch('/api/autopilot').then(x => x.json()).catch(() => ({}))
        if (Array.isArray(j.items)) setAutopilots(j.items)
        setApBrand(''); toast.success('Daily ads turned on for this brand')
      } else { toast.error(r?.error || 'Could not turn on autopilot') }
    } finally { setApBusy(false) }
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
        <div style={{padding:12}}>
          {/* Turn it on RIGHT HERE — pick a brand + format. (Previously this pointed to a 'Remake screen'
              step that no longer exists in the new studio flow.) */}
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'6px 4px 14px'}}>
            <select value={apBrand} onChange={(e)=>setApBrand(e.target.value)} style={{flex:'1 1 160px',minWidth:150,padding:'9px 12px',borderRadius:10,border:'1.5px solid #e2e8f0',background:'#fff',fontSize:13,fontFamily:'inherit',color:'#1a3a1a'}}>
              <option value="">{brands.length ? 'Choose a brand…' : 'Add a brand first'}</option>
              {brands.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={apMedia} onChange={(e)=>setApMedia(e.target.value as any)} style={{padding:'9px 12px',borderRadius:10,border:'1.5px solid #e2e8f0',background:'#fff',fontSize:13,fontFamily:'inherit',color:'#1a3a1a'}}>
              <option value="image">Image ad</option>
              <option value="video">Video ad</option>
            </select>
            {/* Optional: follow ONE competitor from Brand Spy — the daily ad is modelled on their latest ad. */}
            <select value={apComp} onChange={(e)=>setApComp(e.target.value)} title="Reference a competitor's ads" style={{flex:'1 1 160px',minWidth:150,padding:'9px 12px',borderRadius:10,border:'1.5px solid #e2e8f0',background:'#fff',fontSize:13,fontFamily:'inherit',color:'#1a3a1a'}}>
              <option value="">{competitors.length ? 'Reference: my product (default)' : 'No competitors in Brand Spy yet'}</option>
              {competitors.map(c=> <option key={c.pageId} value={c.pageId}>Follow: {c.name}</option>)}
            </select>
            <button onClick={enrollAutopilot} disabled={!apBrand||apBusy} style={{padding:'9px 18px',borderRadius:100,border:'none',background: apBrand&&!apBusy ? '#1a3a1a':'#e2e8f0',color: apBrand&&!apBusy ? '#dffe95':'#9ca3af',fontSize:13,fontWeight:800,cursor: apBrand&&!apBusy ?'pointer':'default',fontFamily:'inherit',whiteSpace:'nowrap'}}>{apBusy?'Turning on…':'Turn on daily ads'}</button>
          </div>
          <div style={{fontSize:12,color:'#7a9a7a',padding:'0 4px 10px',marginTop:-6}}>Pick a competitor to have each morning’s ad modelled on <b>their newest ad</b> — remade for your product. Leave it on “my product” to generate from your own brand.</div>
          {autopilots.length === 0 ? (
            <div style={{fontSize:12.5,color:'#9ca3af',padding:'0 4px 4px'}}>No brands on autopilot yet — pick one above and Mello emails a fresh ad every morning.</div>
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

      {/* Mello on Slack & WhatsApp — connect a channel to get the brief + approve from chat */}
      <ChannelsSection />

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
              {metaConnected == null ? 'Meta / Facebook — checking…' : metaConnected ? 'Meta / Facebook — Connected ✓' : 'Meta / Facebook'}
            </div>
            {/* Meta OAuth is gated while the new FB app is in review — show Coming soon, not a dead Connect
                link. If a user actually has a live connection, keep Reconnect/Disconnect available. */}
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              {metaConnected ? (
                <>
                  <a href="/connect-meta" style={{fontSize:13,color:'#1a3a1a',fontWeight:700,textDecoration:'none'}}>Reconnect →</a>
                  <button onClick={disconnectMeta} disabled={disconnecting} style={{fontSize:13,color:'#c0392b',fontWeight:700,background:'none',border:'none',fontFamily:'inherit',cursor:disconnecting?'default':'pointer',opacity:disconnecting?0.5:1,padding:0}}>
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : metaConnected === false ? (
                <span style={{background:'#f3f4f6',color:'#6b7280',padding:'7px 14px',borderRadius:100,fontSize:12,fontWeight:800,whiteSpace:'nowrap'}}>Coming soon</span>
              ) : null}
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

/** Connect Slack / WhatsApp: mint a login-proven code, the founder pastes it to the bot, they're linked. */
function ChannelsSection() {
  const [ids, setIds] = useState<{ id: string; provider: string; display?: string }[]>([])
  const [code, setCode] = useState<{ provider: string; code: string; instructions: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [testing, setTesting] = useState('')

  // Send a real report (with the top Approve button) to this channel right now, so the founder can
  // check the buttons work end-to-end without waiting for the morning cron.
  const sendTest = async (provider: string) => {
    setTesting(provider)
    try {
      const r = await fetch('/api/channels/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'report' }) }).then(res => res.json())
      if (r?.delivered) toast.success(`Sent — check your ${provider === 'slack' ? 'Slack' : 'WhatsApp'} ${provider === 'slack' ? '💬' : '🟢'}`)
      else toast.error(r?.error || 'Nothing was delivered — reconnect the channel and try again.')
    } catch { toast.error('Could not send — try again.') }
    setTesting('')
  }

  const load = () => fetch('/api/channels/link').then(r => r.json())
    .then(j => { if (Array.isArray(j.identities)) setIds(j.identities) }).catch(() => {})
  useEffect(() => {
    load()
    // After the "Add to Slack" OAuth round-trip we come back with ?slack=connected|error|…
    const p = new URLSearchParams(window.location.search).get('slack')
    if (p) {
      const msg: Record<string, string> = { connected: '✅ Slack connected — decisions land in your DM.', cancelled: 'Slack connect cancelled.', expired: 'That link expired — try again.', notconfigured: 'Slack isn’t set up on the server yet.', error: 'Slack connect failed — try again.' }
      if (p === 'connected') toast.success(msg[p]); else toast.error(msg[p] || 'Slack connect issue.')
      window.history.replaceState({}, '', '/settings')
    }
  }, [])

  const connect = async (provider: 'slack' | 'whatsapp') => {
    setBusy(provider); setCode(null)
    try {
      const j = await fetch('/api/channels/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) }).then(r => r.json())
      if (j?.code) setCode({ provider, code: j.code, instructions: j.instructions })
      else toast.error('Could not create a code')
    } finally { setBusy('') }
  }
  const disconnect = async (id: string) => {
    await fetch('/api/channels/link', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
    setIds(a => a.filter(x => x.id !== id)); setCode(null); toast.success('Disconnected')
  }
  const connected = (p: string) => ids.find(i => i.provider === p)

  const Row = ({ provider, label, emoji, how }: { provider: 'slack' | 'whatsapp'; label: string; emoji: string; how: string }) => {
    const c = connected(provider)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{emoji}</div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a1a' }}>{label}{c && <span style={{ fontSize: 11, fontWeight: 700, color: '#3b6d11', background: '#eaf3de', borderRadius: 20, padding: '2px 8px', marginLeft: 8 }}>Connected ✓</span>}</div>
            <div style={{ fontSize: 12.5, color: '#7a9a7a', marginTop: 2 }}>{how}</div>
          </div>
          {c ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => sendTest(provider)} disabled={testing === provider} style={{ padding: '7px 14px', borderRadius: 100, border: 'none', background: '#dffe95', color: '#1a3a1a', fontSize: 13, fontWeight: 800, cursor: testing === provider ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: testing === provider ? 0.6 : 1 }}>{testing === provider ? 'Sending…' : 'Send test →'}</button>
              <button onClick={() => disconnect(c.id)} style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#b91c1c', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Disconnect</button>
            </div>
          ) : provider === 'slack' ? (
            // One-click OAuth — no code to copy.
            <a href="/api/channels/slack/start" style={{ background: '#dffe95', color: '#1a3a1a', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>Add to Slack →</a>
          ) : (
            <button onClick={() => connect(provider)} disabled={busy === provider} style={{ background: '#dffe95', color: '#1a3a1a', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 800, border: 'none', cursor: busy === provider ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: busy === provider ? 0.6 : 1 }}>{busy === provider ? 'Creating…' : 'Connect →'}</button>
          )}
        </div>
        {code?.provider === provider && (
          <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 12, background: '#f8fcf6', border: '1px dashed #cfe6b8' }}>
            <div style={{ fontSize: 12.5, color: '#7a9a7a' }}>Your code (expires in 15 min):</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, color: '#1a3a1a', margin: '4px 0', fontFamily: 'ui-monospace, monospace' }}>{code.code}</div>
            <div style={{ fontSize: 12.5, color: '#1a3a1a' }}>{code.instructions}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(223,254,149,0.08)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a' }}>Mello on Slack &amp; WhatsApp</div>
        <div style={{ fontSize: 12.5, color: '#7a9a7a', marginTop: 3 }}>Get your morning brief and approve Mello&rsquo;s work right from chat — one tap, no dashboard.</div>
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Row provider="slack" label="Slack" emoji="💬" how="Approve with buttons and get reports in a channel or DM." />
        <div style={{ height: 1, background: '#f1f5f9' }} />
        <Row provider="whatsapp" label="WhatsApp" emoji="🟢" how="Reply YES to approve. Best for solo founders on the go." />
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
