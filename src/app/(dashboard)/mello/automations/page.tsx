'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Zap, Plus, Trash2, Clock, Power } from 'lucide-react'

interface Automation {
  id: string
  name: string
  prompt: string
  schedule_cron: string
  schedule_label: string | null
  is_active: boolean
  last_run_at: string | null
  next_run_at: string | null
}
interface Template { name: string; prompt: string; schedule_cron: string; schedule_label: string }

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', prompt: '', schedule_cron: '0 9 * * 1', schedule_label: 'Weekly · Mondays 9am' })

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mello/automations')
      const d = await r.json()
      setAutomations(d.automations || [])
      setTemplates(d.templates || [])
    } catch { /* ignore */ }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const create = async (payload: { name: string; prompt: string; schedule_cron: string; schedule_label?: string }) => {
    const r = await fetch('/api/mello/automations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (r.ok) { setShowForm(false); setForm({ name: '', prompt: '', schedule_cron: '0 9 * * 1', schedule_label: 'Weekly · Mondays 9am' }); load() }
    else { const d = await r.json(); alert(d.error || 'Failed to create') }
  }

  const toggle = async (a: Automation) => {
    setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x))
    await fetch(`/api/mello/automations/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !a.is_active }) })
    load()
  }
  const remove = async (id: string) => {
    setAutomations(prev => prev.filter(x => x.id !== id))
    await fetch(`/api/mello/automations/${id}`, { method: 'DELETE' })
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>
      <Link href="/mello" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#5b8a3c', fontWeight: 700, fontSize: 13, textDecoration: 'none', marginBottom: 16 }}>
        <ArrowLeft size={15} /> Back to Mello
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 24, fontWeight: 800, color: '#26331f', margin: 0 }}>
          <Zap size={22} color="#7aa856" /> Automations
        </h1>
        <button onClick={() => setShowForm(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: 'none', background: '#2d5a27', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          <Plus size={16} /> New automation
        </button>
      </div>
      <p style={{ color: '#6c7a66', fontSize: 14, margin: '6px 0 22px' }}>Scheduled Mello tasks. Results land in your Mello history on each run.</p>

      {/* Create form */}
      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e6ece2', borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            <textarea placeholder="What should Mello do on each run?" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <select value={form.schedule_cron} onChange={e => {
                const map: Record<string, string> = { '0 9 * * 1': 'Weekly · Mondays 9am', '0 8 * * *': 'Daily · 8am', '0 9 1 * *': 'Monthly · 1st 9am' }
                setForm({ ...form, schedule_cron: e.target.value, schedule_label: map[e.target.value] || 'Custom' })
              }} style={{ ...inputStyle, flex: 1 }}>
                <option value="0 9 * * 1">Weekly · Mondays 9am</option>
                <option value="0 8 * * *">Daily · 8am</option>
                <option value="0 9 1 * *">Monthly · 1st 9am</option>
              </select>
              <button onClick={() => create(form)} disabled={!form.name.trim() || !form.prompt.trim()} style={{ padding: '0 18px', borderRadius: 9, border: 'none', background: (!form.name.trim() || !form.prompt.trim()) ? '#cdd8c5' : '#2d5a27', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Templates */}
      {automations.length === 0 && !loading && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#9aa593', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Starter templates</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px,100%), 1fr))', gap: 12 }}>
            {templates.map((t, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e6ece2', borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#2c3a26' }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: '#6c7a66', margin: '4px 0 10px', lineHeight: 1.4 }}>{t.prompt.slice(0, 90)}…</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#8a9583' }}><Clock size={12} /> {t.schedule_label}</span>
                  <button onClick={() => create(t)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d3e0cb', background: '#f1f6ec', color: '#2d5a27', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Use</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active automations */}
      {automations.map(a => (
        <div key={a.id} style={{ background: '#fff', border: '1px solid #e6ece2', borderRadius: 12, padding: 16, marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#26331f' }}>{a.name}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: a.is_active ? '#dffe95' : '#eceee9', color: a.is_active ? '#3d5a25' : '#8a9583' }}>{a.is_active ? 'ACTIVE' : 'PAUSED'}</span>
            </div>
            <div style={{ fontSize: 13, color: '#6c7a66', margin: '5px 0', lineHeight: 1.45 }}>{a.prompt}</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9aa593' }}>
              <span><Clock size={11} style={{ verticalAlign: -1 }} /> {a.schedule_label || a.schedule_cron}</span>
              <span>Next: {fmt(a.next_run_at)}</span>
              <span>Last: {fmt(a.last_run_at)}</span>
            </div>
          </div>
          <button onClick={() => toggle(a)} title={a.is_active ? 'Pause' : 'Resume'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: a.is_active ? '#5b8a3c' : '#b7c0b0' }}><Power size={17} /></button>
          <button onClick={() => remove(a.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b7c0b0' }}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #dde6d8', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, color: '#26331f', outline: 'none', fontFamily: 'inherit', background: '#fff',
}
