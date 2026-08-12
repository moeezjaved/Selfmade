'use client'
/**
 * UGC Creators — the creator-recruiting employee. Find creators (country + follower range + niche via
 * Apify, or add by hand), reach out (bulk or one-by-one, drafted for approval), then run each reply
 * conversation through a pipeline: sourced → invited → replied → confirmed → details → shipped → received.
 * Once a creator agrees, Mello collects their name/address/phone and writes a UGC script. Nothing sends
 * without your OK.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

const INK = '#141d15', SUB = '#7a9a7a', MUTED = '#6b6b6b', LINE = 'rgba(0,0,0,0.08)', FOREST = '#141d15', LIME = '#ff5a2c', GREEN = '#ef4a1e'
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(17,37,28,.04), 0 10px 30px -20px rgba(17,37,28,.10)' }

type Creator = {
  id: string; handle: string; full_name?: string; avatar_url?: string; profile_url?: string
  followers?: number; engagement_rate?: number; category?: string; email?: string; country?: string
  stage: string; offer_type?: string; offer_details?: string; script?: string
  ship_name?: string; ship_address?: string; ship_phone?: string
}
type Msg = { id: string; direction: 'in' | 'out'; body: string; status: string; created_at: string }

const STAGES: { key: string; label: string }[] = [
  { key: 'sourced', label: 'Found' }, { key: 'invited', label: 'Invited' }, { key: 'replied', label: 'Replied' },
  { key: 'confirmed', label: 'Confirmed' }, { key: 'details', label: 'Details in' }, { key: 'shipped', label: 'Shipped' },
  { key: 'received', label: 'Content in' }, { key: 'declined', label: 'Declined' },
]
const OFFERS = [{ v: 'gifted', l: 'Free product' }, { v: 'paid', l: 'Paid' }, { v: 'affiliate', l: 'Affiliate' }]
const NEXT: Record<string, string> = { replied: 'confirmed', confirmed: 'details', details: 'shipped', shipped: 'received' }

const fmtK = (n?: number) => n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [pending, setPending] = useState(0)
  const [stage, setStage] = useState('sourced')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null)   // creator id in detail view

  // discovery form
  const [country, setCountry] = useState('Pakistan')
  const [minF, setMinF] = useState('4000'); const [maxF, setMaxF] = useState('50000')
  const [niche, setNiche] = useState(''); const [emailOnly, setEmailOnly] = useState(false)
  const [finding, setFinding] = useState(false); const [needsToken, setNeedsToken] = useState(false)
  const [manual, setManual] = useState('')
  // bulk offer
  const [offerType, setOfferType] = useState('gifted'); const [offerDetails, setOfferDetails] = useState('')

  const load = () => fetch('/api/creators', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (Array.isArray(j.creators)) setCreators(j.creators)
    if (j.counts) setCounts(j.counts); if (typeof j.pending === 'number') setPending(j.pending)
  }).catch(() => {})
  useEffect(() => { load() }, [])

  const shown = creators.filter(c => c.stage === stage)
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const find = async () => {
    setFinding(true); setNeedsToken(false)
    try {
      const j = await fetch('/api/creators/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ country, minFollowers: Number(minF) || undefined, maxFollowers: Number(maxF) || undefined, niche, requireEmail: emailOnly }) }).then(r => r.json())
      if (j.needsToken) { setNeedsToken(true); toast('Add your Apify token to auto-find creators — or add handles by hand below.') }
      else if (j.error) toast.error(j.error)
      else { toast.success(`Found ${j.found ?? j.saved} creators`); setStage('sourced'); load() }
    } catch { toast.error('Search failed') } finally { setFinding(false) }
  }
  const addManual = async () => {
    if (!manual.trim()) return
    setFinding(true)
    try { const j = await fetch('/api/creators/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handles: manual }) }).then(r => r.json()); toast.success(`Added ${j.saved}`); setManual(''); setStage('sourced'); load() }
    catch { toast.error('Could not add') } finally { setFinding(false) }
  }

  const act = async (payload: any, okMsg?: string) => {
    setBusy(payload.action + (payload.id || ''))
    try { const j = await fetch('/api/creators', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()); if (j.error) toast.error(j.error); else if (okMsg) toast.success(okMsg); return j }
    catch { toast.error('Something went wrong') } finally { setBusy('') }
  }

  const draftInvites = async () => {
    const ids = Array.from(sel); if (!ids.length) return
    await act({ action: 'draft_offer', ids, offerType, offerDetails }, `Drafted ${ids.length} invite${ids.length === 1 ? '' : 's'} — review & send`)
    load()
  }
  const sendInvites = async () => {
    const ids = Array.from(sel); if (!ids.length) return
    const j = await act({ action: 'send', ids }, undefined)
    if (j?.ok) toast.success(`Sent ${j.sent} · ${j.delivered} emailed, rest ready to copy`)
    setSel(new Set()); load()
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: '-.02em', marginBottom: 4 }}>UGC Creators</h1>
      <p style={{ fontSize: 13.5, color: SUB, marginBottom: 18 }}>Find creators, send them an offer, and Mello runs the whole conversation — right up to collecting their address so you can ship product. You approve every message.</p>

      {open ? (
        <CreatorDetail id={open} onBack={() => { setOpen(null); load() }} />
      ) : (<>
        {/* Find creators */}
        <div style={{ ...card, padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 12 }}>Find creators</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <Field label="Country"><input value={country} onChange={e => setCountry(e.target.value)} style={inp} placeholder="Pakistan" /></Field>
            <Field label="Followers min"><input value={minF} onChange={e => setMinF(e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="Followers max"><input value={maxF} onChange={e => setMaxF(e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="Niche / keyword"><input value={niche} onChange={e => setNiche(e.target.value)} style={inp} placeholder="fashion, skincare…" /></Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>
              <input type="checkbox" checked={emailOnly} onChange={e => setEmailOnly(e.target.checked)} /> Only with a public email
            </label>
            <button onClick={find} disabled={finding} style={{ ...btnPrimary, opacity: finding ? 0.6 : 1 }}>{finding ? 'Searching…' : '🔍 Find creators'}</button>
          </div>
          {needsToken && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: '#9a6a12', background: '#fef6e7', border: '1px solid #f2e3c0', borderRadius: 10, padding: '9px 12px' }}>
              Auto-discovery needs an <b>Apify</b> account. Add <code>APIFY_TOKEN</code> in Vercel and this turns on. Until then, add creators by hand below.
            </div>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Or paste handles: @creator1, @creator2…" style={{ ...inp, flex: '1 1 260px' }} />
            <button onClick={addManual} disabled={finding || !manual.trim()} style={{ ...btnGhost, opacity: finding || !manual.trim() ? 0.5 : 1 }}>Add by hand</button>
          </div>
        </div>

        {/* Stage tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {STAGES.map(s => (
            <button key={s.key} onClick={() => { setStage(s.key); setSel(new Set()) }} style={{ border: `1px solid ${stage === s.key ? FOREST : LINE}`, background: stage === s.key ? FOREST : '#fff', color: stage === s.key ? LIME : INK, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, fontWeight: 750, fontFamily: 'inherit', cursor: 'pointer' }}>
              {s.label} {counts[s.key] ? <b style={{ color: stage === s.key ? LIME : SUB }}>{counts[s.key]}</b> : ''}
            </button>
          ))}
        </div>

        {/* Bulk offer bar (Found stage) */}
        {stage === 'sourced' && shown.length > 0 && (
          <div style={{ ...card, padding: 12, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: MUTED }}>{sel.size ? `${sel.size} selected` : 'Select creators →'}</span>
            <select value={offerType} onChange={e => setOfferType(e.target.value)} style={{ ...inp, width: 'auto' }}>
              {OFFERS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <input value={offerDetails} onChange={e => setOfferDetails(e.target.value)} placeholder="offer details (optional)" style={{ ...inp, flex: '1 1 160px' }} />
            <button onClick={draftInvites} disabled={!sel.size || !!busy} style={{ ...btnGhost, opacity: !sel.size ? 0.5 : 1 }}>Draft invites</button>
            <button onClick={sendInvites} disabled={!sel.size || !!busy} style={{ ...btnPrimary, opacity: !sel.size ? 0.5 : 1 }}>Send →</button>
            <button onClick={() => setSel(new Set(shown.map(c => c.id)))} style={{ ...btnText }}>Select all</button>
          </div>
        )}

        {/* Creator list */}
        {shown.length === 0 ? (
          <div style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 750, color: INK, marginBottom: 6 }}>{stage === 'sourced' ? 'No creators yet 🌱' : `Nothing in ${STAGES.find(s => s.key === stage)?.label}`}</div>
            <div style={{ fontSize: 13, color: SUB, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>{stage === 'sourced' ? 'Search above, or paste a few handles to start reaching out.' : 'Creators land here as they move through the pipeline.'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map(c => (
              <div key={c.id} style={{ ...card, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                {stage === 'sourced' && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />}
                {c.avatar_url
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={c.avatar_url} alt="" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', background: '#eef2ec' }} onError={(e: any) => { e.target.style.display = 'none' }} />
                  : <span style={{ width: 42, height: 42, borderRadius: '50%', background: '#eef2ec', display: 'grid', placeItems: 'center', fontSize: 16 }}>👤</span>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 750, color: INK }}>@{c.handle}{c.full_name ? <span style={{ color: SUB, fontWeight: 600 }}> · {c.full_name}</span> : ''}</div>
                  <div style={{ fontSize: 12, color: MUTED, display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                    <span>{fmtK(c.followers)} followers</span>
                    {c.engagement_rate != null && <span>{(c.engagement_rate <= 1 ? c.engagement_rate * 100 : c.engagement_rate).toFixed(1)}% eng.</span>}
                    {c.category && <span>{c.category}</span>}
                    {c.email && <span style={{ color: GREEN }}>✉ email</span>}
                  </div>
                </div>
                <button onClick={() => setOpen(c.id)} style={{ ...btnGhost, padding: '7px 14px' }}>Open →</button>
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  )
}

/* ---------- detail / conversation view ---------- */
function CreatorDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [c, setC] = useState<Creator | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState('')
  const [sim, setSim] = useState('')
  const [d, setD] = useState({ ship_name: '', ship_address: '', ship_phone: '' })
  const [replyDraft, setReplyDraft] = useState<{ id: string; text: string } | null>(null)

  const load = () => fetch(`/api/creators?id=${id}`, { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (j.creator) { setC(j.creator); setD({ ship_name: j.creator.ship_name || '', ship_address: j.creator.ship_address || '', ship_phone: j.creator.ship_phone || '' }) }
    if (Array.isArray(j.messages)) setMsgs(j.messages)
    const pend = (j.messages || []).find((m: Msg) => m.direction === 'out' && m.status === 'pending')
    setReplyDraft(pend ? { id: pend.id, text: pend.body } : null)
  }).catch(() => {})
  useEffect(() => { load() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (payload: any) => { setBusy(payload.action); try { const j = await fetch('/api/creators', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, id }) }).then(r => r.json()); if (j.error) toast.error(j.error); return j } catch { toast.error('Failed') } finally { setBusy('') } }

  if (!c) return <div style={{ fontSize: 14, color: SUB, padding: 20 }}>Loading…</div>
  const stageLabel = STAGES.find(s => s.key === c.stage)?.label || c.stage
  const next = NEXT[c.stage]

  return (
    <div>
      <button onClick={onBack} style={{ ...btnText, marginBottom: 14 }}>← Back to pipeline</button>
      <div style={{ ...card, padding: 16, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {c.avatar_url
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={c.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
          : <span style={{ width: 48, height: 48, borderRadius: '50%', background: '#eef2ec', display: 'grid', placeItems: 'center', fontSize: 18 }}>👤</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <a href={c.profile_url || `https://instagram.com/${c.handle}`} target="_blank" rel="noreferrer" style={{ fontSize: 15, fontWeight: 800, color: INK, textDecoration: 'none' }}>@{c.handle} ↗</a>
          <div style={{ fontSize: 12.5, color: MUTED }}>{fmtK(c.followers)} followers{c.category ? ` · ${c.category}` : ''}{c.email ? ` · ${c.email}` : ''}</div>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: GREEN, background: '#eaf3de', borderRadius: 100, padding: '4px 12px' }}>{stageLabel}</span>
      </div>

      {/* conversation */}
      <div style={{ ...card, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79a', marginBottom: 10 }}>Conversation</div>
        {msgs.length === 0 ? <div style={{ fontSize: 13, color: SUB }}>No messages yet. Draft an invite below.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {msgs.filter(m => m.status !== 'skipped').map(m => (
              <div key={m.id} style={{ alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.direction === 'out' ? '#eef7df' : '#f4f6f2', border: `1px solid ${LINE}`, borderRadius: 12, padding: '9px 12px', fontSize: 13.5, color: INK, lineHeight: 1.5, whiteSpace: 'pre-wrap', opacity: m.status === 'pending' ? 0.7 : 1 }}>
                {m.body}
                {m.status === 'pending' && <span style={{ display: 'block', fontSize: 10.5, color: '#9a6a12', marginTop: 3, fontWeight: 700 }}>DRAFT — not sent</span>}
              </div>
            ))}
          </div>
        )}

        {/* draft reply editor (pending out) */}
        {replyDraft ? (
          <div>
            <textarea value={replyDraft.text} onChange={e => setReplyDraft({ ...replyDraft, text: e.target.value })} rows={3} style={{ ...inp, width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={async () => { await post({ action: msgs.some(m => m.direction === 'in') ? 'send_reply' : 'send', messageId: replyDraft.id, messageIds: [replyDraft.id], text: replyDraft.text }); load() }} disabled={!!busy} style={btnPrimary}>Approve & send →</button>
              <button onClick={async () => { await post({ action: 'skip_message', messageId: replyDraft.id }); load() }} style={btnGhost}>Discard</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={async () => { await post({ action: msgs.length ? 'draft_reply' : 'draft_offer', ids: [id], offerType: c.offer_type || 'gifted', offerDetails: c.offer_details || '' }); load() }} disabled={!!busy} style={btnPrimary}>{busy ? '…' : msgs.length ? 'Draft a reply' : 'Draft the invite'}</button>
            {next && <button onClick={async () => { await post({ action: 'advance', stage: next }); load() }} style={btnGhost}>Move to {STAGES.find(s => s.key === next)?.label} →</button>}
            <button onClick={async () => { await post({ action: 'advance', stage: 'declined' }); load() }} style={btnText}>Declined</button>
          </div>
        )}

        {/* simulate an inbound reply (test now, before real channels) */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
          <input value={sim} onChange={e => setSim(e.target.value)} placeholder="Test a reply from the creator…" style={{ ...inp, flex: '1 1 220px' }} />
          <button onClick={async () => { await post({ action: 'simulate_reply', body: sim || undefined }); setSim(''); load() }} style={btnGhost}>Simulate reply</button>
        </div>
      </div>

      {/* shipping details — collected once they confirm */}
      <div style={{ ...card, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79a', marginBottom: 10 }}>Shipping details</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={d.ship_name} onChange={e => setD({ ...d, ship_name: e.target.value })} placeholder="Full name" style={inp} />
          <input value={d.ship_address} onChange={e => setD({ ...d, ship_address: e.target.value })} placeholder="Shipping address" style={inp} />
          <input value={d.ship_phone} onChange={e => setD({ ...d, ship_phone: e.target.value })} placeholder="Phone" style={inp} />
        </div>
        <button onClick={async () => { await post({ action: 'save_details', ...d }); load(); toast.success('Saved') }} disabled={!!busy} style={{ ...btnGhost, marginTop: 8 }}>Save details</button>
      </div>

      {/* UGC script */}
      <div style={{ ...card, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa79a' }}>UGC script</div>
          <button onClick={async () => { const j = await post({ action: 'generate_script' }); if (j?.script) setC({ ...c, script: j.script }); }} disabled={!!busy} style={btnGhost}>{busy === 'generate_script' ? 'Writing…' : c.script ? 'Regenerate' : 'Generate script'}</button>
        </div>
        {c.script ? <pre style={{ fontSize: 13, color: INK, lineHeight: 1.55, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{c.script}</pre>
          : <div style={{ fontSize: 13, color: SUB }}>Generate a short, shoot-ready brief grounded in what’s winning in your market.</div>}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', width: '100%' }
const btnPrimary: React.CSSProperties = { background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 12.5, fontWeight: 750, fontFamily: 'inherit', cursor: 'pointer' }
const btnText: React.CSSProperties = { background: 'none', border: 'none', color: SUB, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', padding: '4px 6px' }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#a7b0a5', marginBottom: 4 }}>{label}</span>{children}</label>
}
