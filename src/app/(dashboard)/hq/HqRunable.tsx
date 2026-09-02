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
const XLogo = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round" style={{ display: 'block' }}><path d="M5 5l14 14M19 5L5 19" /></svg>
const LinkedIn = () => <svg width="16" height="16" viewBox="0 0 24 24" style={{ display: 'block' }}><rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="#0A66C2" /><path fill="#fff" d="M7 9.6h2.2V17H7zM8.1 6.2a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zM11 9.6h2.1v1c.3-.6 1.1-1.3 2.4-1.3 2 0 2.5 1.3 2.5 3.2V17h-2.2v-3.8c0-.9-.3-1.6-1.2-1.6s-1.4.6-1.4 1.6V17H11z" /></svg>

// monoline icon wrapper (black stroke, matches Runable's non-brand icons)
const Ic = ({ children }: { children: React.ReactNode }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>{children}</svg>

type Tile = { label: string; sub: string; href: string; icon: React.ReactNode; seed?: string }
type Cat = { name: string; tiles: Tile[] }
const spark = <Ic><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /><path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7z" /></Ic>
const lines = <Ic><path d="M4 6h16M4 12h10M4 18h7" /></Ic>
const pages = <Ic><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></Ic>
const magnifier = <Ic><circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" /></Ic>

const GROW_CATS: Cat[] = [
  { name: 'Running Ads', tiles: [
    { label: 'Meta Ads', sub: 'Spy, clone & launch', href: '/ads-workspace', icon: <Meta /> },
    { label: 'Google Ads', sub: 'Search & Shopping', href: '/m4', icon: <Google /> },
    { label: 'TikTok Ads', sub: 'Short-form that converts', href: '/ads-workspace', icon: <TikTok /> },
  ] },
  { name: 'Social Media', tiles: [
    { label: 'Instagram', sub: 'Create a post', href: '/ads-workspace', seed: 'Make an Instagram post for my product', icon: <Insta /> },
    { label: 'TikTok', sub: 'Create a post', href: '/ads-workspace', seed: 'Make a TikTok post for my product', icon: <TikTok /> },
    { label: 'X / Twitter', sub: 'Write a post', href: '/ads-workspace', seed: 'Write an X post for my product', icon: <XLogo /> },
    { label: 'LinkedIn', sub: 'Write a post', href: '/ads-workspace', seed: 'Write a LinkedIn post for my brand', icon: <LinkedIn /> },
  ] },
  { name: 'Intel & Listening', tiles: [
    { label: 'Spy a Competitor', sub: 'Track their live ads', href: '/ads-workspace/competitors', icon: <Ic><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Ic> },
    { label: 'Discover', sub: 'Winning ads to remake', href: '/discovery', icon: <Ic><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5l-2 4.5-4.5 2 2-4.5z" /></Ic> },
    { label: 'Reports', sub: 'Spend, ROAS & results', href: '/reports', icon: <Ic><path d="M5 19V9M12 19V5M19 19v-7" /></Ic> },
  ] },
  { name: 'Organic Growth', tiles: [
    { label: 'SEO Audit', sub: 'Crawl & fix every page', href: '/mission/seo', icon: magnifier },
    { label: 'AI Visibility · AEO', sub: 'Get cited by ChatGPT', href: '/mission/geo', icon: spark },
    { label: 'Blog Content', sub: 'Buyer-intent, auto-published', href: '/mission/blog', icon: lines },
    { label: 'Pages at Scale', sub: 'Programmatic SEO', href: '/mission/programmatic', icon: pages },
  ] },
  { name: 'Storefront', tiles: [
    { label: 'CRO Audit', sub: 'Fix conversion leaks', href: '/mission/cro', icon: <Ic><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></Ic> },
    { label: 'Fix Catalog', sub: 'Product SEO & schema', href: '/mission/catalog', icon: <Ic><path d="M4 7h16v13H4z" /><path d="M9 7V4h6v3" /></Ic> },
    { label: 'Launch Ads', sub: 'Audience, budget & go live', href: '/m4', icon: <Ic><path d="M13 3c3 1 5 4 5 8l-3 3h-4L8 11c0-4 2-7 5-8z" /><path d="M9 18c-1 1-1 3-1 3s2 0 3-1" /><circle cx="13" cy="9" r="1.4" /></Ic> },
  ] },
]
const BUILD_CATS: Cat[] = [
  { name: 'Ads', tiles: [
    { label: 'Ad Image', sub: 'Static from your winning DNA', href: '/ads-workspace', seed: 'Make a scroll-stopping image ad for my bestseller', icon: <Ic><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M4 17l5-5 4 4 3-3 4 4" /></Ic> },
    { label: 'Ad Video', sub: 'Short-form, native audio', href: '/ads-workspace', seed: 'Make a short-form video ad for my bestseller', icon: <Ic><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></Ic> },
    { label: 'UGC Ad', sub: '"Real person" testimonial', href: '/ads-workspace', seed: 'Make a UGC testimonial-style ad for my product', icon: <Ic><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M10 18h4" /></Ic> },
    { label: 'Carousel', sub: 'Multi-frame for social', href: '/ads-workspace', seed: 'Make a multi-frame carousel ad for my product', icon: <Ic><rect x="4" y="5" width="7" height="14" rx="2" /><rect x="13" y="5" width="7" height="14" rx="2" /></Ic> },
  ] },
  { name: 'Content', tiles: [
    { label: 'Blog Post', sub: 'Ranks + one-click publish', href: '/mission/blog', icon: lines },
    { label: 'Pages at Scale', sub: 'Programmatic SEO', href: '/mission/programmatic', icon: pages },
  ] },
]

export default function HqRunable() {
  const [convId, setConvId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'grow' | 'build'>('grow')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
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
  const cats = mode === 'grow' ? GROW_CATS : BUILD_CATS

  // ── task setup popup (Runable-style) ──────────────────────────────────────
  const [task, setTask] = useState<Tile | null>(null)
  const [tInstr, setTInstr] = useState('')
  const [tFmts, setTFmts] = useState<string[]>([])
  const [tFreq, setTFreq] = useState('One-off')
  const [tTime, setTTime] = useState('9:00 AM')
  const [tPublish, setTPublish] = useState<'direct' | 'draft'>('draft')
  const [tBudget, setTBudget] = useState('20')
  const [tCount, setTCount] = useState('3')
  const [tDeliver, setTDeliver] = useState<'in_app' | 'email'>('in_app')
  const [tUrl, setTUrl] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  type Kind = 'social' | 'ads' | 'adcreative' | 'content' | 'analysis'
  const kindOf = (t: Tile): Kind => {
    const l = t.label.toLowerCase()
    if (['instagram', 'tiktok', 'x / twitter', 'linkedin'].includes(l)) return 'social'
    if (['meta ads', 'google ads', 'tiktok ads', 'launch ads'].includes(l)) return 'ads'
    if (['ad image', 'ad video', 'ugc ad', 'carousel'].includes(l)) return 'adcreative'
    if (l.includes('blog') || l.includes('pages at scale')) return 'content'
    return 'analysis'
  }
  const fmtOptions = (t: Tile): string[] => {
    const l = t.label.toLowerCase()
    if (l === 'instagram') return ['Image', 'Reel', 'Carousel', 'Story']
    if (l === 'tiktok') return ['Video', 'Photo', 'Story']
    if (l === 'x / twitter' || l === 'linkedin') return ['Text', 'Image']
    return ['Image', 'Video', 'Carousel', 'UGC']
  }
  const connectHref = (t: Tile): string => (t.label.toLowerCase().startsWith('meta') ? '/connect-meta' : '/settings')
  const openTask = (t: Tile) => {
    setTask(t)
    setTInstr(t.seed || `Create ${t.label.toLowerCase()} for ${brand}. Learn from what has worked before, keep it on-brand, and bring it to me to approve before it ships.`)
    setTFmts([]); setTFreq('One-off'); setTTime('9:00 AM'); setTPublish('draft'); setTBudget('20'); setTCount('3'); setTDeliver('in_app')
    let url = ''
    try { const m = document.cookie.match(/(?:^|; )sf_scan_domain=([^;]+)/); if (m) url = `https://${decodeURIComponent(m[1]).replace(/^https?:\/\//, '')}` } catch { /* ignore */ }
    setTUrl(url)
  }
  const toCron = (freq: string, timeLabel: string): string => {
    const m = timeLabel.match(/(\d+):(\d+)\s*(AM|PM)/i)
    let h = m ? parseInt(m[1], 10) % 12 : 9
    if (m && /pm/i.test(m[3])) h += 12
    const min = m ? parseInt(m[2], 10) : 0
    let total = h * 60 + min + new Date().getTimezoneOffset()   // local → UTC minutes
    total = ((total % 1440) + 1440) % 1440
    const uh = Math.floor(total / 60), um = total % 60
    if (freq === 'Daily') return `${um} ${uh} * * *`
    if (freq === 'Weekly') return `${um} ${uh} * * 1`
    if (freq === 'Monthly') return `${um} ${uh} 1 * *`
    return ''
  }
  const runTask = async () => {
    if (!task) return
    const kind = kindOf(task)
    const parts = [tInstr.trim()]
    if ((kind === 'social' || kind === 'adcreative') && tFmts.length) parts.push(`Formats: ${tFmts.join(', ')}.`)
    if (kind === 'ads' && tBudget) parts.push(`Daily budget: $${tBudget}.`)
    if (kind === 'content') parts.push(`Produce ${tCount} this run.`)
    if ((kind === 'social' || kind === 'ads' || kind === 'content') && tUrl.trim()) parts.push(`Send visitors to ${tUrl.trim()}.`)
    if (kind === 'analysis') parts.push(tDeliver === 'email' ? 'Email me the results.' : 'Post the results to my Mello feed.')
    else parts.push(tPublish === 'direct' ? (kind === 'ads' ? 'Launch it once I approve.' : 'Publish it once I approve.') : 'Draft it and notify me first.')
    const prompt = parts.filter(Boolean).join(' ')
    if (tFreq !== 'One-off') {
      try {
        await fetch('/api/mello/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: task.label, prompt, schedule_cron: toCron(tFreq, tTime), schedule_label: `${tFreq} · ${tTime}`, delivery_channel: tDeliver }) })
        setToast(`Scheduled · ${task.label} · ${tFreq} at ${tTime}`); setTimeout(() => setToast(null), 4200)
      } catch { setToast('Could not schedule — try again'); setTimeout(() => setToast(null), 4200) }
      setTask(null); return
    }
    // One-off: run it right here in the chat — Mello picks up the brief in this conversation
    // (Runable-style), rather than bouncing the user out to the tool's page.
    setTask(null); submit(prompt)
  }
  const selStyle: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, color: INK, background: '#fff', outline: 'none', fontFamily: 'inherit' }

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
              {/* task launcher — categorised, collapsible (Runable-style) */}
              <div style={{ marginTop: 20 }}>
                {cats.map((cat) => {
                  const off = !!collapsed[cat.name]
                  return (
                    <div key={cat.name} style={{ marginTop: 20 }}>
                      <button onClick={() => setCollapsed((c) => ({ ...c, [cat.name]: !c[cat.name] }))} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 0, padding: '2px 2px 12px', cursor: 'pointer' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{cat.name}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: off ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      {!off && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
                          {cat.tiles.map((t) => (
                            <button key={t.label} type="button" onClick={() => openTask(t)} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: 14, textAlign: 'left', width: '100%', cursor: 'pointer', font: 'inherit', color: INK, boxShadow: '0 1px 2px rgba(20,18,15,.05)' }}>
                              <span style={{ width: 30, height: 30, borderRadius: 8, background: INSET, display: 'grid', placeItems: 'center', marginBottom: 10, color: '#111' }}>{t.icon}</span>
                              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                              <span style={{ display: 'block', fontSize: 11.5, color: FAINT, marginTop: 2 }}>{t.sub}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
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

      {/* ── task setup popup (varies by task kind) ── */}
      {task && (() => {
        const kind = kindOf(task)
        const plat = task.label.replace(/ Ads$/, '')
        return (
          <div onClick={(e) => { if (e.target === e.currentTarget) setTask(null) }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(20,18,15,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#fff', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', borderRadius: 20, padding: 26, boxShadow: '0 40px 100px -30px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: INSET, display: 'grid', placeItems: 'center', color: '#111' }}>{task.icon}</span>
                  <div><div style={{ fontFamily: SERIF, fontSize: 22, letterSpacing: '-.01em' }}>{task.label}</div><div style={{ fontSize: 12.5, color: SUB }}>{task.sub}</div></div>
                </div>
                <button onClick={() => setTask(null)} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 24, color: SUB, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              {(kind === 'social' || kind === 'ads') && (
                (kind === 'ads' && plat.toLowerCase() === 'meta' && metaOn) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eef8f0', border: '1px solid #cdefd6', borderRadius: 12, padding: '11px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#1a7f3c' }}>
                    <span>✓</span> {plat} account connected — ads run in your account
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: INSET, border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 14px', marginBottom: 16, fontSize: 13, color: SUB }}>
                    <span>Connect {plat} so Mello can {kind === 'ads' ? 'run ads in your own ad account' : 'post as you'}</span>
                    <Link href={`${connectHref(task)}?next=/hq`} style={{ border: `1px solid ${INK}`, color: INK, borderRadius: 999, padding: '7px 15px', fontWeight: 600, fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap' }}>Connect {plat}</Link>
                  </div>
                )
              )}

              <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 7 }}>Instructions</div>
              <textarea value={tInstr} onChange={(e) => setTInstr(e.target.value)} rows={4} style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', fontSize: 14.5, lineHeight: 1.5, color: INK, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />

              {(kind === 'social' || kind === 'ads' || kind === 'content') && (<>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, margin: '16px 0 7px' }}>Send visitors to</div>
                <input value={tUrl} onChange={(e) => setTUrl(e.target.value)} placeholder="https://yourstore.com" style={{ ...selStyle, padding: '11px 14px' }} />
              </>)}

              {(kind === 'social' || kind === 'adcreative') && (<>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, margin: '16px 0 7px' }}>What to create</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {fmtOptions(task).map((f) => {
                    const on = tFmts.includes(f)
                    return <button key={f} type="button" onClick={() => setTFmts((x) => on ? x.filter((y) => y !== f) : [...x, f])} style={{ display: 'flex', alignItems: 'center', gap: 9, border: `1px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 10, padding: '11px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}><span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${on ? '#fff' : LINE}`, display: 'grid', placeItems: 'center', fontSize: 10 }}>{on ? '✓' : ''}</span>{f}</button>
                  })}
                </div>
              </>)}

              {kind === 'ads' && (<>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '16px 0 8px' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>Daily budget</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>${tBudget}<span style={{ color: SUB, fontWeight: 500, fontSize: 12.5 }}> / day</span></span>
                </div>
                <input type="range" min={10} max={1000} step={5} value={tBudget} onChange={(e) => setTBudget(e.target.value)} style={{ width: '100%', accentColor: ORANGE }} />
                <div style={{ fontSize: 12, color: FAINT, marginTop: 5 }}>Spends in your connected ad account · you approve before it goes live</div>
              </>)}

              {kind === 'content' && (<>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, margin: '16px 0 7px' }}>How many</div>
                <select value={tCount} onChange={(e) => setTCount(e.target.value)} style={selStyle}>{['1', '3', '5', '10'].map((o) => <option key={o} value={o}>{o} {task.label.toLowerCase().includes('page') ? 'pages' : 'posts'}</option>)}</select>
              </>)}

              {kind !== 'ads' && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 7 }}>Frequency</div><select value={tFreq} onChange={(e) => setTFreq(e.target.value)} style={selStyle}>{['One-off', 'Daily', 'Weekly', 'Monthly'].map((o) => <option key={o}>{o}</option>)}</select></div>
                <div><div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 7 }}>Time</div><select value={tTime} onChange={(e) => setTTime(e.target.value)} disabled={tFreq === 'One-off'} style={{ ...selStyle, opacity: tFreq === 'One-off' ? .5 : 1 }}>{['7:00 AM', '9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM'].map((o) => <option key={o}>{o}</option>)}</select></div>
              </div>)}

              {kind === 'analysis' ? (<>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, margin: '16px 0 7px' }}>Deliver results to</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([['in_app', 'Show in Mello'], ['email', 'Email me']] as const).map(([v, l]) => {
                    const on = tDeliver === v
                    return <button key={v} type="button" onClick={() => setTDeliver(v)} style={{ border: `1px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 10, padding: '11px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>{l}</button>
                  })}
                </div>
              </>) : kind === 'ads' ? null : (<>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, margin: '16px 0 7px' }}>Publishing</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([['direct', 'Publish once approved'], ['draft', 'Draft & notify me']] as const).map(([v, l]) => {
                    const on = tPublish === v
                    return <button key={v} type="button" onClick={() => setTPublish(v)} style={{ border: `1px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : INK, borderRadius: 10, padding: '11px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>{l}</button>
                  })}
                </div>
              </>)}

              <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                <button onClick={() => setTask(null)} style={{ flex: 1, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: 13, fontWeight: 600, fontSize: 14, color: INK, cursor: 'pointer' }}>Cancel</button>
                <button onClick={runTask} style={{ flex: 2, background: ORANGE, color: '#fff', border: 0, borderRadius: 999, padding: 13, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{kind === 'ads' ? `Launch ads · $${tBudget}/day →` : tFreq === 'One-off' ? 'Start this task →' : `Schedule · ${tFreq} →`}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {toast && (
        <div style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 120, background: INK, color: '#fff', padding: '12px 20px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: '0 16px 40px -12px rgba(0,0,0,.4)' }}>{toast}</div>
      )}
    </div>
  )
}
