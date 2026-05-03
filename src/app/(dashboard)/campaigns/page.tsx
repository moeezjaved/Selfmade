'use client'
import { useState, useEffect, useRef } from 'react'

const DATE_RANGES = [
  { label: 'Last 7 days', value: 'last_7d' },
  { label: 'Last 14 days', value: 'last_14d' },
  { label: 'Last 30 days', value: 'last_30d' },
  { label: 'Last 90 days', value: 'last_90d' },
]

const COLS = '44px 1fr 120px 86px 100px 106px 100px 100px 88px 148px'

const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)

const fmtCPA = (n: number, cur: string) =>
  n === 0 ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)

function ToggleSwitch({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange() }}
      style={{ width: 32, height: 18, borderRadius: 9, background: active ? '#4caf50' : '#ccc', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: active ? 16 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  )
}

function DeliveryBadge({ status, effectiveStatus }: { status: string; effectiveStatus?: string }) {
  const es = effectiveStatus || status
  if (es === 'ACTIVE') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50' }} />
        <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>Active</span>
      </div>
    )
  }
  if (es === 'PAUSED' || status === 'PAUSED') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9e9e9e' }} />
        <span style={{ fontSize: 12, color: '#616161', fontWeight: 600 }}>Paused</span>
      </div>
    )
  }
  if (es === 'CAMPAIGN_PAUSED') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff9800' }} />
        <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>Campaign off</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#bdbdbd' }} />
      <span style={{ fontSize: 12, color: '#757575', fontWeight: 600 }}>{status}</span>
    </div>
  )
}

function ColHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.05em', ...style }}>
      {children}
    </div>
  )
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('USD')
  const [dateRange, setDateRange] = useState('last_7d')
  const [editModal, setEditModal] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingCreative, setUploadingCreative] = useState(false)
  const [uploadedCreativeHash, setUploadedCreativeHash] = useState<string | null>(null)
  const [expandedCamp, setExpandedCamp] = useState<Record<string, boolean>>({})
  const [expandedAdset, setExpandedAdset] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState('text')

  // Chat assistant
  type ChatMsg = { role: 'user' | 'assistant'; content: string }
  const [chatCampaign, setChatCampaign] = useState<any>(null)
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([])
  // Persist history per campaign so reopening restores the conversation
  const chatHistoriesRef = useRef<Record<string, ChatMsg[]>>({})
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatCreativeHash, setChatCreativeHash] = useState<string | null>(null)
  const [chatIsVideo, setChatIsVideo] = useState(false)
  const [chatCreativeName, setChatCreativeName] = useState<string | null>(null)
  const [chatUploadingCreative, setChatUploadingCreative] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const chatFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadCampaigns() }, [dateRange])

  const loadCampaigns = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns/manage?dateRange=${dateRange}`)
      const data = await res.json()
      setCampaigns(data.campaigns || [])
      if (data.currency) setCurrency(data.currency)
    } catch {}
    setLoading(false)
  }

  const saveEdit = async () => {
    if (!editModal) return
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editModal),
      })
      const data = await res.json()
      if (data.error) alert('Error: ' + data.error)
      else { setEditModal(null); setUploadedCreativeHash(null); setUploadingCreative(false); await loadCampaigns() }
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const toggleStatus = async (id: string, type: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    await fetch('/api/campaigns/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_status', id, type, status: newStatus }),
    })
    await loadCampaigns()
  }

  const openAdEdit = (ad: any) => {
    setActiveTab('text')
    setEditModal({
      action: 'update_ad',
      id: ad.id,
      name: ad.name,
      primary_text: ad.primary_text || '',
      headline: ad.headline || '',
      link_url: ad.link_url || '',
      creative_id: ad.creative_id,
    })
  }

  const openAdsetEdit = (adset: any) => {
    setEditModal({
      action: 'update_adset',
      id: adset.id,
      name: adset.name,
      age_min: adset.age_min || 18,
      age_max: adset.age_max || 65,
      genders: adset.genders || [],
    })
  }

  const openChat = (camp: any) => {
    setChatCampaign(camp)
    // Restore existing history for this campaign, or show welcome message
    const saved = chatHistoriesRef.current[camp.id]
    setChatHistory(saved ?? [{
      role: 'assistant',
      content: `Hi! I'm your campaign assistant for "${camp.name}". I can help you:\n• Add a new ad set with a new creative (upload an image/video below)\n• Change the daily budget — e.g. "Set budget to 5000"\n• Pause or activate the campaign or any ad set\n• Delete an ad set — e.g. "Delete the retargeting ad set"\n\nWhat would you like to do?`,
    }])
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatBusy || !chatCampaign) return
    setChatInput('')
    const userMsg: ChatMsg = { role: 'user', content: msg }
    const withUser = [...chatHistory, userMsg]
    setChatHistory(withUser)
    chatHistoriesRef.current[chatCampaign.id] = withUser
    setChatBusy(true)
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      const res = await fetch('/api/campaigns/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: chatCampaign,
          message: msg,
          history: chatHistory,
          uploaded_creative_hash: chatCreativeHash,
          uploaded_is_video: chatIsVideo,
        }),
      })
      const data = await res.json()
      const assistantMsg: ChatMsg = { role: 'assistant', content: data.reply || 'Done.' }
      const withAssistant = [...withUser, assistantMsg]
      setChatHistory(withAssistant)
      chatHistoriesRef.current[chatCampaign.id] = withAssistant
      if (data.reload) {
        setChatCreativeHash(null)
        setChatCreativeName(null)
        await loadCampaigns()
        setChatCampaign((prev: any) => campaigns.find((c: any) => c.id === prev?.id) || prev)
      }
    } catch {
      const errMsg: ChatMsg = { role: 'assistant', content: 'Something went wrong. Please try again.' }
      const withErr = [...withUser, errMsg]
      setChatHistory(withErr)
      chatHistoriesRef.current[chatCampaign.id] = withErr
    }
    setChatBusy(false)
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const uploadChatCreative = async (file: File) => {
    setChatUploadingCreative(true)
    setChatCreativeHash(null)
    setChatCreativeName(file.name)
    const isVideo = file.type.startsWith('video/')
    setChatIsVideo(isVideo)
    try {
      if (isVideo) {
        // Videos go direct to Supabase (presigned URL) to bypass Vercel's 4.5MB body limit,
        // then we register the stored URL with Meta via the PUT endpoint.
        const presignRes = await fetch('/api/m4/upload-presigned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        })
        const presignText = await presignRes.text()
        let presign: any = {}
        try { presign = JSON.parse(presignText) } catch {
          throw new Error('Presign error: ' + presignText.slice(0, 120))
        }
        if (presign.error) throw new Error(presign.error)

        // Upload directly to Supabase storage (no Vercel in the path)
        const uploadRes = await fetch(presign.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!uploadRes.ok) throw new Error('Storage upload failed: ' + uploadRes.status)

        // Register the stored video with Meta
        const metaRes = await fetch('/api/m4/upload-image', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: presign.path, bucket: presign.bucket }),
        })
        const metaText = await metaRes.text()
        let metaData: any = {}
        try { metaData = JSON.parse(metaText) } catch {
          throw new Error('Meta register error: ' + metaText.slice(0, 120))
        }
        if (metaData.error) throw new Error(metaData.error)
        setChatCreativeHash(metaData.videoId || metaData.hash)
        setChatHistory(h => [...h, { role: 'assistant', content: `✅ Video uploaded! Now tell me what you'd like to do — e.g. "Add this to a new ad set called Retargeting".` }])
      } else {
        // Images: compress if needed, then upload through server
        let fileToUpload: File | Blob = file
        if (file.size > 3 * 1024 * 1024) {
          fileToUpload = await new Promise<Blob>((resolve, reject) => {
            const img = new Image()
            const url = URL.createObjectURL(file)
            img.onload = () => {
              URL.revokeObjectURL(url)
              const scale = Math.sqrt((3 * 1024 * 1024) / file.size)
              const canvas = document.createElement('canvas')
              canvas.width = Math.round(img.width * scale)
              canvas.height = Math.round(img.height * scale)
              canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
              canvas.toBlob(b => b ? resolve(b) : reject(new Error('Resize failed')), 'image/jpeg', 0.88)
            }
            img.onerror = reject
            img.src = url
          })
        }
        const fd = new FormData()
        fd.append('file', fileToUpload, file.name)
        fd.append('isVideo', 'false')
        const res = await fetch('/api/m4/upload-image', { method: 'POST', body: fd })
        const text = await res.text()
        let data: any = {}
        try { data = JSON.parse(text) } catch {
          throw new Error('Server error: ' + text.slice(0, 120))
        }
        if (data.error) throw new Error(data.error)
        setChatCreativeHash(data.hash)
        setChatHistory(h => [...h, { role: 'assistant', content: `✅ Image uploaded! Now tell me what you'd like to do — e.g. "Add this to a new ad set called Retargeting".` }])
      }
    } catch (err: any) {
      setChatHistory(h => [...h, { role: 'assistant', content: '❌ Upload failed: ' + err.message }])
    }
    setChatUploadingCreative(false)
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const rowBase: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: COLS,
    alignItems: 'center',
    minHeight: 48,
    gap: 0,
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a1a' }}>Campaigns</div>
          <div style={{ fontSize: 13, color: '#7a9a7a', marginTop: 2 }}>Manage your Meta campaigns, ad sets and ads</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Date range selector */}
          <div style={{ display: 'flex', background: '#f0f7ee', borderRadius: 10, padding: 3, gap: 2 }}>
            {DATE_RANGES.map(dr => (
              <button key={dr.value} onClick={() => setDateRange(dr.value)}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: dateRange === dr.value ? '#1a3a1a' : 'transparent', color: dateRange === dr.value ? '#dffe95' : '#4a6a4a', transition: 'all .15s' }}>
                {dr.label}
              </button>
            ))}
          </div>
          <button onClick={loadCampaigns} style={{ background: '#f0f7ee', color: '#3a5a3a', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>↻ Refresh</button>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch New</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <img src='/favicon.png' style={{ width: 44, height: 44, borderRadius: 11, animation: 'spin 1s linear infinite', margin: '0 auto 16px', display: 'block' }} />
          <div style={{ color: '#1a3a1a', fontWeight: 700 }}>Loading campaigns...</div>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid #e8f0e8', borderRadius: 16, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a1a', marginBottom: 16 }}>No active or paused campaigns found</div>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '10px 24px', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch First Campaign</button>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e8f0e8', borderRadius: 16, overflow: 'hidden' }}>
          {/* Sticky table header */}
          <div style={{ ...rowBase, padding: '0 16px', borderBottom: '2px solid #e8f0e8', background: '#f8fbf7', position: 'sticky', top: 0, zIndex: 10 }}>
            <div />
            <ColHeader style={{ paddingLeft: 8 }}>Campaign / Ad Set</ColHeader>
            <ColHeader>Delivery</ColHeader>
            <ColHeader>Results</ColHeader>
            <ColHeader>Cost/Result</ColHeader>
            <ColHeader>Budget/Day</ColHeader>
            <ColHeader>Spent</ColHeader>
            <ColHeader>Impressions</ColHeader>
            <ColHeader>Reach</ColHeader>
            <ColHeader style={{ textAlign: 'right' }}>Actions</ColHeader>
          </div>

          {campaigns.map((camp: any, ci_) => (
            <div key={camp.id} style={{ borderBottom: ci_ < campaigns.length - 1 ? '1px solid #e8f0e8' : 'none' }}>
              {/* Campaign row */}
              <div style={{ ...rowBase, padding: '0 16px', background: '#fff', cursor: 'pointer', transition: 'background .1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f8fbf7')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                onClick={() => setExpandedCamp(prev => ({ ...prev, [camp.id]: !prev[camp.id] }))}>
                {/* Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48 }}>
                  <ToggleSwitch active={camp.status === 'ACTIVE'} onChange={() => toggleStatus(camp.id, 'campaign', camp.status)} />
                </div>
                {/* Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, overflow: 'hidden' }}>
                  <span style={{ fontSize: 11, color: '#9e9e9e', transition: 'transform .15s', display: 'inline-block', transform: expandedCamp[camp.id] ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{camp.name}</div>
                    <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1 }}>{camp.objective?.replace('OUTCOME_', '') || ''}</div>
                  </div>
                </div>
                {/* Delivery */}
                <div><DeliveryBadge status={camp.status} effectiveStatus={camp.effective_status} /></div>
                {/* Results */}
                <div style={{ fontSize: 13, fontWeight: 700, color: camp.conversions > 0 ? '#2e7d32' : '#9e9e9e' }}>
                  {camp.conversions > 0 ? camp.conversions : '—'}
                  {camp.conversions > 0 && <div style={{ fontSize: 10, color: '#7a9a7a', fontWeight: 500 }}>purchases</div>}
                </div>
                {/* Cost/Result */}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a' }}>{fmtCPA(camp.cpa, currency)}</div>
                {/* Budget */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a' }}>{camp.daily_budget ? fmt(Math.round(camp.daily_budget / 100), currency) : '—'}</div>
                  <div style={{ fontSize: 10, color: '#8aaa8a' }}>daily</div>
                </div>
                {/* Spent */}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a' }}>{camp.spend > 0 ? fmt(camp.spend, currency) : '—'}</div>
                {/* Impressions */}
                <div style={{ fontSize: 13, color: camp.impressions > 0 ? '#1a3a1a' : '#9e9e9e' }}>
                  {camp.impressions > 0 ? camp.impressions.toLocaleString() : '—'}
                </div>
                {/* Reach */}
                <div style={{ fontSize: 13, color: camp.reach > 0 ? '#1a3a1a' : '#9e9e9e' }}>
                  {camp.reach > 0 ? camp.reach.toLocaleString() : '—'}
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => openChat(camp)}
                    style={{ background: '#1a3a1a', color: '#dffe95', border: 'none', padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 14 }}>✨</span>
                    <span>Manage with AI</span>
                  </button>
                </div>
              </div>

              {/* Adsets */}
              {expandedCamp[camp.id] && (camp.adsets || []).map((adset: any, ai_: number) => (
                <div key={adset.id}>
                  {/* Adset row */}
                  <div style={{ ...rowBase, padding: '0 16px', background: '#fafcfa', borderTop: '1px solid #f0f5f0', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f4f8f4')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fafcfa')}
                    onClick={() => setExpandedAdset(prev => ({ ...prev, [adset.id]: !prev[adset.id] }))}>
                    {/* Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44 }}>
                      <ToggleSwitch active={adset.status === 'ACTIVE'} onChange={() => toggleStatus(adset.id, 'adset', adset.status)} />
                    </div>
                    {/* Name — indented */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28, overflow: 'hidden' }}>
                      <span style={{ fontSize: 10, color: '#b0b0b0', transition: 'transform .15s', display: 'inline-block', transform: expandedAdset[adset.id] ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#2a4a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adset.name}</div>
                        <div style={{ fontSize: 10, color: '#8aaa8a', marginTop: 1 }}>Age {adset.age_min}–{adset.age_max} · {adset.genders?.length === 1 ? (adset.genders[0] === 1 ? 'Male' : 'Female') : 'All'} · {adset.ads?.length || 0} ads</div>
                      </div>
                    </div>
                    {/* Delivery */}
                    <div><DeliveryBadge status={adset.status} /></div>
                    {/* Results */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: adset.conversions > 0 ? '#2e7d32' : '#9e9e9e' }}>
                      {adset.conversions > 0 ? adset.conversions : '—'}
                    </div>
                    {/* CPA */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a1a' }}>{fmtCPA(adset.cpa, currency)}</div>
                    {/* Budget */}
                    <div style={{ fontSize: 12, color: '#616161' }}>{adset.daily_budget ? fmt(Math.round(adset.daily_budget / 100), currency) : '—'}</div>
                    {/* Spent */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a1a' }}>{adset.spend > 0 ? fmt(adset.spend, currency) : '—'}</div>
                    </div>
                    {/* Impressions */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: adset.impressions > 0 ? '#1a3a1a' : '#9e9e9e' }}>
                        {adset.impressions > 0 ? adset.impressions.toLocaleString() : '—'}
                      </div>
                    </div>
                    {/* Reach */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: adset.reach > 0 ? '#1a3a1a' : '#9e9e9e' }}>
                        {adset.reach > 0 ? adset.reach.toLocaleString() : '—'}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => openAdsetEdit(adset)}
                        style={{ background: '#e8f0ff', color: '#2563eb', border: 'none', padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }} title="Edit Audience">
                        👥
                      </button>
                    </div>
                  </div>

                  {/* Ads */}
                  {expandedAdset[adset.id] && (adset.ads || []).map((ad: any) => (
                    <div key={ad.id} style={{ ...rowBase, padding: '0 16px', background: '#f7fbf7', borderTop: '1px solid #eef3ee' }}>
                      {/* Toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52 }}>
                        <ToggleSwitch active={ad.status === 'ACTIVE'} onChange={() => toggleStatus(ad.id, 'ad', ad.status)} />
                      </div>
                      {/* Name — deeply indented with thumbnail */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 52, overflow: 'hidden' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#e8f0e8', border: '1px solid rgba(0,0,0,.06)' }}>
                          {ad.thumbnail_url ? (
                            <img src={ad.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎨</div>
                          )}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#2a4a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.name}</div>
                          {ad.primary_text && <div style={{ fontSize: 10, color: '#8aaa8a', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{ad.primary_text}</div>}
                        </div>
                      </div>
                      {/* Delivery */}
                      <div><DeliveryBadge status={ad.status} /></div>
                      {/* Results — ads don't have separate insight in this view */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* CPA */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* Budget */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* Spent */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* Impressions */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* Reach */}
                      <div style={{ fontSize: 12, color: '#9e9e9e' }}>—</div>
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {ad.preview_url && (
                          <a href={ad.preview_url} target="_blank" rel="noopener noreferrer"
                            style={{ background: '#f0f7ee', color: '#1a3a1a', border: 'none', padding: '5px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center' }} title="View Ad">
                            👁
                          </a>
                        )}
                        <button onClick={() => openAdEdit(ad)}
                          style={{ background: '#f0f7ee', color: '#1a3a1a', border: 'none', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }} title="Edit Ad">
                          ✏️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Edit modals — preserved exactly */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#ffffff', border: '1px solid rgba(223,254,149,0.2)', borderRadius: 20, width: '100%', maxWidth: 500 }}>
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#1a3a1a', marginBottom: 4 }}>
                {editModal.action === 'update_budget' ? '💰 Edit Budget' : editModal.action === 'update_adset' ? '👥 Edit Audience' : '✏️ Edit Ad'}
              </div>
              <div style={{ fontSize: 12, color: '#7a9a7a', marginBottom: 16 }}>{editModal.name}</div>
              {editModal.action === 'update_ad' && (
                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {[{ key: 'text', label: '📝 Copy' }, { key: 'url', label: '🔗 URL' }, { key: 'creative', label: '🎨 Creative' }].map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                      style={{ padding: '8px 16px', background: 'none', border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: activeTab === t.key ? '#1a3a1a' : '#8aaa8a', borderBottom: `2px solid ${activeTab === t.key ? '#1a3a1a' : 'transparent'}`, marginBottom: -1 }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '20px 24px' }}>
              {editModal.action === 'update_budget' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Daily Budget ({currency})</label>
                  <input type="number" value={editModal.budget}
                    onChange={e => setEditModal((p: any) => ({ ...p, budget: parseFloat(e.target.value) }))}
                    style={{ width: '100%', background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: '12px 14px', color: '#1a3a1a', fontSize: 18, fontWeight: 800, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                  <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 8 }}>⚠️ Changing by more than 20% resets Meta learning phase</div>
                </div>
              )}

              {editModal.action === 'update_ad' && activeTab === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Primary Text</label>
                    <textarea value={editModal.primary_text} onChange={e => setEditModal((p: any) => ({ ...p, primary_text: e.target.value }))} rows={5}
                      style={{ width: '100%', background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: '10px 14px', color: '#1a3a1a', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Headline</label>
                    <input type="text" value={editModal.headline} onChange={e => setEditModal((p: any) => ({ ...p, headline: e.target.value }))}
                      style={{ width: '100%', background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: '10px 14px', color: '#1a3a1a', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </div>
              )}

              {editModal.action === 'update_ad' && activeTab === 'url' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Destination URL</label>
                    <input type="text" value={editModal.link_url} onChange={e => setEditModal((p: any) => ({ ...p, link_url: e.target.value }))}
                      style={{ width: '100%', background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: '10px 14px', color: '#1a3a1a', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#8aaa8a', background: '#f8fcf6', padding: 12, borderRadius: 8 }}>
                    💡 Make sure the URL matches your ad offer. Mismatched URLs hurt conversions.
                  </div>
                </div>
              )}

              {editModal.action === 'update_ad' && activeTab === 'creative' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background: '#f8fcf6', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a', marginBottom: 4 }}>Upload New Creative</div>
                    <div style={{ fontSize: 12, color: '#7a9a7a', marginBottom: 16 }}>Replace the image or video for this ad</div>
                    <input type="file" accept="image/*,video/*" id="creative-upload"
                      onChange={async e => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        setUploadingCreative(true)
                        setUploadedCreativeHash(null)
                        setEditModal((p: any) => ({ ...p, new_creative_name: f.name }))
                        try {
                          const isVideo = f.type.startsWith('video/')
                          let fileToUpload: File | Blob = f
                          if (!isVideo && f.size > 3 * 1024 * 1024) {
                            fileToUpload = await new Promise<Blob>((resolve, reject) => {
                              const img = new Image()
                              const url = URL.createObjectURL(f)
                              img.onload = () => {
                                URL.revokeObjectURL(url)
                                const scale = Math.sqrt((3 * 1024 * 1024) / f.size)
                                const canvas = document.createElement('canvas')
                                canvas.width = Math.round(img.width * scale)
                                canvas.height = Math.round(img.height * scale)
                                canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
                                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Resize failed')), 'image/jpeg', 0.88)
                              }
                              img.onerror = reject
                              img.src = url
                            })
                          }
                          const fd = new FormData()
                          fd.append('file', fileToUpload, f.name)
                          fd.append('isVideo', String(isVideo))
                          const res = await fetch('/api/m4/upload-image', { method: 'POST', body: fd })
                          const text = await res.text()
                          let data: any = {}
                          try { data = JSON.parse(text) } catch { alert('Upload error (bad response): ' + text.slice(0, 200)); setUploadingCreative(false); return }
                          if (data.hash || data.videoId) {
                            setUploadedCreativeHash(data.hash || data.videoId)
                            setEditModal((p: any) => ({ ...p, new_creative_hash: data.hash || data.videoId, new_creative_is_video: isVideo }))
                          } else {
                            alert('Upload failed: ' + (data.error || 'Unknown error'))
                          }
                          setUploadingCreative(false)
                        } catch (err: any) {
                          setUploadingCreative(false)
                          alert('Upload error: ' + err.message)
                        }
                      }}
                      style={{ display: 'none' }} />
                    <label htmlFor="creative-upload" style={{ background: '#1a3a1a', color: '#dffe95', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-block' }}>
                      {uploadingCreative ? '⏳ Uploading...' : '📁 Choose File'}
                    </label>
                    {uploadingCreative && <div style={{ marginTop: 12, fontSize: 12, color: '#b8860b', fontWeight: 600 }}>⏳ Uploading to Meta...</div>}
                    {uploadedCreativeHash && <div style={{ marginTop: 12, fontSize: 12, color: '#2d7a2d', fontWeight: 700 }}>✅ Uploaded to Meta — ready to save</div>}
                    {editModal.new_creative_name && !uploadingCreative && !uploadedCreativeHash && <div style={{ marginTop: 12, fontSize: 12, color: '#8aaa8a' }}>{editModal.new_creative_name}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8aaa8a' }}>⚠️ Changing creative resets learning phase and social proof</div>
                </div>
              )}

              {editModal.action === 'update_adset' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Age Range</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input type="number" value={editModal.age_min} min={18} max={65}
                        onChange={e => setEditModal((p: any) => ({ ...p, age_min: parseInt(e.target.value) }))}
                        style={{ width: 80, background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '8px 12px', color: '#1a3a1a', fontSize: 14, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
                      <span style={{ color: '#7a9a7a' }}>to</span>
                      <input type="number" value={editModal.age_max} min={18} max={65}
                        onChange={e => setEditModal((p: any) => ({ ...p, age_max: parseInt(e.target.value) }))}
                        style={{ width: 80, background: '#f8fcf6', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '8px 12px', color: '#1a3a1a', fontSize: 14, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Gender</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[{ label: 'All', value: [] }, { label: '👨 Male', value: [1] }, { label: '👩 Female', value: [2] }].map(g => (
                        <button key={g.label} onClick={() => setEditModal((p: any) => ({ ...p, genders: g.value }))}
                          style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: `2px solid ${JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#1a3a1a' : 'rgba(0,0,0,0.1)'}`, background: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#f0f7ee' : 'transparent', color: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#1a3a1a' : '#6b8f6b', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#8aaa8a', background: '#f8fcf6', padding: 12, borderRadius: 8 }}>
                    ⚠️ Changing audience resets Meta learning phase
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
              <button onClick={() => { setEditModal(null); setUploadedCreativeHash(null); setUploadingCreative(false) }}
                style={{ flex: 1, background: 'none', border: '1.5px solid rgba(0,0,0,0.12)', color: '#6b8f6b', padding: '11px 0', borderRadius: 100, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                style={{ flex: 2, background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '11px 0', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Chat Drawer ─────────────────────────────────────────── */}
      {chatCampaign && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', pointerEvents: 'none', alignItems: 'stretch' }}>
          {/* Backdrop — click-through, close only via X button */}
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.25)', pointerEvents: 'none' }} />

          {/* Drawer panel */}
          <div style={{ width: 400, background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 32px rgba(0,0,0,0.18)', pointerEvents: 'auto' }}>
            {/* Header */}
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #e8f0e8', background: '#1a3a1a', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#dffe95' }}>✨ Campaign Assistant</div>
                <div style={{ fontSize: 11, color: '#7a9a7a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatCampaign.name}</div>
              </div>
              <button onClick={() => setChatCampaign(null)}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#dffe95', width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {/* Campaign quick stats */}
            <div style={{ padding: '10px 18px', background: '#f8fbf7', borderBottom: '1px solid #e8f0e8', display: 'flex', gap: 16 }}>
              <div style={{ fontSize: 11 }}>
                <div style={{ color: '#8aaa8a', marginBottom: 1 }}>Status</div>
                <div style={{ fontWeight: 700, color: chatCampaign.status === 'ACTIVE' ? '#2e7d32' : '#757575' }}>{chatCampaign.status}</div>
              </div>
              <div style={{ fontSize: 11 }}>
                <div style={{ color: '#8aaa8a', marginBottom: 1 }}>Budget/Day</div>
                <div style={{ fontWeight: 700, color: '#1a3a1a' }}>{chatCampaign.daily_budget ? fmt(Math.round(chatCampaign.daily_budget / 100), currency) : '—'}</div>
              </div>
              <div style={{ fontSize: 11 }}>
                <div style={{ color: '#8aaa8a', marginBottom: 1 }}>Spent</div>
                <div style={{ fontWeight: 700, color: '#1a3a1a' }}>{chatCampaign.spend > 0 ? fmt(chatCampaign.spend, currency) : '—'}</div>
              </div>
              <div style={{ fontSize: 11 }}>
                <div style={{ color: '#8aaa8a', marginBottom: 1 }}>Results</div>
                <div style={{ fontWeight: 700, color: '#1a3a1a' }}>{chatCampaign.conversions > 0 ? chatCampaign.conversions : '—'}</div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatHistory.map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '88%',
                    padding: '9px 13px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? '#1a3a1a' : '#f0f7ee',
                    color: msg.role === 'user' ? '#dffe95' : '#1a3a1a',
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatBusy && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '9px 13px', borderRadius: '16px 16px 16px 4px', background: '#f0f7ee', fontSize: 13, color: '#7a9a7a' }}>
                    <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Creative upload indicator */}
            {(chatCreativeHash || chatUploadingCreative || chatCreativeName) && (
              <div style={{ padding: '8px 16px', background: '#f0f7ee', borderTop: '1px solid #e8f0e8', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 18 }}>{chatIsVideo ? '🎬' : '🖼️'}</div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: chatCreativeHash ? '#2e7d32' : '#b8860b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chatUploadingCreative ? '⏳ Uploading to Meta…' : chatCreativeHash ? '✅ Creative ready' : chatCreativeName}
                  </div>
                  {chatCreativeName && <div style={{ fontSize: 10, color: '#8aaa8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatCreativeName}</div>}
                </div>
                {!chatUploadingCreative && (
                  <button onClick={() => { setChatCreativeHash(null); setChatCreativeName(null) }}
                    style={{ background: 'none', border: 'none', color: '#9e9e9e', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                )}
              </div>
            )}

            {/* Input area */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid #e8f0e8', background: '#fff' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                {/* File upload */}
                <input type="file" accept="image/*,video/*" ref={chatFileRef}
                  onChange={e => { const f = e.target.files?.[0]; if (f) { uploadChatCreative(f); e.target.value = '' } }}
                  style={{ display: 'none' }} />
                <button onClick={() => chatFileRef.current?.click()} disabled={chatUploadingCreative}
                  style={{ background: '#f0f7ee', border: 'none', color: '#1a3a1a', width: 36, height: 36, borderRadius: 10, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="Upload creative">
                  📎
                </button>
                {/* Text input */}
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                  placeholder='e.g. "Add this creative to a new ad set" or "Increase budget to 8000"'
                  rows={2}
                  style={{ flex: 1, background: '#f8fbf7', border: '1px solid #e8f0e8', borderRadius: 10, padding: '8px 12px', color: '#1a3a1a', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'none', lineHeight: 1.5 }}
                />
                {/* Send */}
                <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}
                  style={{ background: chatBusy || !chatInput.trim() ? '#e8f0e8' : '#dffe95', color: '#1a3a1a', border: 'none', width: 36, height: 36, borderRadius: 10, cursor: chatBusy || !chatInput.trim() ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}>
                  ↑
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#b0b0b0', marginTop: 6, textAlign: 'center' }}>Enter to send · Shift+Enter for new line · 📎 to attach a creative</div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
      `}</style>
    </div>
  )
}
