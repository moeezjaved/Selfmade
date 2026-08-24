'use client'
/**
 * /hq — chat-first Home (Unified Shell v2, Phase 4). Talking to Mello IS the landing, with a compact
 * "company standing" strip on top and the full Mission one click away. Reuses the EXISTING Mello agent
 * (useChatStream → /api/mello/*) and chat components — not a new brain. Shown as "Home" in CompanyShell.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useChatStream } from '@/components/mello/useChatStream'
import { ChatMessage } from '@/components/mello/ChatMessage'
import { ChatInput } from '@/components/mello/ChatInput'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', ORANGE = '#e02f06', PAPER = '#fbf7ef'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

type Journey = { brandName?: string; stageLabel?: string; revenue?: { total: number; currency: string | null; organicShare: number } | null }

const CHIPS = ['What should I do today?', 'Make an Instagram ad for my bestseller', 'Fix my product SEO', 'Who are my competitors?']

export default function HomePage() {
  const [convId, setConvId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [journey, setJourney] = useState<Journey | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, streaming, sendMessage, setHistory } = useChatStream({ onTitle: () => {} })

  useEffect(() => { (async () => { try { const r = await fetch('/api/mello/journey'); const j = await r.json(); if (r.ok) setJourney(j) } catch { /* optional */ } })() }, [])
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages])

  const ensureConv = useCallback(async (): Promise<string | null> => {
    if (convId) return convId
    try { const r = await fetch('/api/mello/conversations', { method: 'POST' }); const d = await r.json(); if (d?.conversation?.id) { setConvId(d.conversation.id); return d.conversation.id } } catch { /* ignore */ }
    return null
  }, [convId])

  const submit = async (text: string) => {
    const t = text.trim(); if (!t || streaming) return
    const id = await ensureConv(); if (!id) return
    setInput(''); sendMessage(id, t)
  }
  const onFeedback = async (messageId: string, helpful: boolean) => {
    setHistory(messages.map((m) => m.id === messageId ? { ...m, is_helpful: helpful } : m))
    try { await fetch(`/api/mello/messages/${messageId}/feedback`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_helpful: helpful }) }) } catch { /* ignore */ }
  }

  const started = messages.length > 0
  const lastIndex = messages.length - 1
  const brand = journey?.brandName || 'your company'
  const cur = journey?.revenue?.currency || '$'
  const fmt = (n: number) => `${cur === 'USD' ? '$' : cur ? cur + ' ' : '$'}${Math.round(n).toLocaleString()}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#fff', fontFamily: SANS, color: INK }}>
      {/* company standing strip */}
      {journey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 26px', borderBottom: `1px solid ${LINE}`, background: PAPER, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.5, color: SUB }}><b style={{ color: INK }}>{brand[0].toUpperCase() + brand.slice(1)}</b>{journey.stageLabel ? ` · ${journey.stageLabel}` : ''}</div>
          {journey.revenue && <>
            <span style={{ width: 1, height: 16, background: LINE }} />
            <div style={{ fontSize: 13.5, color: SUB }}>Revenue <b style={{ color: INK }}>{fmt(journey.revenue.total)}</b></div>
            <div style={{ fontSize: 13.5, color: SUB }}>Organic <b style={{ color: INK }}>{Math.round((journey.revenue.organicShare || 0) * 100)}%</b></div>
          </>}
          <Link href="/mission" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: ORANGE, textDecoration: 'none' }}>Open full mission →</Link>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 22px' }}>
          {!started ? (
            <div style={{ textAlign: 'center', paddingTop: 'clamp(40px,9vh,110px)' }}>
              <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(30px,5vw,46px)', fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 10px' }}>What should we work on?</h1>
              <p style={{ color: SUB, fontSize: 16, margin: '0 0 26px' }}>Ask Mello anything — it runs your marketing company and reports back.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                {CHIPS.map((c) => <button key={c} onClick={() => submit(c)} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '10px 16px', fontSize: 13.5, color: '#43403a', cursor: 'pointer', fontFamily: SANS }}>{c}</button>)}
              </div>
            </div>
          ) : (
            <div style={{ paddingTop: 20 }}>
              {messages.map((m, i) => (
                <ChatMessage key={m.id || i} msg={m} onWidgetAnswer={(label) => submit(label)} onFeedback={onFeedback} widgetLocked={i !== lastIndex || streaming} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${LINE}`, background: '#fff', padding: '14px 22px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <ChatInput value={input} onChange={setInput} onSend={() => submit(input)} disabled={streaming} onOpenLibrary={() => { }} placeholder="Message Mello — “make an ad”, “fix my SEO”, “how are we doing?”" />
        </div>
      </div>
    </div>
  )
}
