'use client'
/**
 * MelloAdsChat — run your ads by chatting. Pick a template (or type), and Mello walks you through it in
 * chat with tappable options: creative → audience → budget → a confirm card → LIVE (paused for review).
 * The guided launch is a deterministic client flow (instant, no waiting on the model); free-text still
 * routes to /api/ads/action for scale/pause/resume/edit/duplicate. Confirm-first; launches land PAUSED.
 */
import { useState, useEffect, useRef } from 'react'
import { celebrate } from '@/lib/celebrate'

const ORANGE = '#ef4a1e', INK = '#1a1410', SUB = '#6f665a', LINE = '#e3ded2', PAPER = '#f4f0e7'

type Chip = { label: string; onClick: () => void; sub?: string; image?: string | null }
type Msg = { who: 'mello' | 'you'; text?: string; chips?: Chip[]; card?: any; note?: string }
type Creative = { id: string; image_url: string | null; brand_name?: string | null; prompt?: string | null; media_type?: string }

const TEMPLATES: { emoji: string; title: string; desc: string; audience?: string; audienceLabel?: string }[] = [
  { emoji: '🎯', title: 'Run ads for a targeted audience', desc: 'Reach new people by interest — Mello finds the right interests and builds the audience for you.', audience: '', audienceLabel: 'targeted' },
  { emoji: '🔁', title: 'Run ads for retargeting', desc: 'Win back people who already know you — visitors, engagers, and past customers.', audience: 'retargeting — people who already engaged with the brand (site visitors, video viewers, past buyers)', audienceLabel: 'retargeting' },
  { emoji: '🚀', title: 'Launch my best creative', desc: 'Pick a creative and go live in three taps — creative, audience, budget.', audienceLabel: 'targeted' },
  { emoji: '📈', title: 'Scale a winner', desc: 'Bump the budget on a campaign that’s working. Just tell me which and how much.', audienceLabel: 'scale' },
]

const BUDGETS = [20, 50, 100, 200]

export default function MelloAdsChat({ website, brandName }: { website?: string; brandName?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  // guided-launch draft
  const draft = useRef<{ creativeUrl?: string; audience?: string; audienceLabel?: string; budget?: number }>({})

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const push = (m: Msg) => setMsgs((x) => [...x, m])
  const mello = (text: string, extra: Partial<Msg> = {}) => push({ who: 'mello', text, ...extra })
  const you = (text: string) => push({ who: 'you', text })

  // ── guided launch steps ──
  const startTemplate = async (t: typeof TEMPLATES[number]) => {
    setStarted(true)
    you(t.title)
    draft.current = { audience: t.audience, audienceLabel: t.audienceLabel }
    if (t.audienceLabel === 'scale') { mello('Sure — which campaign should I scale, and to what budget? e.g. “scale ROY 1 to €80/day”.'); return }
    await askCreative()
  }

  const askCreative = async () => {
    mello('Great — which creative should we run? Pick one:')
    try {
      const j = await fetch('/api/creatives').then((r) => r.json())
      const imgs: Creative[] = (j.creatives || []).filter((c: Creative) => c.image_url && c.media_type !== 'video').slice(0, 8)
      if (!imgs.length) { mello('You don’t have any image creatives yet — make one in Ad Studio first, then come back and we’ll launch it.'); return }
      push({ who: 'mello', chips: imgs.map((c) => ({ label: c.brand_name || c.prompt?.slice(0, 20) || 'Creative', image: c.image_url, onClick: () => pickCreative(c) })) })
    } catch { mello('Couldn’t load your creatives — try again.') }
  }

  const pickCreative = (c: Creative) => {
    draft.current.creativeUrl = c.image_url || undefined
    you('That one 👆')
    if (draft.current.audienceLabel === 'retargeting') return askBudget()
    askAudience()
  }

  const askAudience = () => {
    mello('Who should see it?', { chips: [
      { label: '🎯 Targeted — by interest', sub: 'Tell me who, I’ll build the audience', onClick: () => { draft.current.audienceLabel = 'targeted'; mello('Describe them — e.g. “women 25–40 into wellness & clean beauty”. Type below 👇') } },
      { label: '🔁 Retargeting', sub: 'People who already engaged', onClick: () => { draft.current.audience = 'retargeting — people who already engaged with the brand'; draft.current.audienceLabel = 'retargeting'; you('Retargeting'); askBudget() } },
      { label: '🌍 Broad', sub: 'Let Meta find buyers', onClick: () => { draft.current.audience = 'broad'; draft.current.audienceLabel = 'broad'; you('Broad'); askBudget() } },
    ] })
  }

  const askBudget = () => {
    mello('Last thing — daily budget?', { chips: BUDGETS.map((b) => ({ label: `€${b}/day`, onClick: () => { draft.current.budget = b; you(`€${b}/day`); finalize() } })) })
  }

  // The user ASKED instead of describing (e.g. "what audience for this product?") — treat it as a real
  // question, not the audience value. True if it's phrased as a question / advice request.
  const isAudienceQuestion = (s: string) => /\?\s*$/.test(s.trim())
    || /^(what|which|who|how|why|recommend|suggest|best|ideal|help|idk|not sure|any idea|give me|can you|don'?t know|no idea)\b/i.test(s.trim())
    || /you think|your (opinion|recommendation|suggestion)|right audience|best audience|which audience|good audience|target/i.test(s)

  // Read the store and suggest real audiences → tap one and Mello builds it (then straight to budget).
  const recommendAudience = async () => {
    mello('Good question — let me read your store and suggest the audiences I’d run…')
    try {
      const dom = (website || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
      const r = await fetch(`/api/ads-studio/audiences?domain=${encodeURIComponent(dom)}`)
      const j = await r.json().catch(() => ({}))
      const auds: { name: string; insights: string[] }[] = Array.isArray(j?.audiences) ? j.audiences.slice(0, 4) : []
      if (!auds.length) { mello('I couldn’t read enough from your store to suggest — describe your buyer (e.g. “women 25–40 into wellness & clean beauty”) and I’ll build it. 👇'); return }
      push({ who: 'mello', text: `For ${brandName || 'your store'}${j.market ? ` (${j.market})` : ''}, here are the audiences I’d run — tap one and I’ll build it:`, chips: auds.map((a) => ({
        label: `🎯 ${a.name}`, sub: a.insights?.[0]?.slice(0, 64),
        onClick: () => { draft.current.audience = `${a.name} — ${(a.insights || []).slice(0, 3).join('; ')}`; you(a.name); askBudget() },
      })) })
    } catch { mello('Couldn’t pull suggestions just now — describe your buyer and I’ll build it. 👇') }
  }

  const finalize = async () => {
    const d = draft.current
    if (!d.creativeUrl || !d.budget) return
    setBusy(true)
    mello('Building it now…')
    try {
      const message = `launch this at €${d.budget}/day ${d.audienceLabel === 'broad' ? 'to a broad audience' : d.audienceLabel === 'retargeting' ? 'retargeting people who already engaged with the brand' : `targeting ${d.audience || 'my ideal customers'}`}`
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'plan', message, attach: { creativeUrl: d.creativeUrl, brandName, website } }) })
      const res = await r.json()
      if (res.card) push({ who: 'mello', text: 'Here’s the plan — approve and it goes live (paused for your review):', card: res.card })
      else if (res.clarify) mello(res.clarify)
      else mello(res.error || 'Couldn’t build that — try again.')
    } catch { mello('Something went wrong — try again.') } finally { setBusy(false) }
  }

  // ── free-text (scale/pause/resume/edit/duplicate) ──
  const send = async () => {
    if (!input.trim() || busy) return
    const message = input.trim(); setInput(''); you(message); setStarted(true); setBusy(true)
    // Mid-launch, waiting for a targeted audience. If they ASKED (a question) rather than described one,
    // recommend audiences from their store instead of silently treating the question as the audience.
    if (draft.current.audienceLabel === 'targeted' && draft.current.creativeUrl && !draft.current.budget && !draft.current.audience) {
      if (isAudienceQuestion(message)) { await recommendAudience(); setBusy(false); return }
      draft.current.audience = message; setBusy(false); return askBudget()
    }
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'plan', message }) })
      const res = await r.json()
      if (res.card) push({ who: 'mello', text: 'Here’s what I’ll do — approve to run it:', card: res.card })
      else if (res.clarify) mello(res.clarify)
      else mello(res.error || 'Tell me what to do — e.g. “scale ROY 1 to €80/day” or pick a template above.')
    } catch { mello('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const approve = async (card: any, idx: number) => {
    setBusy(true)
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'execute', action: card.action }) })
      const res = await r.json()
      setMsgs((x) => x.map((m, i) => i === idx ? { ...m, card: null } : m))
      if (res.ok) {
        mello(`✅ ${res.message}`)
        const isLaunch = card.action?.kind === 'launch'
        celebrate(isLaunch
          ? { emoji: '🚀', title: 'Your ad is ready to fly!', sub: 'Created and paused for your review — flip it live in Meta and watch it go.' }
          : { emoji: '⚡', title: 'Done — Mello handled it.', sub: card.title })
        draft.current = {}
      } else mello(res.error || 'Meta rejected that.')
    } catch { mello('Something went wrong — try again.') } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: '#fff', overflow: 'hidden', boxShadow: '0 24px 60px -44px rgba(20,20,16,.4)' }}>
      {/* header */}
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10, background: PAPER }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15 }}>✦</span>
        <div><div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>Run your ads with Mello</div><div style={{ fontSize: 12, color: SUB }}>Type it or tap a template — Mello walks you through, you approve, it’s live.</div></div>
      </div>

      {/* conversation */}
      <div style={{ maxHeight: started ? 460 : 'none', overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!started && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {TEMPLATES.map((t) => (
              <button key={t.title} onClick={() => startTemplate(t)} style={{ textAlign: 'left', border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, cursor: 'pointer', transition: 'background .15s, transform .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = PAPER; e.currentTarget.style.transform = 'translateY(-2px)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.transform = 'none' }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{t.emoji}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.who === 'you' ? 'flex-end' : 'flex-start', gap: 8 }}>
            {m.text && (
              <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: 14, fontSize: 14, lineHeight: 1.5, background: m.who === 'you' ? ORANGE : PAPER, color: m.who === 'you' ? '#fff' : INK, borderBottomRightRadius: m.who === 'you' ? 4 : 14, borderBottomLeftRadius: m.who === 'you' ? 14 : 4 }}>{m.text}</div>
            )}
            {m.chips && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: '92%' }}>
                {m.chips.map((c, j) => (
                  <button key={j} onClick={c.onClick} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: c.image ? 10 : 100, background: '#fff', padding: c.image ? 6 : '9px 14px', cursor: 'pointer', textAlign: 'left', maxWidth: 200 }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = ORANGE)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = LINE)}>
                    {c.image && <span style={{ width: 40, height: 40, borderRadius: 7, overflow: 'hidden', flex: 'none', background: PAPER }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={c.image} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>}
                    <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>{c.sub && <span style={{ display: 'block', fontSize: 11, color: SUB }}>{c.sub}</span>}</span>
                  </button>
                ))}
              </div>
            )}
            {m.card && (
              <div style={{ width: '92%', border: `1px solid ${ORANGE}33`, borderRadius: 14, background: '#fff', padding: 16, boxShadow: '0 16px 40px -28px rgba(239,74,30,.4)' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 4 }}>{m.card.title}</div>
                <div style={{ fontSize: 13, color: SUB, marginBottom: (m.card.lines || []).length ? 10 : 14 }}>{m.card.summary}</div>
                {(m.card.lines || []).map((l: string, k: number) => <div key={k} style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>• {l}</div>)}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => approve(m.card, i)} disabled={busy} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{busy ? 'Working…' : m.card.confirmLabel}</button>
                  <button onClick={() => setMsgs((x) => x.map((mm, ii) => ii === i ? { ...mm, card: null } : mm))} disabled={busy} style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 100, padding: '10px 16px', fontSize: 14, fontWeight: 600, color: SUB, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div style={{ padding: 14, borderTop: `1px solid ${LINE}`, display: 'flex', gap: 8, background: '#fff' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type it — “scale ROY 1 to €80/day”, “pause the slow one”, or describe your audience…"
          style={{ flex: 1, padding: '12px 16px', fontSize: 14, borderRadius: 100, border: `1px solid ${LINE}`, outline: 'none', color: INK }} />
        <button onClick={send} disabled={busy || !input.trim()} style={{ background: input.trim() ? ORANGE : LINE, color: '#fff', border: 'none', borderRadius: 100, padding: '12px 22px', fontSize: 14, fontWeight: 800, cursor: input.trim() ? 'pointer' : 'default' }}>Send</button>
      </div>
    </div>
  )
}
