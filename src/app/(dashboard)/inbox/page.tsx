'use client'
/**
 * Customer Inbox — the founder's Customer Employee. Two sides:
 *   Inbox    — messages customers sent, triaged (priority + intent) with a reply Mello already drafted.
 *   Outbound — messages Mello wants to send FIRST (cart recovery, win-back, review requests), drafted
 *              and waiting for approval.
 * Nothing sends on its own. Testable today via the Simulate controls; real IG/WhatsApp attaches once
 * Unipile is connected in Settings.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ChannelLogo } from '@/components/brand/logos'

const INK = '#17251c', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#1a3a1a', LIME = '#dffe95'
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(17,37,28,.04), 0 10px 30px -20px rgba(17,37,28,.10)' }

type Msg = { id: string; body: string; intent?: string; priority?: string; suggested_reply?: string; status: string }
type Thread = { id: string; contact_name?: string; contact_ref?: string; channel: string; priority: 'high' | 'med' | 'low'; intent?: string; status: string; last_message_at: string; latest: Msg | null }
type Outbound = Msg & { thread?: { contact_name?: string; channel?: string } | null }

const PRI: Record<string, { label: string; bg: string; fg: string }> = {
  high: { label: 'HIGH', bg: '#fdecec', fg: '#c0392b' },
  med: { label: 'MEDIUM', bg: '#fef6e7', fg: '#b7791f' },
  low: { label: 'LOW', bg: '#eef2ec', fg: '#6b8f6b' },
}
const INTENT_EMOJI: Record<string, string> = { shipping: '📦', refund: '↩️', price: '💸', complaint: '⚠️', question: '❓', other: '💬' }
const OUT_TYPES: { type: string; label: string; emoji: string }[] = [
  { type: 'cart_recovery', label: 'Abandoned cart', emoji: '🛒' },
  { type: 'winback', label: 'Win-back', emoji: '👋' },
  { type: 'review_request', label: 'Review request', emoji: '⭐' },
]

export default function InboxPage() {
  const [tab, setTab] = useState<'inbox' | 'outbound'>('inbox')
  const [threads, setThreads] = useState<Thread[]>([])
  const [outbound, setOutbound] = useState<Outbound[]>([])
  const [rollup, setRollup] = useState<Record<string, number>>({})
  const [stats, setStats] = useState<{ handled: number; sales: number; revenue: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})   // keyed by message id
  const [busy, setBusy] = useState<string>('')
  const [simText, setSimText] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const [outBusy, setOutBusy] = useState('')
  const [channels, setChannels] = useState<string[] | null>(null)   // connected customer-channel providers
  const [connecting, setConnecting] = useState('')

  const load = () => fetch('/api/customer/inbox', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (Array.isArray(j.threads)) setThreads(j.threads)
    if (Array.isArray(j.outbound)) setOutbound(j.outbound)
    if (j.rollup) setRollup(j.rollup)
    if (j.stats) setStats(j.stats)
  }).catch(() => {}).finally(() => setLoading(false))

  const markSale = async (threadId: string) => {
    const raw = window.prompt('Mark this as a sale — order value? (optional, just press OK to skip)')
    if (raw === null) return
    const amount = Number(String(raw).replace(/[^0-9.]/g, ''))
    await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mark_sale', threadId, amount }) }).catch(() => {})
    toast.success('Counted as a sale 💰'); load()
  }
  const loadChannels = () => fetch('/api/channels/unipile/connect').then(r => r.ok ? r.json() : null)
    .then(j => setChannels(Array.isArray(j?.connected) ? j.connected.filter((c: any) => c.kind !== 'founder').map((c: any) => c.provider) : []))
    .catch(() => setChannels([]))
  useEffect(() => {
    load(); loadChannels()
    // Returned here from a channel connect (?connected=…) → toast + refresh the strip (reconcile binds it).
    const p = new URLSearchParams(window.location.search)
    const ok = p.get('connected'); const err = p.get('connect_error')
    if (ok) { toast.success(`${ok[0].toUpperCase()}${ok.slice(1)} connected — messages will land here.`); window.history.replaceState({}, '', '/inbox'); setTimeout(loadChannels, 400) }
    else if (err) { toast.error(`Couldn’t connect ${err} — try again.`); window.history.replaceState({}, '', '/inbox') }
  }, [])

  const connectChannel = async (provider: string) => {
    setConnecting(provider)
    try {
      const j = await fetch('/api/channels/unipile/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, returnTo: '/inbox' }) }).then(r => r.json())
      if (j?.url) { window.location.href = j.url }
      else { toast.error(j?.error || 'Channels aren’t set up yet.'); setConnecting('') }
    } catch { toast.error('Something went wrong.'); setConnecting('') }
  }

  // Approve/skip a message by id. `fallback` = the draft to send if the founder didn't edit.
  const act = async (messageId: string, fallback: string, action: 'approve' | 'skip', from: 'inbox' | 'outbound') => {
    setBusy(messageId)
    try {
      const reply = action === 'approve' ? (drafts[messageId] ?? fallback ?? '') : undefined
      const r = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, messageId, reply }) }).then(x => x.json())
      if (r?.ok) {
        if (from === 'inbox') setThreads(ts => ts.filter(t => t.latest?.id !== messageId))
        else setOutbound(os => os.filter(o => o.id !== messageId))
        toast.success(action === 'approve' ? (r.note || 'Approved ✓') : 'Skipped')
      } else toast.error(r?.error || 'Something went wrong')
    } catch { toast.error('Something went wrong') } finally { setBusy('') }
  }

  const simulate = async () => {
    const body = simText.trim(); if (!body) return
    setSimBusy(true)
    try {
      const r = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'simulate', body }) }).then(x => x.json())
      if (r?.ok) { setSimText(''); load(); toast.success('Mello triaged it — see the top of your inbox') }
      else toast.error(r?.error || 'Could not simulate')
    } catch { toast.error('Could not simulate') } finally { setSimBusy(false) }
  }

  const simulateOutbound = async (type: string) => {
    setOutBusy(type)
    try {
      const r = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'simulate_outbound', type }) }).then(x => x.json())
      if (r?.ok) { load(); toast.success('Mello drafted it — approve to send') }
      else toast.error(r?.error || 'Could not draft')
    } catch { toast.error('Could not draft') } finally { setOutBusy('') }
  }

  const Tab = ({ id, label, count }: { id: 'inbox' | 'outbound'; label: string; count: number }) => (
    <button onClick={() => setTab(id)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 800, padding: '4px 2px', color: tab === id ? INK : '#9aa79a', borderBottom: `2px solid ${tab === id ? FOREST : 'transparent'}` }}>
      {label}{count > 0 && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 800, background: tab === id ? FOREST : '#eef2ec', color: tab === id ? LIME : SUB, borderRadius: 100, padding: '1px 7px' }}>{count}</span>}
    </button>
  )

  const ActionRow = ({ messageId, fallback, from }: { messageId: string; fallback: string; from: 'inbox' | 'outbound' }) => {
    const draft = drafts[messageId] ?? fallback ?? ''
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => act(messageId, fallback, 'approve', from)} disabled={busy === messageId || !draft.trim()} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: busy === messageId ? 'default' : 'pointer', opacity: busy === messageId || !draft.trim() ? 0.6 : 1 }}>
          {busy === messageId ? 'Sending…' : 'Approve & send →'}
        </button>
        <button onClick={() => act(messageId, fallback, 'skip', from)} disabled={busy === messageId} style={{ background: '#fff', color: SUB, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Skip</button>
      </div>
    )
  }

  const DraftBox = ({ messageId, fallback }: { messageId: string; fallback: string }) => (
    <textarea value={drafts[messageId] ?? fallback ?? ''} onChange={e => setDrafts(d => ({ ...d, [messageId]: e.target.value }))} rows={3}
      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
  )

  return (
    <div style={{ padding: '32px 28px', maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: '-.02em', marginBottom: 4 }}>Customer Inbox</h1>
      <p style={{ fontSize: 13.5, color: SUB, marginBottom: 18 }}>Messages sorted by what matters, and proactive nudges Mello wants to send — each with a draft ready. You approve; nothing sends on its own.</p>

      {/* Attribution — what the Customer Employee did this month + revenue it's credited with. */}
      {stats && (stats.handled > 0 || stats.sales > 0) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, background: FOREST, color: '#fff', borderRadius: 12, padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>
            <b style={{ color: LIME, fontSize: 15 }}>{stats.handled}</b> handled this month
          </span>
          {stats.sales > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, background: '#eaf3de', color: '#3b6d11', borderRadius: 12, padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>
              <b style={{ fontSize: 15 }}>{stats.sales}</b> led to sales{stats.revenue > 0 ? ` · €${Math.round(stats.revenue).toLocaleString()}` : ''} 💰
            </span>
          )}
        </div>
      )}

      {/* Your channels — what's connected, what's still pending, connect right here. */}
      {channels !== null && (() => {
        const CH = [
          { k: 'instagram', label: 'Instagram' },
          { k: 'whatsapp', label: 'WhatsApp' },
          { k: 'messenger', label: 'Messenger' },
          { k: 'telegram', label: 'Telegram' },
          { k: 'linkedin', label: 'LinkedIn' },
          { k: 'x', label: 'X' },
          { k: 'email', label: 'Email' },
        ]
        const pending = CH.filter(c => !channels.includes(c.k)).length
        return (
          <div style={{ ...card, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>Your channels</span>
              <span style={{ fontSize: 12, color: SUB }}>{channels.length} connected{pending ? ` · ${pending} to connect` : ' · all set 🌱'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CH.map(c => {
                const on = channels.includes(c.k)
                return (
                  <div key={c.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${on ? '#cfe6b8' : LINE}`, background: on ? '#f6fbef' : '#fff', borderRadius: 100, padding: '6px 10px 6px 9px' }}>
                    <span style={{ display: 'inline-flex' }}><ChannelLogo provider={c.k} size={17} /></span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{c.label}</span>
                    {on ? (
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: '#3b6d11' }}>✓</span>
                    ) : (
                      <button onClick={() => connectChannel(c.k)} disabled={connecting === c.k}
                        style={{ marginLeft: 2, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '3px 10px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: connecting === c.k ? 'default' : 'pointer', opacity: connecting === c.k ? 0.6 : 1 }}>
                        {connecting === c.k ? '…' : 'Connect'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${LINE}`, marginBottom: 20 }}>
        <Tab id="inbox" label="Inbox" count={threads.length} />
        <Tab id="outbound" label="Outbound" count={outbound.length} />
      </div>

      {tab === 'inbox' ? (<>
        {Object.keys(rollup).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {Object.entries(rollup).sort((a, b) => b[1] - a[1]).map(([intent, n]) => (
              <span key={intent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: INK }}>
                <span>{INTENT_EMOJI[intent] || '💬'}</span>{intent}<span style={{ color: SUB }}>{n}</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ ...card, padding: 14, marginBottom: 20, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={simText} onChange={e => setSimText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') simulate() }}
            placeholder="Try a customer message — e.g. “my order hasn't arrived” or “can I get a refund?”"
            style={{ flex: '1 1 320px', minWidth: 200, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#f8fcf6', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={simulate} disabled={simBusy || !simText.trim()} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: simBusy || !simText.trim() ? 'default' : 'pointer', opacity: simBusy || !simText.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {simBusy ? 'Triaging…' : 'Simulate a message'}
          </button>
        </div>

        {loading ? <div style={{ fontSize: 14, color: SUB, padding: 20 }}>Loading your inbox…</div>
        : threads.length === 0 ? (
          <div style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 750, color: INK, marginBottom: 6 }}>Nothing waiting on you 🌱</div>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>Connect Instagram or WhatsApp in <Link href="/settings" style={{ color: '#3f8f4f', fontWeight: 700, textDecoration: 'none' }}>Settings</Link> and every customer message lands here — triaged, prioritized, reply ready. Or try the box above.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {threads.map(t => {
              const pri = PRI[t.priority] || PRI.low; const msg = t.latest; if (!msg) return null
              return (
                <div key={t.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ background: pri.bg, color: pri.fg, borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em' }}>{pri.label}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{t.contact_name || 'Customer'}</span>
                    {t.intent === 'price' && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: '#3b6d11', background: '#eaf3de', borderRadius: 6, padding: '2px 7px' }}>💰 SALES</span>}
                    {t.intent && t.intent !== 'price' && <span style={{ fontSize: 12, color: SUB, fontWeight: 650 }}>{INTENT_EMOJI[t.intent] || '💬'} {t.intent}</span>}
                    <span style={{ fontSize: 11.5, color: '#a7b0a5', fontWeight: 600, marginLeft: 'auto', textTransform: 'capitalize' }}>{t.channel}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.5, background: '#f6f8f4', borderRadius: 10, padding: '10px 12px' }}>{msg.body}</div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3f8f4f', marginBottom: 6 }}>Mello&rsquo;s suggested reply</div>
                    <DraftBox messageId={msg.id} fallback={msg.suggested_reply || ''} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <ActionRow messageId={msg.id} fallback={msg.suggested_reply || ''} from="inbox" />
                    <button onClick={() => markSale(t.id)} style={{ background: 'none', border: 'none', color: '#3b6d11', fontSize: 12, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>💰 Mark sale</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </>) : (<>
        {/* Outbound — proactive nudges Mello wants to send */}
        <div style={{ ...card, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>Ask Mello to draft a proactive message — it never sends without your OK.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {OUT_TYPES.map(o => (
              <button key={o.type} onClick={() => simulateOutbound(o.type)} disabled={outBusy === o.type}
                style={{ background: '#f8fcf6', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '8px 14px', fontSize: 12.5, fontWeight: 750, fontFamily: 'inherit', cursor: outBusy === o.type ? 'default' : 'pointer', opacity: outBusy === o.type ? 0.6 : 1 }}>
                {outBusy === o.type ? 'Drafting…' : `${o.emoji} ${o.label}`}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div style={{ fontSize: 14, color: SUB, padding: 20 }}>Loading…</div>
        : outbound.length === 0 ? (
          <div style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 750, color: INK, marginBottom: 6 }}>No nudges queued</div>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>When a cart is abandoned or a customer goes quiet, Mello will draft the reach-out here for you to approve. Try one above to see how it reads.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {outbound.map(o => {
              const meta = OUT_TYPES.find(x => x.type === o.intent)
              return (
                <div key={o.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ background: '#eaf3de', color: '#3b6d11', borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em' }}>{meta ? `${meta.emoji} ${meta.label.toUpperCase()}` : 'OUTBOUND'}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{o.thread?.contact_name || 'Customer'}</span>
                    <span style={{ fontSize: 11.5, color: '#a7b0a5', fontWeight: 600, marginLeft: 'auto', textTransform: 'capitalize' }}>{o.thread?.channel || 'outbound'}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3f8f4f', marginBottom: 6 }}>Mello wants to send</div>
                    <DraftBox messageId={o.id} fallback={o.body || ''} />
                  </div>
                  <ActionRow messageId={o.id} fallback={o.body || ''} from="outbound" />
                </div>
              )
            })}
          </div>
        )}
      </>)}
    </div>
  )
}
