'use client'
/**
 * HqRunable — the Runable-style Home (behind ?hq=v2). Renders INSIDE CompanyShell (which supplies the left
 * sidebar), so this component is the centre column + a right "assets" rail. Reuses the existing Mello agent
 * (useChatStream → /api/mello/*) — the composer talks to Mello, the task tiles open the real tools. Grounded
 * data comes from /api/mello/journey (brand, connections) and useCredits (plan). Nothing here is a new brain.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useChatStream } from '@/components/mello/useChatStream'
import { ChatMessage } from '@/components/mello/ChatMessage'
import { ChatInput } from '@/components/mello/ChatInput'
import { useCredits } from '@/components/credits/CreditCounter'

const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a', LINE = 'rgba(20,18,15,.10)', LINE2 = 'rgba(20,18,15,.05)'
const ORANGE = '#e02f06', WASH = '#fdeee9', INSET = '#f7f6f4', GOOD = '#12a150'
const SERIF = '"Hedvig Letters Serif", Georgia, "Times New Roman", serif'

/* ── real brand logos ── */
const Meta = () => <svg width="17" height="17" viewBox="0 0 24 24" style={{ display: 'block' }}><path fill="none" stroke="#0866FF" strokeWidth="2.1" strokeLinecap="round" d="M6.8 8C4.9 8 3.6 9.8 3.6 12s1.3 4 3.2 4c1.6 0 2.6-1.3 3.9-3.3l1.3-2 1.3 2c1.3 2 2.3 3.3 3.9 3.3 1.9 0 3.2-1.8 3.2-4s-1.3-4-3.2-4c-1.6 0-2.6 1.3-3.9 3.3l-1.3 2-1.3-2C9.4 9.3 8.4 8 6.8 8z" /></svg>
const Google = () => <svg width="16" height="16" viewBox="0 0 24 24" style={{ display: 'block' }}><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" /><path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.8 19.9 8.1 22 12 22z" /><path fill="#FBBC05" d="M6.4 13.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.5H3.1C2.4 8.9 2 10.4 2 12s.4 3.1 1.1 4.5l3.3-2.6z" /><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.1 14.7 2 12 2 8.1 2 4.8 4.1 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" /></svg>
const TikTok = () => <svg width="16" height="16" viewBox="0 0 24 24" style={{ display: 'block' }}><path fill="#111" d="M16.7 5.8c-1-.7-1.6-1.7-1.8-2.9h-2.7v11.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5 1.1-2.5 2.5-2.5c.3 0 .5 0 .8.1V9.2c-.3 0-.5-.1-.8-.1C6.9 9.1 4.7 11.3 4.7 14s2.2 4.9 4.9 4.9 4.9-2.2 4.9-4.9V8.4c1 .8 2.2 1.2 3.5 1.2V6.9c-.5 0-1-.1-1.5-.4z" /></svg>
const Shopify = () => <svg width="16" height="16" viewBox="0 0 24 24" style={{ display: 'block' }}><path fill="#95BF47" fillRule="evenodd" d="M7 7V6a5 5 0 0110 0v1h1.7l1 12.4a1 1 0 01-1 1.1H4.3a1 1 0 01-1-1.1L4.3 7H7zm2 0h6V6a3 3 0 00-6 0v1z" /></svg>
const Insta = () => <svg width="16" height="16" viewBox="0 0 24 24" style={{ display: 'block' }}><defs><linearGradient id="hqig" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#FEDA75" /><stop offset=".3" stopColor="#FA7E1E" /><stop offset=".6" stopColor="#D62976" /><stop offset="1" stopColor="#4F5BD5" /></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="url(#hqig)" strokeWidth="2" /><circle cx="12" cy="12" r="4.2" fill="none" stroke="url(#hqig)" strokeWidth="2" /><circle cx="17.2" cy="6.8" r="1.25" fill="url(#hqig)" /></svg>

// monoline icon wrapper (black stroke, matches Runable's non-brand icons)
const Ic = ({ children }: { children: React.ReactNode }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>{children}</svg>

type Tile = { label: string; sub: string; href: string; icon: React.ReactNode }
const GROW: Tile[] = [
  { label: 'Meta Ads', sub: 'Spy, clone & launch', href: '/ads-workspace', icon: <Meta /> },
  { label: 'Google Ads', sub: 'Search & Shopping', href: '/m4', icon: <Google /> },
  { label: 'TikTok Ads', sub: 'Short-form that converts', href: '/ads-workspace', icon: <TikTok /> },
  { label: 'SEO Audit', sub: 'Crawl & fix every page', href: '/mission/seo', icon: <Ic><circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" /></Ic> },
  { label: 'AI Visibility', sub: 'Get cited by ChatGPT', href: '/mission/geo', icon: <Ic><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /><path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7z" /></Ic> },
  { label: 'Blog Content', sub: 'Buyer-intent, auto-published', href: '/mission/blog', icon: <Ic><path d="M4 6h16M4 12h10M4 18h7" /></Ic> },
  { label: 'Spy a Competitor', sub: 'Track their live ads', href: '/ads-workspace/competitors', icon: <Ic><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Ic> },
  { label: 'CRO Audit', sub: 'Fix storefront leaks', href: '/mission/cro', icon: <Ic><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></Ic> },
  { label: 'Launch Ads', sub: 'Audience, budget & go live', href: '/m4', icon: <Ic><path d="M13 3c3 1 5 4 5 8l-3 3h-4L8 11c0-4 2-7 5-8z" /><path d="M9 18c-1 1-1 3-1 3s2 0 3-1" /><circle cx="13" cy="9" r="1.4" /></Ic> },
]
const BUILD: Tile[] = [
  { label: 'Ad Image', sub: 'Static from your winning DNA', href: '/ads-workspace', icon: <Ic><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M4 17l5-5 4 4 3-3 4 4" /></Ic> },
  { label: 'Ad Video', sub: 'Short-form, native audio', href: '/ads-workspace', icon: <Ic><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></Ic> },
  { label: 'UGC Ad', sub: '"Real person" testimonial', href: '/ads-workspace', icon: <Ic><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M10 18h4" /></Ic> },
  { label: 'Blog Post', sub: 'Ranks + one-click publish', href: '/mission/blog', icon: <Ic><path d="M4 6h16M4 12h10M4 18h7" /></Ic> },
  { label: 'Carousel', sub: 'Multi-frame for social', href: '/ads-workspace', icon: <Ic><rect x="4" y="5" width="7" height="14" rx="2" /><rect x="13" y="5" width="7" height="14" rx="2" /></Ic> },
  { label: 'Pages at Scale', sub: 'Programmatic SEO', href: '/mission/programmatic', icon: <Ic><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></Ic> },
]

export default function HqRunable() {
  const [convId, setConvId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'grow' | 'build'>('grow')
  const [journey, setJourney] = useState<any>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const credits = useCredits()
  const { messages, streaming, sendMessage, setHistory } = useChatStream({ onTitle: () => {} })

  // load Runable's serif once
  useEffect(() => {
    if (document.getElementById('hedvig-font')) return
    const l = document.createElement('link'); l.id = 'hedvig-font'; l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Hedvig+Letters+Serif:opsz@12..24&display=swap'
    document.head.appendChild(l)
  }, [])
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
  const brand = (journey?.brandName || 'your store') as string
  const connect = (journey?.stages || []).find((s: any) => s.key === 'connect')?.tasks || []
  const shopifyOn = !!connect.find((t: any) => t.key === 'shopify')?.done || !!journey?.revenue
  const metaOn = !!connect.find((t: any) => t.key === 'meta')?.done
  const tiles = mode === 'grow' ? GROW : BUILD

  return (
    <div style={{ display: 'flex', height: '100dvh', background: '#fff', color: INK }}>
      {/* ── centre ── */}
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 26px', borderBottom: `1px solid ${LINE2}` }}>
          <div style={{ fontSize: 13, color: SUB, fontWeight: 500 }}>Hire the team · run it from here</div>
          <div style={{ display: 'flex', background: INSET, border: `1px solid ${LINE}`, borderRadius: 999, padding: 5, gap: 4 }}>
            {(['grow', 'build'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{ border: 0, background: mode === m ? '#fff' : 'transparent', color: mode === m ? INK : SUB, fontWeight: mode === m ? 700 : 600, fontSize: 15, padding: '9px 30px', borderRadius: 999, cursor: 'pointer', boxShadow: mode === m ? `0 1px 3px rgba(20,18,15,.16), 0 0 0 1px ${LINE}` : 'none', textTransform: 'capitalize' }}>{m}</button>
            ))}
          </div>
          <Link href="/upgrade" style={{ border: `1px solid ${ORANGE}`, color: ORANGE, fontWeight: 600, fontSize: 13, padding: '7px 16px', borderRadius: 999, textDecoration: 'none' }}>⚡ Upgrade</Link>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
          {!started ? (
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '52px 24px 40px' }}>
              <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(31px,3.6vw,43px)', textAlign: 'center', letterSpacing: '-.015em', margin: 0 }}>
                {mode === 'grow' ? <>Let&rsquo;s grow <span style={{ color: SUB }}>your store.</span></> : <>What needs <span style={{ color: SUB }}>building?</span></>}
              </h1>
              {/* composer */}
              <div style={{ margin: '24px auto 0', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: `0 1px 2px rgba(20,18,15,.05),0 14px 40px -26px rgba(20,18,15,.4)`, padding: '16px 16px 12px' }}>
                <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) } }} placeholder={mode === 'grow' ? 'Increase my customer reach…' : 'Describe what you want the team to build…'} rows={2} style={{ width: '100%', border: 0, outline: 0, resize: 'none', background: 'transparent', fontSize: 16, color: INK, fontFamily: 'inherit', lineHeight: 1.5 }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <span style={{ fontSize: 12.5, color: FAINT }}>Ask Mello, or start a task below</span>
                  <button onClick={() => submit(input)} disabled={streaming || !input.trim()} aria-label="Send" style={{ width: 36, height: 36, borderRadius: 10, border: 0, background: ORANGE, color: '#fff', cursor: input.trim() ? 'pointer' : 'default', opacity: input.trim() ? 1 : .5, fontSize: 17, display: 'grid', placeItems: 'center' }}>→</button>
                </div>
              </div>
              {/* task launcher */}
              <div style={{ marginTop: 26 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: FAINT, marginBottom: 12 }}>{mode === 'grow' ? 'Your marketing team' : 'Make with the team'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
                  {tiles.map((t) => (
                    <Link key={t.label} href={input.trim() && t.href === '/ads-workspace' ? `/ads-workspace?idea=${encodeURIComponent(input.trim().slice(0, 400))}` : t.href} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: 14, textDecoration: 'none', color: INK, boxShadow: '0 1px 2px rgba(20,18,15,.05)' }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: INSET, display: 'grid', placeItems: 'center', marginBottom: 10, color: INK }}>{t.icon}</span>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: FAINT, marginTop: 2 }}>{t.sub}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 22px' }}>
              {messages.map((m, i) => (
                <ChatMessage key={m.id || i} msg={m} onWidgetAnswer={(label) => submit(label)} onFeedback={onFeedback} widgetLocked={i !== lastIndex || streaming} />
              ))}
            </div>
          )}
        </div>

        {started && (
          <div style={{ borderTop: `1px solid ${LINE}`, background: '#fff', padding: '14px 22px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <ChatInput value={input} onChange={setInput} onSend={() => submit(input)} disabled={streaming} onOpenLibrary={() => { }} placeholder="Message Mello…" />
            </div>
          </div>
        )}
      </section>

      {/* ── right rail ── */}
      <aside style={{ width: 312, flex: 'none', borderLeft: `1px solid ${LINE}`, padding: '18px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 15 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Your store</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: INSET, border: `1px solid ${LINE}`, borderRadius: 9, padding: '9px 11px', fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>🔗 {brand}</div>
        </div>

        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 15 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Connections</div>
          <div style={{ marginTop: 8 }}>
            {[
              { name: 'Shopify', icon: <Shopify />, on: shopifyOn, href: '/connect/shopify' },
              { name: 'Meta Ads', icon: <Meta />, on: metaOn, href: '/connect-meta' },
              { name: 'Google', icon: <Google />, on: false, href: '/mission/seo' },
              { name: 'Instagram', icon: <Insta />, on: false, href: '/connect/shopify' },
              { name: 'TikTok', icon: <TikTok />, on: false, href: '/connect/shopify' },
            ].map((c, i) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: i ? `1px solid ${LINE2}` : 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 500, color: '#3a3833' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: INSET, display: 'grid', placeItems: 'center' }}>{c.icon}</span>{c.name}
                </span>
                {c.on
                  ? <span style={{ fontSize: 11.5, fontWeight: 600, color: GOOD }}>✓ Connected</span>
                  : <Link href={c.href} style={{ fontSize: 11.5, fontWeight: 600, color: ORANGE, textDecoration: 'none', border: `1px solid ${WASH}`, borderRadius: 999, padding: '3px 11px' }}>Connect</Link>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>Plan <Link href="/billing" style={{ fontSize: 12, color: ORANGE, textDecoration: 'none', fontWeight: 600 }}>Manage</Link></div>
          <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}><b style={{ color: INK, textTransform: 'capitalize' }}>{credits.plan || 'Free'}</b> · <b style={{ color: INK }}>{credits.loading ? '…' : credits.balance.toLocaleString()}</b> credits</div>
        </div>

        <Link href="/mission" style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 15, textDecoration: 'none', color: INK }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>This morning</div>
          <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.55, marginTop: 9 }}>Open your mission to see what Mello shipped and what&rsquo;s waiting for your approval. <span style={{ color: ORANGE, fontWeight: 600 }}>Open →</span></div>
        </Link>
      </aside>
    </div>
  )
}
