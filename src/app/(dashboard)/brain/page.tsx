'use client'
/**
 * The Company Brain — your company's accumulated knowledge, not an AI settings page.
 * Six tabs: Identity · Beliefs (DNA + Mello's proposals) · Departments · Learning · Playbook · Teach.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

// Active project cookie (same as the switcher) — passed explicitly so the Brain always shows the
// SELECTED brand's identity/beliefs/culture, not whatever the server cookie resolves at fetch time.
const readCookie = (name: string) => { if (typeof document === 'undefined') return ''; const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : '' }
const brandQS = () => { const b = readCookie(BRAND_COOKIE); return b ? `?brand=${encodeURIComponent(b)}` : '' }

type Overview = any
const DEPT_LABEL: Record<string, string> = { research: 'Research', creative: 'Creative', media: 'Media Buying', growth: 'Growth', customer: 'Customer', store: 'Store', finance: 'Finance' }
const TABS = ['Overview', 'Identity', 'Beliefs', 'Review', 'Departments', 'Learning', 'Playbook', 'Teach'] as const
const SOURCE_LABEL = (s: string): string => {
  if (!s) return ''
  if (s.includes('slack')) return 'noticed on Slack'
  if (s.includes('whatsapp')) return 'noticed on WhatsApp'
  if (s.includes('inbox')) return 'noticed in your inbox'
  if (s === 'reflection') return 'a pattern Mello noticed'
  return 'suggested by Mello'
}
// Empty-state starters — so a blank Brain isn't intimidating. Founder taps → edits → teaches.
const SUGGESTIONS = [
  'Never discount below 15%',
  'Always use British English',
  'Ask before spending over $300/day',
  'Our audience is busy parents',
  'We are premium, not budget',
  'No emojis in our copy',
  'Speak like a trusted advisor',
]

export default function BrainPage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  // Overview tab: ask-the-company + the company timeline.
  const [ask, setAsk] = useState(''); const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<{ reply: string; sources: string[] } | null>(null)
  const [tl, setTl] = useState<{ timeline: any[]; patterns: any[]; hasHistory: boolean } | null>(null)
  const [conflicts, setConflicts] = useState<any[]>([])
  const [why, setWhy] = useState<Record<string, boolean>>({})          // belief id → "Why?" open
  const [briefs, setBriefs] = useState<Record<string, { brief: string; loading?: boolean }>>({})  // dept → first-day brief
  const [loading, setLoading] = useState(true)
  const [rule, setRule] = useState(''); const [dept, setDept] = useState(''); const [busy, setBusy] = useState(false)
  const [reflecting, setReflecting] = useState(false)
  const [culture, setCulture] = useState<{ aggressive: string; premium: string; tone: string; risk: string }>({ aggressive: 'balanced', premium: 'premium', tone: 'friendly', risk: 'ask' })

  const load = () => fetch(`/api/brain/overview${brandQS()}`).then(r => r.json()).then(j => { if (!j.error) setOv(j) }).catch(() => {}).finally(() => setLoading(false))
  const loadTimeline = () => fetch(`/api/brain/timeline${brandQS()}`).then(r => r.json()).then(j => { if (!j.error) setTl(j) }).catch(() => {})
  const loadConflicts = () => fetch('/api/brain/conflict').then(r => r.json()).then(j => { if (j.conflicts) setConflicts(j.conflicts) }).catch(() => {})
  const loadCulture = () => fetch(`/api/brain/culture${brandQS()}`).then(r => r.json()).then(j => { if (j.culture) setCulture(j.culture) }).catch(() => {})
  const loadAll = () => { load(); loadTimeline(); loadConflicts(); loadCulture() }
  useEffect(() => { loadAll() }, [])
  // Re-pull when the project switcher changes brand — the Brain is per-brand, so it must never keep
  // showing the previous brand's identity/beliefs/culture (the "wrong brand in Brain" bug).
  useEffect(() => { const onBrand = () => loadAll(); window.addEventListener('sf:brandchange', onBrand); return () => window.removeEventListener('sf:brandchange', onBrand) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const resolveConflict = async (id: string, action: 'temporary' | 'replace' | 'keep') => {
    await fetch('/api/brain/conflict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }).catch(() => {})
    toast.success(action === 'replace' ? 'Replaced the old rule' : action === 'temporary' ? 'Added as a temporary exception' : 'Kept the old rule')
    loadConflicts(); load()
  }
  const loadBrief = async (dept: string) => {
    if (briefs[dept]?.loading) return
    setBriefs(b => ({ ...b, [dept]: { brief: '', loading: true } }))
    try { const r = await fetch(`/api/brain/onboard?department=${dept}`).then(x => x.json()); setBriefs(b => ({ ...b, [dept]: { brief: r.brief || '—' } })) }
    catch { setBriefs(b => ({ ...b, [dept]: { brief: 'Could not load.' } })) }
  }
  const doAsk = async () => {
    const qq = ask.trim(); if (!qq || asking) return
    setAsking(true); setAnswer(null)
    try {
      const r = await fetch('/api/brain/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: qq, brandId: readCookie(BRAND_COOKIE) || undefined }) }).then(x => x.json())
      setAnswer({ reply: r.reply || '—', sources: r.sources || [] })
    } catch { setAnswer({ reply: 'I hit a snag — try again in a moment.', sources: [] }) }
    finally { setAsking(false) }
  }
  const saveCulture = (next: typeof culture) => { setCulture(next); fetch('/api/brain/culture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).then(() => toast.success('Culture updated')).catch(() => {}) }

  const teach = async () => {
    if (!rule.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/brain/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule, department: dept || null }) }).then(x => x.json())
      if (r?.conflict) { setRule(''); setDept(''); toast(`That clashes with “${r.existingRule}” — resolve it on the Review tab.`, { icon: '⚠️' }); loadConflicts(); load(); setTab('Review') }
      else if (r?.ok) { setRule(''); setDept(''); toast.success('Taught. The whole team follows it now.'); load() }
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
            {t}{t === 'Review' && ((ov?.counts?.conflicts || 0) + (ov?.counts?.candidates || 0)) ? pill(`${(ov?.counts?.conflicts || 0) + (ov?.counts?.candidates || 0)}`) : null}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading your company's memory…</p> : !ov ? <p style={{ color: '#9ca3af' }}>Couldn't load.</p> : (
        <>
          {tab === 'Overview' && (
            <>
              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 3 }}>Ask your company anything</div>
                <div style={{ fontSize: 12.5, color: '#7a9a7a', marginBottom: 12 }}>Mello answers from everything the company knows — beliefs, facts, what it's learned, and your customer conversations.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doAsk() }} placeholder="e.g. What are customers complaining about?" style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, fontFamily: 'inherit' }} />
                  <button onClick={doAsk} disabled={asking} style={{ background: '#1a3a1a', color: '#dffe95', border: 'none', padding: '10px 20px', borderRadius: 10, fontSize: 13.5, fontWeight: 800, cursor: asking ? 'default' : 'pointer', fontFamily: 'inherit', opacity: asking ? 0.6 : 1 }}>{asking ? '…' : 'Ask'}</button>
                </div>
                {answer ? (
                  <div style={{ marginTop: 14, padding: '14px 16px', background: '#f8fcf6', border: '1px solid #e6efdc', borderRadius: 12 }}>
                    <div style={{ fontSize: 14, color: '#1a3a1a', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{answer.reply}</div>
                    {answer.sources?.length > 0 && <div style={{ marginTop: 10, fontSize: 11, color: '#7a9a7a', fontFamily: 'ui-monospace,monospace' }}>Source · {answer.sources.join(' · ')}</div>}
                  </div>
                ) : (
                  <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['What did we learn this week?', 'What are customers complaining about?', 'What is our brand positioning?', 'What are our best-performing ads?'].map(s => (
                      <button key={s} onClick={() => setAsk(s)} style={{ fontSize: 12, color: '#5a705a', background: '#eef3ea', border: 'none', borderRadius: 100, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                    ))}
                  </div>
                )}
              </div>

              {tl?.patterns && tl.patterns.length > 0 && (
                <div style={card}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 10 }}>What customers are talking about <span style={{ fontSize: 12, color: '#7a9a7a', fontWeight: 500 }}>· last 14 days</span></div>
                  {tl.patterns.map((p: any) => (
                    <div key={p.topic} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: 13.5, color: '#1a3a1a', textTransform: 'capitalize', flex: 1 }}>{String(p.topic).replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#3b6d11' }}>{p.count} mention{p.count === 1 ? '' : 's'}</span>
                      {p.negative > 0 && <span style={{ fontSize: 11, color: '#b91c1c', background: '#fdecea', borderRadius: 100, padding: '2px 8px' }}>{p.negative} neg</span>}
                    </div>
                  ))}
                </div>
              )}

              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 10 }}>Company timeline</div>
                {tl?.timeline?.length ? tl.timeline.map((e: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'ui-monospace,monospace', flex: 'none', width: 58, paddingTop: 2 }}>{new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span style={{ fontSize: 13.5, color: '#3a5a3a', lineHeight: 1.5 }}><b style={{ color: '#1a3a1a', textTransform: 'capitalize' }}>{e.actor}</b>{e.department ? ` · ${DEPT_LABEL[e.department] || e.department}` : ''} — {e.event}</span>
                  </div>
                )) : <p style={{ color: '#9ca3af', fontSize: 13 }}>No history yet. As Mello works and you teach it, the company's decisions and learnings show up here.</p>}
              </div>
            </>
          )}

          {tab === 'Review' && (
            <>
              {conflicts.length > 0 && (
                <div style={{ ...card, borderColor: '#f0c9c0', background: '#fdf6f4' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a1a', marginBottom: 4 }}>⚠️ Conflicts to resolve</div>
                  <div style={{ fontSize: 12.5, color: '#8a6a64', marginBottom: 6 }}>A new rule clashes with one you already set. Nothing changes until you decide.</div>
                  {conflicts.map((c: any) => (
                    <div key={c.id} style={{ padding: '11px 0', borderTop: '1px solid #f3e2de' }}>
                      <div style={{ fontSize: 13.5, color: '#1a3a1a' }}>New: <b>{c.incoming_rule}</b></div>
                      <div style={{ fontSize: 12.5, color: '#8a6a64', marginTop: 2 }}>Clashes with: {c.existing_rule}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                        <button onClick={() => resolveConflict(c.id, 'temporary')} style={{ background: '#fff', color: '#1a3a1a', border: '1.5px solid #e2e8f0', padding: '6px 13px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Temporary exception</button>
                        <button onClick={() => resolveConflict(c.id, 'replace')} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '6px 13px', borderRadius: 100, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Replace old rule</button>
                        <button onClick={() => resolveConflict(c.id, 'keep')} style={{ background: '#fff', color: '#5a705a', border: '1.5px solid #e2e8f0', padding: '6px 13px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Keep old</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a', marginBottom: 3 }}>Suggested rules</div>
                <div style={{ fontSize: 12.5, color: '#7a9a7a', marginBottom: 6 }}>Things Mello learned from your work and conversations. Approve to make them company rules.</div>
                {ov.candidates?.length ? ov.candidates.map((p: any) => (
                  <div key={p.id} style={{ padding: '11px 0', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 14, color: '#1a3a1a' }}>{p.rule}{p.department && pill(DEPT_LABEL[p.department] || p.department)}</div>
                    {p.evidence?.basedOn && <div style={{ fontSize: 12.5, color: '#5a705a', marginTop: 4 }}>Why — {p.evidence.basedOn}</div>}
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, fontFamily: 'ui-monospace,monospace' }}>{SOURCE_LABEL(p.source)}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                      <button onClick={() => proposal(p.id, 'approve')} style={{ background: '#dffe95', color: '#1a3a1a', border: 'none', padding: '6px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Make it a rule</button>
                      <button onClick={() => proposal(p.id, 'dismiss')} style={{ background: '#fff', color: '#b91c1c', border: '1.5px solid #e2e8f0', padding: '6px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Dismiss</button>
                    </div>
                  </div>
                )) : (conflicts.length ? null : <p style={{ color: '#9ca3af', fontSize: 13 }}>Nothing to review. As Mello learns from your work and conversations, suggested rules land here.</p>)}
              </div>
            </>
          )}

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
                  <div key={b.id} style={{ padding: '9px 0', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                      <div style={{ fontSize: 14, color: '#1a3a1a' }}>{b.rule}{b.department && pill(DEPT_LABEL[b.department] || b.department)}{b.created_by === 'mello' && pill('learned')}</div>
                      <div style={{ display: 'flex', gap: 12, flex: 'none' }}>
                        <button onClick={() => setWhy(w => ({ ...w, [b.id]: !w[b.id] }))} style={{ fontSize: 12, color: '#7a9a7a', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{why[b.id] ? 'Hide' : 'Why?'}</button>
                        <button onClick={() => retire(b.id)} style={{ fontSize: 12, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Retire</button>
                      </div>
                    </div>
                    {why[b.id] && (
                      <div style={{ marginTop: 7, padding: '9px 12px', background: '#f7faf4', border: '1px solid #eef3ea', borderRadius: 10, fontSize: 12.5, color: '#5a705a', lineHeight: 1.65 }}>
                        <div>{b.created_by === 'founder' ? 'You taught this.' : SOURCE_LABEL(b.source)}</div>
                        {b.evidence?.basedOn && <div>Evidence — {b.evidence.basedOn}</div>}
                        <div>Confidence {b.confidence ?? 100}/100{b.created_at ? ` · added ${new Date(b.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</div>
                      </div>
                    )}
                  </div>
                )) : (
                  <div>
                    <p style={{ color: '#7a9a7a', fontSize: 13.5, margin: '2px 0 12px' }}>Nothing taught yet. Not sure where to start? Tap one to edit &amp; teach it — or just tell Mello “never discount” in chat.</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {SUGGESTIONS.map(s => (
                        <button key={s} onClick={() => { setRule(s); setTab('Teach') }}
                          style={{ fontSize: 13, padding: '7px 13px', borderRadius: 100, border: '1px dashed #cfe6b8', background: '#f8fcf6', color: '#3b6d11', cursor: 'pointer', fontFamily: 'inherit' }}>+ {s}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'Departments' && (
            ov.departments?.length ? ov.departments.map((d: any) => (
              <div key={d.department} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a1a' }}>{DEPT_LABEL[d.department] || d.department}</div>
                  <button onClick={() => loadBrief(d.department)} disabled={briefs[d.department]?.loading} style={{ fontSize: 12, fontWeight: 700, color: '#3b6d11', background: '#eef3ea', border: 'none', borderRadius: 100, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>{briefs[d.department]?.loading ? 'Reading…' : '🎓 First-day brief'}</button>
                </div>
                {briefs[d.department] && !briefs[d.department].loading && (
                  <div style={{ marginBottom: 10, padding: '12px 14px', background: '#f7faf4', border: '1px solid #eef3ea', borderRadius: 12, fontSize: 13, color: '#3a5a3a', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{briefs[d.department].brief}</div>
                )}
                {d.notebook?.length > 0 && <div style={{ marginBottom: 8 }}>{d.notebook.map((m: any, i: number) => <div key={i} style={{ fontSize: 13.5, color: '#3a5a3a', padding: '3px 0' }}>• {m.content}{m.source_kind && m.source_kind !== 'chat' ? <span style={{ fontSize: 10.5, color: '#9ca3af', marginLeft: 6, fontFamily: 'ui-monospace,monospace' }}>from {m.source_kind}</span> : null}</div>)}</div>}
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
