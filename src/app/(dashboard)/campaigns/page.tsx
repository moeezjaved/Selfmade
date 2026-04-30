'use client'
import { useState, useEffect } from 'react'

const fmt = (n: number) => `PKR ${n.toLocaleString()}`

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [expandedCamp, setExpandedCamp] = useState<Record<string, boolean>>({})
  const [expandedAdset, setExpandedAdset] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState('text')

  useEffect(() => { loadCampaigns() }, [])

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
      else { setEditModal(null); await loadCampaigns() }
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
      type: 'ad',
      name: ad.name,
      primary_text: ad.primary_text || '',
      headline: ad.headline || '',
      link_url: ad.link_url || '',
      creative_id: ad.creative_id,
    })
  }

  const openAdsetEdit = (adset: any) => {
    setActiveTab('audience')
    setEditModal({
      action: 'update_adset',
      id: adset.id,
      type: 'adset',
      name: adset.name,
      age_min: adset.age_min || 18,
      age_max: adset.age_max || 65,
      genders: adset.genders || [],
    })
  }

  const tabs = editModal?.action === 'update_ad'
    ? [
        { key: 'text', label: '📝 Copy' },
        { key: 'url', label: '🔗 URL' },
        { key: 'creative', label: '🎨 Creative' },
      ]
    : editModal?.action === 'update_adset'
    ? [{ key: 'audience', label: '👥 Audience' }]
    : [{ key: 'budget', label: '💰 Budget' }]

  return (
    <div style={{ padding: 28, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'white' }}>Campaigns</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Manage your Meta campaigns, ad sets and ads</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={loadCampaigns} style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: 'none', padding: '10px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>↻ Refresh</button>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#10211f', border: 'none', padding: '10px 22px', borderRadius: 100, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch New</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <img src='/favicon.png' style={{ width: 44, height: 44, borderRadius: 11, animation: 'spin 1s linear infinite', margin: '0 auto 16px', display: 'block' }} />
          <div style={{ color: 'white', fontWeight: 700 }}>Loading campaigns...</div>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: '#152928', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 16 }}>No campaigns found</div>
          <button onClick={() => window.location.href = '/m4'} style={{ background: '#dffe95', color: '#10211f', border: 'none', padding: '10px 24px', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>🚀 Launch First Campaign</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {campaigns.map(camp => (
            <div key={camp.id} style={{ background: '#152928', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, overflow: 'hidden' }}>

              {/* Campaign Row */}
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => setExpandedCamp(p => ({ ...p, [camp.id]: !p[camp.id] }))}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: camp.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'white' }}>{camp.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {camp.status} · {camp.objective?.replace('OUTCOME_', '')} · {fmt(Math.round((camp.daily_budget || 0) / 100))}/day · {camp.adsets?.length || 0} ad sets
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); setEditModal({ action: 'update_budget', id: camp.id, type: 'campaign', name: camp.name, budget: Math.round((camp.daily_budget || 0) / 100) }) }}
                    style={{ background: 'rgba(223,254,149,0.1)', border: '1px solid rgba(223,254,149,0.2)', color: '#dffe95', padding: '5px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                    💰 Budget
                  </button>
                  <button onClick={e => { e.stopPropagation(); toggleStatus(camp.id, 'campaign', camp.status) }}
                    style={{ background: camp.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${camp.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: camp.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '5px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {camp.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                  </button>
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>{expandedCamp[camp.id] ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Adsets */}
              {expandedCamp[camp.id] && (camp.adsets || []).map((adset: any) => (
                <div key={adset.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ padding: '12px 20px 12px 36px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.01)', cursor: 'pointer' }}
                    onClick={() => setExpandedAdset(p => ({ ...p, [adset.id]: !p[adset.id] }))}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: adset.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>{adset.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{adset.status} · {adset.ads?.length || 0} ads</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={e => { e.stopPropagation(); openAdsetEdit(adset) }}
                        style={{ background: 'rgba(147,197,253,0.1)', border: '1px solid rgba(147,197,253,0.2)', color: '#93c5fd', padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                        👥 Audience
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleStatus(adset.id, 'adset', adset.status) }}
                        style={{ background: adset.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${adset.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: adset.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                        {adset.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                      </button>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{expandedAdset[adset.id] ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Ads */}
                  {expandedAdset[adset.id] && (adset.ads || []).map((ad: any) => (
                    <div key={ad.id} style={{ padding: '10px 20px 10px 52px', borderTop: '1px solid rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.005)' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: ad.status === 'ACTIVE' ? '#86efac' : 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>{ad.name}</div>
                        {ad.primary_text && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{ad.primary_text}</div>}
                        {ad.link_url && <div style={{ fontSize: 10, color: 'rgba(147,197,253,0.6)', marginTop: 1 }}>🔗 {ad.link_url}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => openAdEdit(ad)}
                          style={{ background: 'rgba(223,254,149,0.08)', border: '1px solid rgba(223,254,149,0.15)', color: '#dffe95', padding: '4px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                          ✏️ Edit Ad
                        </button>
                        <button onClick={() => toggleStatus(ad.id, 'ad', ad.status)}
                          style={{ background: ad.status === 'ACTIVE' ? 'rgba(248,113,113,0.1)' : 'rgba(134,239,172,0.1)', border: `1px solid ${ad.status === 'ACTIVE' ? 'rgba(248,113,113,0.2)' : 'rgba(134,239,172,0.2)'}`, color: ad.status === 'ACTIVE' ? '#f87171' : '#86efac', padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                          {ad.status === 'ACTIVE' ? 'Pause' : 'Activate'}
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

      {/* Edit Modal */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#152928', border: '1px solid rgba(223,254,149,0.2)', borderRadius: 20, width: '100%', maxWidth: 500 }}>

            {/* Modal Header */}
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: 'white', marginBottom: 4 }}>
                {editModal.action === 'update_budget' ? '💰 Edit Budget' : editModal.action === 'update_adset' ? '👥 Edit Audience' : '✏️ Edit Ad'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>{editModal.name}</div>

              {/* Tabs */}
              {tabs.length > 1 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 0 }}>
                  {tabs.map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                      style={{ padding: '8px 16px', background: 'none', border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: activeTab === t.key ? '#dffe95' : 'rgba(255,255,255,0.4)', borderBottom: `2px solid ${activeTab === t.key ? '#dffe95' : 'transparent'}`, marginBottom: -1 }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Content */}
            <div style={{ padding: '20px 24px' }}>

              {/* Budget */}
              {editModal.action === 'update_budget' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Daily Budget (PKR)</label>
                  <input type="number" value={editModal.budget}
                    onChange={e => setEditModal((p: any) => ({ ...p, budget: parseFloat(e.target.value) }))}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', color: 'white', fontSize: 18, fontWeight: 800, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>⚠️ Changing budget by more than 20% resets Meta learning phase</div>
                </div>
              )}

              {/* Ad Copy Tab */}
              {editModal.action === 'update_ad' && activeTab === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="Primary Text" value={editModal.primary_text}
                    onChange={(v: string) => setEditModal((p: any) => ({ ...p, primary_text: v }))} multiline />
                  <Field label="Headline" value={editModal.headline}
                    onChange={(v: string) => setEditModal((p: any) => ({ ...p, headline: v }))} />
                </div>
              )}

              {/* URL Tab */}
              {editModal.action === 'update_ad' && activeTab === 'url' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Field label="Destination URL" value={editModal.link_url}
                    onChange={(v: string) => setEditModal((p: any) => ({ ...p, link_url: v }))} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                    💡 Make sure the URL matches your ad's offer. Mismatched URLs hurt conversion rates.
                  </div>
                </div>
              )}

              {/* Creative Tab */}
              {editModal.action === 'update_ad' && activeTab === 'creative' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginBottom: 4 }}>Change Creative</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>Upload a new image or video for this ad</div>
                    <input type="file" accept="image/*,video/*"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) setEditModal((p: any) => ({ ...p, new_creative_file: file, new_creative_name: file.name }))
                      }}
                      style={{ display: 'none' }} id="creative-upload" />
                    <label htmlFor="creative-upload" style={{ background: '#dffe95', color: '#10211f', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-block' }}>
                      Upload Image / Video
                    </label>
                    {editModal.new_creative_name && (
                      <div style={{ marginTop: 12, fontSize: 12, color: '#86efac' }}>✅ {editModal.new_creative_name} selected</div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                    ⚠️ Changing creative resets the ad's learning phase and social proof (likes/comments)
                  </div>
                </div>
              )}

              {/* Audience Tab */}
              {editModal.action === 'update_adset' && activeTab === 'audience' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Age Range</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input type="number" value={editModal.age_min} min={18} max={65}
                        onChange={e => setEditModal((p: any) => ({ ...p, age_min: parseInt(e.target.value) }))}
                        style={{ width: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', color: 'white', fontSize: 14, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>to</span>
                      <input type="number" value={editModal.age_max} min={18} max={65}
                        onChange={e => setEditModal((p: any) => ({ ...p, age_max: parseInt(e.target.value) }))}
                        style={{ width: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', color: 'white', fontSize: 14, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Gender</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[{ label: 'All', value: [] }, { label: 'Male', value: [1] }, { label: 'Female', value: [2] }].map(g => (
                        <button key={g.label} onClick={() => setEditModal((p: any) => ({ ...p, genders: g.value }))}
                          style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: `2px solid ${JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#dffe95' : 'rgba(255,255,255,0.1)'}`, background: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? 'rgba(223,254,149,0.1)' : 'transparent', color: JSON.stringify(editModal.genders) === JSON.stringify(g.value) ? '#dffe95' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                    ⚠️ Changing audience resets Meta's learning phase. Make small changes only.
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
              <button onClick={() => setEditModal(null)} style={{ flex: 1, background: 'none', border: '1.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', padding: '11px 0', borderRadius: 100, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={{ flex: 2, background: '#dffe95', color: '#10211f', border: 'none', padding: '11px 0', borderRadius: 100, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
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

function Field({ label, value, onChange, multiline }: { label: string, value: string, onChange: (v: string) => void, multiline?: boolean }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={4}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
      )}
    </div>
  )
}
