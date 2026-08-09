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
import { prettyInbound } from '@/lib/customer/pretty'

const INK = '#17251c', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#1a3a1a', LIME = '#dffe95', MUTED = '#6b6b6b'
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(17,37,28,.04), 0 10px 30px -20px rgba(17,37,28,.10)' }

type Msg = { id: string; body: string; intent?: string; priority?: string; suggested_reply?: string; status: string }
type Thread = { id: string; contact_name?: string; contact_ref?: string; channel: string; priority: 'high' | 'med' | 'low'; intent?: string; status: string; last_message_at: string; latest: Msg | null; brand_id?: string | null; brand_name?: string | null }
type Outbound = Msg & { thread?: { contact_name?: string; channel?: string } | null }
type Theme = { title: string; count: number; example: string; recommendation: string; priority: 'high' | 'med' | 'low' }
type Insights = {
  days: number; totalMessages: number; totalThreads: number
  intents: { intent: string; count: number; delta: number }[]
  themes: Theme[]; summary: string; reasoned: boolean; generatedAt: string
}

const PRI: Record<string, { label: string; bg: string; fg: string }> = {
  high: { label: 'HIGH', bg: '#fdecec', fg: '#c0392b' },
  med: { label: 'MEDIUM', bg: '#fef6e7', fg: '#b7791f' },
  low: { label: 'LOW', bg: '#eef2ec', fg: '#6b8f6b' },
}
const INTENT_EMOJI: Record<string, string> = { shipping: '📦', refund: '↩️', price: '💸', complaint: '⚠️', question: '❓', other: '💬' }

// Module-scoped so its identity is STABLE across parent re-renders. When this lived inside InboxPage,
// every keystroke (setDrafts → re-render) minted a new component type, so React unmounted and remounted
// the textarea and the caret was lost after each letter. Hoisting it fixes the "click after every letter" bug.
function DraftBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
  )
}
const OUT_TYPES: { type: string; label: string; emoji: string }[] = [
  { type: 'follow_up', label: 'Sales follow-up', emoji: '💬' },
  { type: 'cart_recovery', label: 'Abandoned cart', emoji: '🛒' },
  { type: 'winback', label: 'Win-back', emoji: '👋' },
  { type: 'review_request', label: 'Review request', emoji: '⭐' },
]

export default function InboxPage() {
  const [tab, setTab] = useState<'inbox' | 'outbound' | 'insights'>('inbox')
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
  const [chanBrand, setChanBrand] = useState<Record<string, string>>({})   // provider → brand_id it's linked to
  const [connecting, setConnecting] = useState('')
  const [intentFilter, setIntentFilter] = useState<string | null>(null)   // click a rollup chip to filter the inbox
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])   // for the channel→brand assign + thread chips

  // The threads shown after the intent-chip filter (null = show all).
  const shownThreads = intentFilter ? threads.filter(t => t.intent === intentFilter) : threads

  // Lazy-load the Customer Success trends report the first time the Insights tab is opened.
  const loadInsights = (fresh = false) => {
    setInsightsLoading(true)
    fetch(`/api/customer/insights${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && !j.error) setInsights(j) })
      .catch(() => {}).finally(() => setInsightsLoading(false))
  }
  useEffect(() => { if (tab === 'insights' && !insights && !insightsLoading) loadInsights() }, [tab])   // eslint-disable-line react-hooks/exhaustive-deps

  // The inbox scopes to the app-wide project (the sidebar switcher's `sf_brand` cookie) — the API reads it,
  // so there's no per-page brand picker here.
  const load = () => fetch('/api/customer/inbox', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (Array.isArray(j.threads)) setThreads(j.threads)
    if (Array.isArray(j.outbound)) setOutbound(j.outbound)
    if (j.rollup) setRollup(j.rollup)
    if (j.stats) setStats(j.stats)
  }).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { fetch('/api/brands').then(r => r.ok ? r.json() : null).then(j => setBrands((j?.brands || []).map((b: any) => ({ id: String(b.id), name: String(b.name) })))).catch(() => {}) }, [])

  const markSale = async (threadId: string) => {
    const raw = window.prompt('Mark this as a sale — order value? (optional, just press OK to skip)')
    if (raw === null) return
    const amount = Number(String(raw).replace(/[^0-9.]/g, ''))
    await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mark_sale', threadId, amount }) }).catch(() => {})
    toast.success('Counted as a sale 💰'); load()
  }
  const loadChannels = () => fetch('/api/channels/unipile/connect').then(r => r.ok ? r.json() : null)
    .then(j => {
      const cust = Array.isArray(j?.connected) ? j.connected.filter((c: any) => c.kind !== 'founder') : []
      setChannels(cust.map((c: any) => c.provider))
      const m: Record<string, string> = {}; for (const c of cust) if (c.brand_id) m[c.provider] = String(c.brand_id); setChanBrand(m)
    })
    .catch(() => setChannels([]))
  // Link a connected channel to a brand — future messages on it become that brand's threads.
  const assignChannel = async (provider: string, brandId: string) => {
    setChanBrand(prev => ({ ...prev, [provider]: brandId }))
    const bname = brands.find(b => b.id === brandId)?.name || 'brand'
    const j = await fetch('/api/customer/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'assign_channel', provider, brandId: brandId || null }) }).then(r => r.json()).catch(() => null)
    if (!brandId) toast.success('Channel unlinked.')
    else if (j?.moved > 0) toast.success(`Linked to ${bname} — moved ${j.moved} conversation${j.moved === 1 ? '' : 's'} over.`)
    else toast.success(`Channel linked to ${bname}.`)
    load()   // reflect the moved threads under the current filter
  }
  useEffect(() => {
    load(); loadChannels()
    // Returned here from a channel connect (?connected=…) → toast + refresh the strip (reconcile binds it).
    const p = new URLSearchParams(window.location.search)
    const ok = p.get('connected'); const err = p.get('connect_error')
    if (ok) { toast.success(`${ok[0].toUpperCase()}${ok.slice(1)} connected — messages will land here.`); window.history.replaceState({}, '', '/inbox'); setTimeout(loadChannels, 400) }
    else if (err) { toast.error(`Couldn’t connect ${err} — try again.`); window.history.replaceState({}, '', '/inbox') }
    // Switching the active project (rail switcher) → re-pull this brand's inbox without a full reload.
    const onBrand = () => load()
    window.addEventListener('sf:brandchange', onBrand)
    return () => window.removeEventListener('sf:brandchange', onBrand)
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

  const Tab = ({ id, label, count }: { id: 'inbox' | 'outbound' | 'insights'; label: string; count: number }) => (
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
                      <>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: '#3b6d11' }}>✓</span>
                        {brands.length > 1 && (
                          <select value={chanBrand[c.k] || ''} onChange={e => assignChannel(c.k, e.target.value)}
                            title="Which brand does this channel serve?"
                            style={{ marginLeft: 4, background: '#fff', color: INK, border: `1px solid ${LINE}`, borderRadius: 100, padding: '2px 6px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                            <option value="">Any brand</option>
                            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                      </>
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
        <Tab id="insights" label="Trends" count={0} />
      </div>

      {tab === 'insights' ? (
        <InsightsPanel data={insights} loading={insightsLoading} onRefresh={() => loadInsights(true)} onOpenInbox={intent => { setIntentFilter(intent || null); setTab('inbox') }} />
      ) : tab === 'inbox' ? (<>
        {Object.keys(rollup).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {Object.entries(rollup).sort((a, b) => b[1] - a[1]).map(([intent, n]) => {
              const on = intentFilter === intent
              return (
                <button key={intent} onClick={() => setIntentFilter(f => f === intent ? null : intent)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: on ? FOREST : '#fff', border: `1px solid ${on ? FOREST : LINE}`, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: on ? LIME : INK, fontFamily: 'inherit', cursor: 'pointer' }}>
                  <span>{INTENT_EMOJI[intent] || '💬'}</span>{intent}<span style={{ color: on ? '#cfe6b8' : SUB }}>{n}</span>
                </button>
              )
            })}
            {intentFilter && (
              <button onClick={() => setIntentFilter(null)} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Clear ✕</button>
            )}
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
            {shownThreads.length === 0 && (
              <div style={{ ...card, padding: '20px 24px', textAlign: 'center', fontSize: 13.5, color: SUB }}>No <b style={{ color: INK }}>{intentFilter}</b> messages right now. <button onClick={() => setIntentFilter(null)} style={{ background: 'none', border: 'none', color: '#3f8f4f', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', fontSize: 13.5 }}>Show all</button></div>
            )}
            {shownThreads.map(t => {
              const pri = PRI[t.priority] || PRI.low; const msg = t.latest; if (!msg) return null
              return (
                <div key={t.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ background: pri.bg, color: pri.fg, borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em' }}>{pri.label}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{t.contact_name || 'Customer'}</span>
                    {t.brand_name && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3f5b8f', background: '#eef2fb', borderRadius: 6, padding: '2px 7px' }}>{t.brand_name}</span>}
                    {t.intent === 'price' && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: '#3b6d11', background: '#eaf3de', borderRadius: 6, padding: '2px 7px' }}>💰 SALES</span>}
                    {t.intent && t.intent !== 'price' && <span style={{ fontSize: 12, color: SUB, fontWeight: 650 }}>{INTENT_EMOJI[t.intent] || '💬'} {t.intent}</span>}
                    <span style={{ fontSize: 11.5, color: '#a7b0a5', fontWeight: 600, marginLeft: 'auto', textTransform: 'capitalize' }}>{t.channel}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.5, background: '#f6f8f4', borderRadius: 10, padding: '10px 12px' }}>{prettyInbound(msg.body)}</div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3f8f4f', marginBottom: 6 }}>Mello&rsquo;s suggested reply</div>
                    <DraftBox value={drafts[msg.id] ?? msg.suggested_reply ?? ''} onChange={v => setDrafts(d => ({ ...d, [msg.id]: v }))} />
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
                    <DraftBox value={drafts[o.id] ?? o.body ?? ''} onChange={v => setDrafts(d => ({ ...d, [o.id]: v }))} />
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

/** Customer Success trends — the report Mello writes from the inbox: what people keep asking, and the fix. */
function InsightsPanel({ data, loading, onRefresh, onOpenInbox }: { data: Insights | null; loading: boolean; onRefresh: () => void; onOpenInbox: (intent?: string) => void }) {
  const PRIB: Record<string, { bg: string; fg: string; label: string }> = {
    high: { bg: '#fdecec', fg: '#c0392b', label: 'FIX SOON' },
    med: { bg: '#fef6e7', fg: '#b7791f', label: 'WORTH DOING' },
    low: { bg: '#eef2ec', fg: '#6b8f6b', label: 'NICE TO HAVE' },
  }
  if (loading && !data) return <div style={{ fontSize: 14, color: SUB, padding: 20 }}>Reading your conversations…</div>
  if (!data) return <div style={{ ...card, padding: '32px 24px', textAlign: 'center', fontSize: 13.5, color: SUB }}>Couldn’t build the report right now. <button onClick={onRefresh} style={{ background: 'none', border: 'none', color: '#3f8f4f', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', fontSize: 13.5 }}>Try again</button></div>
  const arrow = (d: number) => d > 0 ? <span style={{ color: '#c0392b', fontWeight: 800 }}>↑{d}</span> : d < 0 ? <span style={{ color: '#3b6d11', fontWeight: 800 }}>↓{Math.abs(d)}</span> : <span style={{ color: '#a7b0a5' }}>—</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary + refresh */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: INK, lineHeight: 1.5 }}>{data.summary}</div>
          <div style={{ fontSize: 11.5, color: '#a7b0a5', marginTop: 4 }}>Last {data.days} days · {data.reasoned ? 'themes read by Mello' : 'grouped by type'}</div>
        </div>
        <button onClick={onRefresh} disabled={loading} style={{ background: '#f8fcf6', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '7px 14px', fontSize: 12.5, fontWeight: 750, fontFamily: 'inherit', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {data.totalMessages === 0 ? (
        <div style={{ ...card, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: INK, marginBottom: 6 }}>No trends yet 🌱</div>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>Once customers start messaging, Mello reads every conversation and tells you what they keep asking about — and what to fix.</div>
        </div>
      ) : (<>
        {/* intent trend strip */}
        {data.intents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.intents.map(it => (
              <span key={it.intent} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: INK }}>
                <span>{INTENT_EMOJI[it.intent] || '💬'}</span>{it.intent}<span style={{ color: SUB }}>{it.count}</span>{arrow(it.delta)}
              </span>
            ))}
          </div>
        )}

        {/* Trends is a read of patterns across conversations — the fix Mello suggests, not the live chat.
            Make that explicit + give a one-click way over to the Inbox to actually reply. */}
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5 }}>These are patterns across your conversations — to reply to a customer, open the <b style={{ color: INK }}>Inbox</b> tab.</div>

        {/* themes → recommendation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.themes.map((t, i) => {
            const p = PRIB[t.priority] || PRIB.med
            return (
              <div key={i} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ background: p.bg, color: p.fg, borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '.05em' }}>{p.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 750, color: INK }}>{t.title}</span>
                  <span style={{ fontSize: 12, color: SUB, fontWeight: 700, marginLeft: 'auto' }}>{t.count} message{t.count === 1 ? '' : 's'}</span>
                </div>
                {t.example && <div style={{ fontSize: 12.5, color: MUTED, fontStyle: 'italic', background: '#f6f8f4', borderRadius: 10, padding: '8px 12px', lineHeight: 1.5 }}>“{prettyInbound(t.example)}”</div>}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: '#3f8f4f', fontWeight: 800, flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 13.5, color: INK, fontWeight: 650, lineHeight: 1.5 }}>{t.recommendation}</span>
                </div>
                <button onClick={() => onOpenInbox()} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, marginTop: 2, color: '#3f8f4f', fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>Reply in Inbox →</button>
              </div>
            )
          })}
        </div>
      </>)}
    </div>
  )
}
