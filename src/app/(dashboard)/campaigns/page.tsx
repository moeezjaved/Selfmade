'use client'
import { useState, useEffect } from 'react'
import AccountSelector from '@/components/AccountSelector'

const fmt = (n: number) => `PKR ${n.toLocaleString()}`

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [editModal, setEditModal] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingCreative, setUploadingCreative] = useState(false)
  const [uploadedCreativeHash, setUploadedCreativeHash] = useState<string|null>(null)
  const [expandedCamp, setExpandedCamp] = useState<Record<string, boolean>>({})
  const [expandedAdset, setExpandedAdset] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState('text')

  useEffect(() => { loadCampaigns() }, [selectedAccount])

  const loadCampaigns = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/campaigns/manage')
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } catch(e) {}
    setLoading(false)
  }

  const saveEdit = async () => {
    if (!editModal) return
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editModal)
      })
      const data = await res.json()
      if (data.error) alert('Error: ' + data.error)
      else { setEditModal(null); setUploadedCreativeHash(null); setUploadingCreative(false); await loadCampaigns() }
    } catch(e: any) { alert(e.message) }
    setSaving(false)
  }

  const toggleStatus = async (id: string, type: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    await fetch('/api/campaigns/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_status', id, type, status: newStatus })
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

  return (
    <div style={{ padding: 28, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a1a' }}>Campaigns</div>
          <div style={{ fontSize: 13, color: '#7a9a7a', marginTop: 2 }}>Manage your Meta campaigns, ad sets and ads</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={loadCampaigns} style={{ background: 'rgba(255,255,255,0.06)', color: '#3a5a3a', border: 'none', padding: '10px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>↻ Refresh</button>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '10px 22px', borderRadius: 100, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch New</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <img src='/favicon.png' style={{ width: 44, height: 44, borderRadius: 11, animation: 'spin 1s linear infinite', margin: '0 auto 16px', display: 'block' }} />
          <div style={{ color: '#1a3a1a', fontWeight: 700 }}>Loading campaigns...</div>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a1a', marginBottom: 16 }}>No campaigns found</div>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '10px 24px', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch First Campaign</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {campaigns.filter((c:any) => c.status === 'ACTIVE' || c.status === 'PAUSED').map(camp => (
            <div key={camp.id} style={{ background: '#ffffff', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => setExpandedCamp(prev => ({ ...prev, [camp.id]: !prev[camp.id] }))}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: camp.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a1a' }}>{camp.name}</div>
                  <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 2 }}>
                    {camp.status} · {camp.objective?.replace('OUTCOME_', '')} · {fmt(Math.round((camp.daily_budget || 0) / 100))}/day · {camp.created_time ? new Date(camp.created_time).toLocaleDateString('en-PK', {day:'numeric',month:'short',year:'numeric'}) : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); setEditModal({ action: 'update_budget', id: camp.id, name: camp.name, budget: Math.round((camp.daily_budget || 0) / 100) }) }}
                    style={{ background: '#1a3a1a', border: '1px solid #1a3a1a', color: '#dffe95', padding: '5px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                    💰 Budget
                  </button>
                  <button onClick={e => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', camp.status) }}
                    style={{ background: camp.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${camp.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: camp.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '5px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {camp.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                  </button>
                  <span style={{ fontSize: 14, color: '#8aaa8a' }}>{expandedCamp[camp.id] ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedCamp[camp.id] && (camp.adsets || []).map((adset: any) => (
                <div key={adset.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ padding: '12px 20px 12px 36px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.01)', cursor: 'pointer' }}
                    onClick={() => setExpandedAdset(prev => ({ ...prev, [adset.id]: !prev[adset.id] }))}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: adset.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a' }}>{adset.name}</div>
                      <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1 }}>{adset.status} · {adset.ads?.length || 0} ads</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={e => { e.stopPropagation(); openAdsetEdit(adset) }}
                        style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#2563eb', padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                        👥 Audience
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleStatus(adset.id, 'adset', adset.status) }}
                        style={{ background: adset.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${adset.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: adset.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                        {adset.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                      </button>
                      <span style={{ fontSize: 12, color: '#8aaa8a' }}>{expandedAdset[adset.id] ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {expandedAdset[adset.id] && (adset.ads || []).map((ad: any) => (
                    <div key={ad.id} style={{ padding: '12px 20px 12px 52px', borderTop: '1px solid rgba(255,255,255,0.03)', background: 'rgba(255,255,255,0.005)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: ad.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#2a4a2a' }}>{ad.name}</div>
                          {ad.primary_text && <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{ad.primary_text}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={e => { e.stopPropagation(); openAdEdit(ad) }}
                            style={{ background: '#dffe95', border: 'none', color: '#1a3a1a', padding: '6px 16px', borderRadius: 100, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
                            ✏️ Edit Ad
                          </button>
                          <button onClick={e => { e.stopPropagation(); toggleStatus(ad.id, 'ad', ad.status) }}
                            style={{ background: ad.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${ad.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: ad.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '6px 12px', borderRadius: 100, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                            {ad.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

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
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b8f6b', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Daily Budget (PKR)</label>
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
                          const fd = new FormData()
                          fd.append('file', f)
                          fd.append('isVideo', String(isVideo))
                          const res = await fetch('/api/m4/upload-image', { method: 'POST', body: fd })
                          const data = await res.json()
                          if (data.hash || data.videoId) {
                            setUploadedCreativeHash(data.hash || data.videoId)
                            setEditModal((p) => ({ ...p, new_creative_hash: data.hash || data.videoId, new_creative_is_video: isVideo }))
                          } else {
                            alert('Upload failed: ' + (data.error || 'Unknown error'))
                          }
                          setUploadingCreative(false)
                        } catch(err) {
                          setUploadingCreative(false)
                          alert('Upload error')
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
                          style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: `2px solid ${JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#dffe95' : 'rgba(255,255,255,0.1)'}`, background: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? 'rgba(223,254,149,0.1)' : 'transparent', color: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#dffe95' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
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
              <button onClick={() => { setEditModal(null); setUploadedCreativeHash(null); setUploadingCreative(false) }} style={{ flex: 1, background: 'none', border: '1.5px solid rgba(255,255,255,0.15)', color: '#6b8f6b', padding: '11px 0', borderRadius: 100, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={{ flex: 2, background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '11px 0', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
