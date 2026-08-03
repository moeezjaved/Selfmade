'use client'
/**
 * The Company Brain — your company's accumulated knowledge, not an AI settings page.
 * Six tabs: Identity · Beliefs (DNA + Mello's proposals) · Departments · Learning · Playbook · Teach.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

type Overview = any
const DEPT_LABEL: Record<string, string> = { research: 'Research', creative: 'Creative', media: 'Media Buying', growth: 'Growth', customer: 'Customer', store: 'Store', finance: 'Finance' }
const TABS = ['Identity', 'Beliefs', 'Departments', 'Learning', 'Playbook', 'Teach'] as const

export default function BrainPage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [tab, setTab] = useState<typeof TABS[number]>('Beliefs')
  const [loading, setLoading] = useState(true)
  const [rule, setRule] = useState(''); const [dept, setDept] = useState(''); const [busy, setBusy] = useState(false)
  const [reflecting, setReflecting] = useState(false)
  const [culture, setCulture] = useState<{ aggressive: string; premium: string; tone: string; risk: string }>({ aggressive: 'balanced', premium: 'premium', tone: 'friendly', risk: 'ask' })

  const load = () => fetch('/api/brain/overview').then(r => r.json()).then(j => { if (!j.error) setOv(j) }).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load(); fetch('/api/brain/culture').then(r => r.json()).then(j => { if (j.culture) setCulture(j.culture) }).catch(() => {}) }, [])
  const saveCulture = (next: typeof culture) => { setCulture(next); fetch('/api/brain/culture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).then(() => toast.success('Culture updated')).catch(() => {}) }

  const teach = async () => {
    if (!rule.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/brain/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule, department: dept || null }) }).then(x => x.json())
      if (r?.ok) { setRule(''); setDept(''); toast.success('Taught. The whole team follows it now.'); load() }
      else toast.error(r?.error || 'Could not save')
    } finally { setBusy(false) }
  }
  const retire = async (id: string) => { await fetch('/api/brain/teach', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {}); toast.success('Retired'); load() }
  const proposal = async (id: string, action: 'approve' | 'dismiss') => { await fetch('/api/brain/proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }).catch(() => {}); toast.success(action === 'approve' ? 'Now a company belief' : 'Dismissed'); load() }
  const reflect = async () => {
    setReflecting(true)
    try { const r = await fetch('/api/brain/reflect', { method: 'POST' }).then(x => x.json()); toast.success(r?.proposals?.length ? `${r.proposals.length} new suggestion${r.proposals.length === 1 ? '' : 's'}` : (r?.note || 'Nothing new — the log needs more history')); load() }
    finally { setReflecting(false) }
  }

  const card: React.CSSProperties = { background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 20, marginBottom: 14 }
  const pill = (t: string) => <span style={{ fontSize: 11, fontWeight: 700, color: '#3b6d11', background: '#eaf3de', borderRadius: 20, padding: '2px 9px', marginLeft: 8 }}>{t}</span>

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1a3a1a', marginBottom: 4 }}>Company Brain</h1>
      <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 18 }}>What your company believes, knows, and has learned. Mello reads this before it acts.</p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 100, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tab === t ? '#1a3a1a' : '#eef3ea', color: tab === t ? '#dffe95' : '#5a705a' }}>
            {t}{t === 'Beliefs' && ov?.counts?.proposals ? pill(`${ov.counts.proposals} new`) : null}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading your company's memory…</p> : !ov ? <p style={{ color: '#9ca3af' }}>Couldn't load.</p> : (
        <>
          {tab === 'Identity' && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 8 }}>Who the company is</div>
              {ov.identity ? (
                <div style={{ fontSize: 14, color: '#3a5a3a', lineHeight: 1.8 }}>
                  <div><b>{ov.identity.name}</b></div>
                  {ov.identity.industry && <div>Industry — {ov.identity.industry}</div>}
                  {ov.identity.brand_type && <div>Type — {ov.identity.brand_type}</div>}
                </div>
              ) : <p style={{ color: '#9ca3af', fontSize: 13 }}>No brand set up yet.</p>}
            </div>
          )}

          {tab === 'Identity' && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 3 }}>Culture</div>
              <div style={{ fontSize: 12.5, color: '#7a9a7a', marginBottom: 14 }}>The temperament every department follows. Change any time.</div>
              {([
                { k: 'aggressive', q: 'How aggressive', opts: [['conservative', 'Conservative'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']] },
                { k: 'premium', q: 'How premium', opts: [['mass', 'Mass'], ['premium', 'Premium'], ['luxury', 'Luxury']] },
                { k: 'tone', q: 'Tone', opts: [['professional', 'Professional'], ['friendly', 'Friendly'], ['funny', 'Funny']] },
                { k: 'risk', q: 'Autonomy', opts: [['ask', 'Always ask'], ['sometimes', 'Sometimes'], ['auto', 'Decide for me']] },
              ] as { k: 'aggressive' | 'premium' | 'tone' | 'risk'; q: string; opts: [string, string][] }[]).map(row => (
                <div key={row.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13.5, color: '#1a3a1a', width: 120, flex: 'none' }}>{row.q}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {row.opts.map(([val, label]) => (
                      <button key={val} onClick={() => saveCulture({ ...culture, [row.k]: val })}
                        style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 100, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, background: culture[row.k] === val ? '#1a3a1a' : '#eef3ea', color: culture[row.k] === val ? '#dffe95' : '#5a705a' }}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'Beliefs' && (
            <>
              {ov.proposals?.length > 0 && (
                <div style={{ ...card, borderColor: '#cfe6b8', background: '#f8fcf6' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a1a', marginBottom: 10 }}>💡 Mello noticed a pattern</div>
                  {ov.proposals.map((p: any) => (
                    <div key={p.id} style={{ padding: '10px 0', borderTop: '1px solid #e6efdc' }}>
                      <div style={{ fontSize: 14, color: '#1a3a1a' }}>{p.rule}{p.department && pill(DEPT_LABEL[p.department] || p.department)}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={() => proposal(p.id, 'approve')} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '6px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Make it a rule</button>
                        <button onClick={() => proposal(p.id, 'dismiss')} style={{ background: '#fff', color: '#b91c1c', border: '1.5px solid #e2e8f0', padding: '6px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Dismiss</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a' }}>Company beliefs</div>
                  <button onClick={reflect} disabled={reflecting} style={{ fontSize: 12, fontWeight: 700, color: '#3b6d11', background: '#eef3ea', border: 'none', borderRadius: 100, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>{reflecting ? 'Looking…' : 'Look for patterns'}</button>
                </div>
                {ov.beliefs?.length ? ov.beliefs.map((b: any) => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '9px 0', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 14, color: '#1a3a1a' }}>{b.rule}{b.department && pill(DEPT_LABEL[b.department] || b.department)}{b.created_by === 'mello' && pill('learned')}</div>
                    <button onClick={() => retire(b.id)} style={{ fontSize: 12, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Retire</button>
                  </div>
                )) : <p style={{ color: '#9ca3af', fontSize: 13 }}>No beliefs yet. Teach one in the Teach tab, or just tell Mello “never discount” in chat.</p>}
              </div>
            </>
          )}

          {tab === 'Departments' && (
            ov.departments?.length ? ov.departments.map((d: any) => (
              <div key={d.department} style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 8 }}>{DEPT_LABEL[d.department] || d.department}</div>
                {d.notebook?.length > 0 && <div style={{ marginBottom: 8 }}>{d.notebook.map((m: any, i: number) => <div key={i} style={{ fontSize: 13.5, color: '#3a5a3a', padding: '3px 0' }}>• {m.content}</div>)}</div>}
                {d.learnings?.length > 0 && <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>{d.learnings.map((l: any, i: number) => <div key={i} style={{ fontSize: 13, color: '#7a9a7a', padding: '2px 0' }}>✓ {l.event}{l.result ? ` → ${l.result}` : ''}</div>)}</div>}
              </div>
            )) : <div style={card}><p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>Departments haven't written anything yet — they fill in as Mello works and you approve actions.</p></div>
          )}

          {tab === 'Learning' && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 10 }}>What the company has learned</div>
              {ov.learnings?.length ? ov.learnings.map((l: any, i: number) => (
                <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ fontSize: 13.5, color: '#1a3a1a' }}>{l.event}{l.result ? <span style={{ color: '#3b6d11' }}> → {l.result}</span> : ''}</div>
                  <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>{DEPT_LABEL[l.department] || l.department}</div>
                </div>
              )) : <p style={{ color: '#9ca3af', fontSize: 13 }}>Nothing yet — the log fills automatically every time you approve an action.</p>}
            </div>
          )}

          {tab === 'Playbook' && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 10 }}>The plays the company has earned</div>
              {ov.playbook?.length ? ov.playbook.map((l: any, i: number) => (
                <div key={i} style={{ fontSize: 13.5, color: '#1a3a1a', padding: '6px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>🏅 {l.event}{l.result ? ` → ${l.result}` : ''}</div>
              )) : <p style={{ color: '#9ca3af', fontSize: 13 }}>Plays appear here once the company has enough proven wins to synthesize.</p>}
            </div>
          )}

          {tab === 'Teach' && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 4 }}>Teach the company</div>
              <div style={{ fontSize: 12.5, color: '#7a9a7a', marginBottom: 12 }}>State a belief in plain words. Every department follows it — forever, until you retire it.</div>
              <textarea value={rule} onChange={e => setRule(e.target.value)} placeholder="e.g. Never discount below 15%. Always British English. Ask before any spend over Rs 300." rows={2}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#f8fcf6', color: '#1a3a1a', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={dept} onChange={e => setDept(e.target.value)} style={{ padding: '9px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 13, fontFamily: 'inherit', color: '#1a3a1a' }}>
                  <option value="">Whole company</option>
                  {Object.entries(DEPT_LABEL).map(([k, v]) => <option key={k} value={k}>{v} only</option>)}
                </select>
                <button onClick={teach} disabled={!rule.trim() || busy} style={{ background: rule.trim() && !busy ? '#1a3a1a' : '#e2e8f0', color: rule.trim() && !busy ? '#dffe95' : '#9ca3af', border: 'none', padding: '9px 20px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: rule.trim() && !busy ? 'pointer' : 'default', fontFamily: 'inherit' }}>{busy ? 'Teaching…' : 'Teach it'}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
