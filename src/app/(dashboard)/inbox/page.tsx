'use client'
/**
 * Customer Inbox — the founder's priority-sorted inbox. Every customer message becomes a thread Mello
 * has already triaged (priority + intent) and drafted a reply for. The founder reads the top one, tweaks
 * if needed, and taps Approve. Nothing sends on its own. Testable today via "Simulate a message"; the
 * real IG/WhatsApp feed attaches once Unipile is connected in Settings.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const INK = '#17251c', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#1a3a1a', LIME = '#dffe95'
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(17,37,28,.04), 0 10px 30px -20px rgba(17,37,28,.10)' }

type Msg = { id: string; body: string; intent?: string; priority?: string; suggested_reply?: string; status: string }
type Thread = { id: string; contact_name?: string; contact_ref?: string; channel: string; priority: 'high' | 'med' | 'low'; intent?: string; status: string; last_message_at: string; latest: Msg | null }

const PRI: Record<string, { label: string; bg: string; fg: string }> = {
  high: { label: 'HIGH', bg: '#fdecec', fg: '#c0392b' },
  med: { label: 'MEDIUM', bg: '#fef6e7', fg: '#b7791f' },
  low: { label: 'LOW', bg: '#eef2ec', fg: '#6b8f6b' },
}
const INTENT_EMOJI: Record<string, string> = { shipping: '📦', refund: '↩️', price: '💸', complaint: '⚠️', question: '❓', other: '💬' }

export default function InboxPage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [rollup, setRollup] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string>('')
  const [simText, setSimText] = useState('')
  const [simBusy, setSimBusy] = useState(false)

  const load = () => fetch('/api/customer/inbox', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (Array.isArray(j.threads)) setThreads(j.threads)
    if (j.rollup) setRollup(j.rollup)
  }).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const act = async (thread: Thread, action: 'approve' | 'skip') => {
    const msg = thread.latest
    if (!msg) return
    setBusy(thread.id)
    try {
      const reply = action === 'approve' ? (drafts[thread.id] ?? msg.suggested_reply ?? '') : undefined
      const r = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, messageId: msg.id, reply }) }).then(x => x.json())
      if (r?.ok) {
        setThreads(ts => ts.filter(t => t.id !== thread.id))
        toast.success(action === 'approve' ? (r.note || 'Reply approved ✓') : 'Skipped')
      } else toast.error(r?.error || 'Something went wrong')
    } catch { toast.error('Something went wrong') } finally { setBusy('') }
  }

  const simulate = async () => {
    const body = simText.trim()
    if (!body) return
    setSimBusy(true)
    try {
      const r = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'simulate', body }) }).then(x => x.json())
      if (r?.ok) { setSimText(''); load(); toast.success('Mello triaged it — see the top of your inbox') }
      else toast.error(r?.error || 'Could not simulate')
    } catch { toast.error('Could not simulate') } finally { setSimBusy(false) }
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: '-.02em', marginBottom: 4 }}>Customer Inbox</h1>
      <p style={{ fontSize: 13.5, color: SUB, marginBottom: 20 }}>Every message, sorted by what matters — with a reply Mello already drafted. You approve; nothing sends on its own.</p>

      {/* Today's trends — the intent rollup */}
      {Object.keys(rollup).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {Object.entries(rollup).sort((a, b) => b[1] - a[1]).map(([intent, n]) => (
            <span key={intent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: INK }}>
              <span>{INTENT_EMOJI[intent] || '💬'}</span>{intent}<span style={{ color: SUB }}>{n}</span>
            </span>
          ))}
        </div>
      )}

      {/* Simulate — test the whole flow now, before Unipile is connected */}
      <div style={{ ...card, padding: 14, marginBottom: 20, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={simText} onChange={e => setSimText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') simulate() }}
          placeholder="Try a customer message — e.g. “my order hasn't arrived” or “can I get a refund?”"
          style={{ flex: '1 1 320px', minWidth: 200, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#f8fcf6', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }} />
        <button onClick={simulate} disabled={simBusy || !simText.trim()} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: simBusy || !simText.trim() ? 'default' : 'pointer', opacity: simBusy || !simText.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {simBusy ? 'Triaging…' : 'Simulate a message'}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 14, color: SUB, padding: 20 }}>Loading your inbox…</div>
      ) : threads.length === 0 ? (
        <div style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: INK, marginBottom: 6 }}>Nothing waiting on you 🌱</div>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
            Connect Instagram or WhatsApp in <Link href="/settings" style={{ color: '#3f8f4f', fontWeight: 700, textDecoration: 'none' }}>Settings</Link> and every customer message will land here — triaged, prioritized, with a reply ready to approve. Or try the box above to see it work now.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {threads.map(t => {
            const pri = PRI[t.priority] || PRI.low
            const msg = t.latest
            const draft = drafts[t.id] ?? msg?.suggested_reply ?? ''
            return (
              <div key={t.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ background: pri.bg, color: pri.fg, borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em' }}>{pri.label}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{t.contact_name || 'Customer'}</span>
                  {t.intent && <span style={{ fontSize: 12, color: SUB, fontWeight: 650 }}>{INTENT_EMOJI[t.intent] || '💬'} {t.intent}</span>}
                  <span style={{ fontSize: 11.5, color: '#a7b0a5', fontWeight: 600, marginLeft: 'auto', textTransform: 'capitalize' }}>{t.channel}</span>
                </div>
                {msg && <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.5, background: '#f6f8f4', borderRadius: 10, padding: '10px 12px' }}>{msg.body}</div>}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3f8f4f', marginBottom: 6 }}>Mello's suggested reply</div>
                  <textarea value={draft} onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))} rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => act(t, 'approve')} disabled={busy === t.id || !draft.trim()} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: busy === t.id ? 'default' : 'pointer', opacity: busy === t.id || !draft.trim() ? 0.6 : 1 }}>
                    {busy === t.id ? 'Sending…' : 'Approve & send →'}
                  </button>
                  <button onClick={() => act(t, 'skip')} disabled={busy === t.id} style={{ background: '#fff', color: SUB, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Skip</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
