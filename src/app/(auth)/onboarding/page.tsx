'use client'
/**
 * THE INTERVIEW — onboarding rebuilt as the first meeting between a founder and their AI marketer.
 * (The old 5-step wizard is preserved at src/legacy/old-onboarding-wizard.tsx.bak.)
 *
 * Beats: welcome → homework (real crawl, live log) → smart guess ("correct me if I'm wrong") →
 *        markets + competitors (country-aware) → the questions only a human can answer (each with
 *        its WHY) → integrations (honest SOON while the Meta app is in review) → the employment
 *        agreement (countersigned) → "I'm starting work now" night screen → /brief (first standup).
 *
 * Two rules from the design room, enforced in code:
 *  · never ask what we can infer — the site is read for real (detect-product + interview/analyze)
 *    and presented as observations with a tiny [fix], not questions
 *  · no fake ticks — every work-log line corresponds to a real request resolving
 * Everything learned lands in mello_memory (the notebook) — the same table the Mello agent injects
 * into every conversation, so the standup can cite day-one answers forever.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MelloFace, { type MelloState } from '@/components/MelloFace'
import { ChannelLogo } from '@/components/brand/logos'
import { planEntitlements } from '@/lib/plans'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', FOREST = '#141d15', LIME = '#ff5a2c'
const GREEN = '#ef4a1e', SELBG = '#f4fbe6', SELBORDER = '#a8cf6f', PAPER = '#fffdf4', PAPERLINE = '#efe9c8'

type Phase = 'welcome' | 'homework' | 'guess' | 'competitors' | 'questions' | 'culture' | 'integrations' | 'offer' | 'night' | 'plan'
type Note = { kind: string; content: string }
type Comp = { pageId: string; name: string; avatar?: string | null; adCount?: number | null; country?: string | null }

const COUNTRIES = [
  ['PK', 'Pakistan'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'UAE'], ['SA', 'Saudi Arabia'],
  ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['IN', 'India'], ['FR', 'France'],
] as const

// Pull a Meta page id out of a Facebook Ad Library link (view_all_page_id=…) or a bare numeric id, so
// a founder can add any competitor by pasting the link — even one not yet in our index.
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  if (m) return m[1]
  if (/^\d{7,}$/.test(t)) return t
  return null
}

// The one Mello face, shared with the brief/rail/studio — the onboarding used to draw its own robot.
function Mello({ size = 54, state = 'awake' }: { size?: number; state?: MelloState }) {
  return <MelloFace size={size} state={state} />
}

// The team roster — the homepage promised "a marketing company", so the first thing you do after
// signing in is MEET them. Same six departments as the landing org chart, coming online one by one.
const TEAM: [string, string][] = [
  ['Research', 'Reads the market while you sleep'],
  ['Creative', 'Turns research into campaigns'],
  ['Media Buying', 'Finds winners. Scales them'],
  ['Growth', 'Email, SEO, funnels'],
  ['Finance', 'Tracks profit, not ROAS'],
  ['Customer', 'Answers every message'],
]
function TeamRoster() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 470, margin: '24px auto 0', textAlign: 'left' }}>
      {TEAM.map(([n, d], i) => (
        <div key={n} className="team-in" style={{ animationDelay: `${i * 0.08}s`, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: INK }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />{n}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.45 }}>{d}</div>
        </div>
      ))}
    </div>
  )
}

// Mello's own words → the serif register (voice.mello), same as the brief. Onboarding is Mello speaking.
const say: React.CSSProperties = { fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 31, fontWeight: 400, letterSpacing: '-.015em', lineHeight: 1.14, color: INK, textAlign: 'center', maxWidth: 540, margin: '0 auto' }
const sub: React.CSSProperties = { fontSize: 14, color: MUTED, textAlign: 'center', maxWidth: 420, margin: '10px auto 0', lineHeight: 1.6 }
const btnMain: React.CSSProperties = { background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }
const btnGhost: React.CSSProperties = { background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '12px 22px', fontSize: 13.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }
const chip = (on: boolean): React.CSSProperties => ({ border: `1.5px solid ${on ? '#ef4a1e' : LINE}`, background: on ? '#ef4a1e' : '#fff', color: on ? '#fff' : INK, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' })
const inputCss: React.CSSProperties = { border: `1.5px solid ${LINE}`, borderRadius: 12, padding: '11px 14px', fontSize: 14, fontFamily: 'inherit', color: INK, background: '#fff', outline: 'none', width: '100%' }
// Plan step
const planCard: React.CSSProperties = { position: 'relative', flex: '1 1 200px', minWidth: 200, maxWidth: 230, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 16, padding: '20px 18px' }
const planName: React.CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: '.02em', color: INK }
const planPrice: React.CSSProperties = { fontSize: 30, fontWeight: 850, letterSpacing: '-.03em', color: INK, marginTop: 4 }
const planPer: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: MUTED, marginLeft: 2 }
const planFeat: React.CSSProperties = { fontSize: 12.5, color: MUTED, lineHeight: 1.9, marginTop: 10 }
const planBadge: React.CSSProperties = { position: 'absolute', top: -10, left: 18, background: '#ef4a1e', color: '#fff', fontSize: 9, fontWeight: 800, letterSpacing: '.1em', borderRadius: 100, padding: '3px 9px' }

/**
 * BRAND PALETTE — clicking the field opens a searchable, keyboard-navigable dropdown of brands
 * (⌘K-style) so founders immediately see they should PICK a competitor — with paste-a-link manual
 * add. Reuses the onboarding's existing data: `suggested` (country-aware), live `results`, and
 * togglePick. Picked brands show as removable chips above the field. Multi-select; caps handled upstream.
 */
function BrandPalette({ q, setQ, suggested, results, picks, loading, onToggle, extractId }: {
  q: string; setQ: (v: string) => void; suggested: Comp[]; results: Comp[]; picks: Comp[]
  loading: boolean; onToggle: (c: Comp) => void; extractId: (s: string) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pickedIds = new Set(picks.map(p => p.pageId))
  const typing = q.trim().length > 0
  const sugg = suggested.filter(s => !pickedIds.has(s.pageId)).slice(0, 7)
  const res = typing ? results.filter(r => !pickedIds.has(r.pageId)).slice(0, 6) : []
  const manualId = extractId(q)
  const manual: Comp | null = manualId && !pickedIds.has(manualId) && !res.some(r => r.pageId === manualId)
    ? { pageId: manualId, name: `Facebook page ${manualId}` } : null

  const groups = (typing
    ? [{ label: 'Search results', items: res }]
    : [{ label: loading ? 'Scanning my index…' : 'Recognize any of these?', items: sugg }]
  ).filter(g => g.items.length)
  if (manual) groups.push({ label: 'Add manually', items: [manual] })
  const flat: Comp[] = groups.flatMap(g => g.items)

  useEffect(() => { setSel(0) }, [q, open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (c: Comp) => { onToggle(c); if (typing || (manual && c.pageId === manual.pageId)) setQ(''); inputRef.current?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel(i => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[sel]) pick(flat[sel]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const Row = ({ c, i }: { c: Comp; i: number }) => {
    const on = pickedIds.has(c.pageId); const active = i === sel
    return (
      <button onMouseDown={e => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setSel(i)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: active ? SELBG : 'transparent', border: `1.5px solid ${active ? SELBORDER : 'transparent'}`, borderRadius: 11, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
        {c.pageId === manual?.pageId
          ? <span style={{ width: 26, height: 26, borderRadius: 8, background: '#eef2ec', display: 'grid', placeItems: 'center', fontSize: 14 }}>📘</span>
          /* eslint-disable-next-line @next/next/no-img-element */
          : c.avatar ? <img src={c.avatar} alt="" style={{ width: 26, height: 26, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ width: 26, height: 26, borderRadius: 8, background: '#eef2ec', display: 'inline-block' }} />}
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: INK }}>{c.name}</span>
        {!!c.adCount && <span style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>{c.adCount} ads</span>}
        <span style={{ fontSize: 13, fontWeight: 900, color: on ? GREEN : '#c6cfc4' }}>{on ? '✓' : '+'}</span>
      </button>
    )
  }

  let run = 0
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      {picks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
          {picks.map(p => (
            <button key={p.pageId} onClick={() => onToggle(p)} title="Remove"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: SELBG, border: `1.5px solid ${SELBORDER}`, color: INK, borderRadius: 100, padding: '5px 11px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }}>
              {p.name} <span style={{ color: MUTED, fontWeight: 800 }}>✕</span>
            </button>
          ))}
        </div>
      )}
      <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder={picks.length ? 'Search another competitor by name…' : 'Search a competitor by name…'}
        style={{ ...inputCss }} />
      {/* #4 — the two paths, made distinct: search by name (above) vs paste a link (this, always
          visible). Pasting a Meta Ad Library URL adds them directly. */}
      {!manual && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🔗</span> Know them already? Paste their <b style={{ fontWeight: 700, color: INK }}>Meta Ad Library</b> link and I’ll add them.
        </div>
      )}
      {open && (groups.length > 0 || loading) && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 20px 44px -22px rgba(20,29,21,.5)', padding: 6, zIndex: 40, maxHeight: 320, overflowY: 'auto' }}>
          {groups.length === 0 && loading && <div style={{ fontSize: 12.5, color: MUTED, padding: '10px 12px' }}>Scanning my index…</div>}
          {groups.map(g => (
            <div key={g.label}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', color: MUTED, textTransform: 'uppercase', padding: '8px 10px 4px' }}>{g.label}</div>
              {g.items.map(c => <Row key={c.pageId} c={c} i={run++} />)}
            </div>
          ))}
          {typing && res.length === 0 && !manual && !loading && (
            <div style={{ fontSize: 12.5, color: MUTED, padding: '10px 12px' }}>No match. Paste their Meta Ad Library link to add them.</div>
          )}
          <div style={{ display: 'flex', gap: 14, padding: '8px 10px 4px', borderTop: `1px solid ${LINE}`, marginTop: 4, fontSize: 10.5, color: MUTED, fontWeight: 700 }}>
            <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function InterviewPage() {
  const router = useRouter()
  const supabase = createClient()
  const [phase, setPhase] = useState<Phase>('welcome')
  const [url, setUrl] = useState('')
  const [log, setLog] = useState<{ t: string; done: boolean }[]>([])
  const [detect, setDetect] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  // smart-guess editable fields
  const [gName, setGName] = useState(''), [gSells, setGSells] = useState(''), [gBuyer, setGBuyer] = useState(''), [gVoice, setGVoice] = useState(''), [gDiff, setGDiff] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // markets + competitors
  const [markets, setMarkets] = useState<string[]>([])
  const [suggested, setSuggested] = useState<Comp[]>([])
  const [picks, setPicks] = useState<Comp[]>([])
  const [q, setQ] = useState(''); const [results, setResults] = useState<Comp[]>([])
  const [loadingComp, setLoadingComp] = useState(false)
  // questions
  const [qi, setQi] = useState(0)
  const [redline, setRedline] = useState('')
  const [freeText, setFreeText] = useState('')
  // culture — the 4 dials that tune every department (Company Brain)
  const [culture, setCulture] = useState<{ aggressive: string; premium: string; tone: string; risk: string }>({ aggressive: 'balanced', premium: 'premium', tone: 'friendly', risk: 'ask' })
  const [cultureSaving, setCultureSaving] = useState(false)
  // notebook
  const [notes, setNotes] = useState<Note[]>([])
  const [nbOpen, setNbOpen] = useState(false)
  // offer + night
  const [signName, setSignName] = useState('')
  const [nightLog, setNightLog] = useState<{ t: string; done: boolean }[]>([])
  const [nightDone, setNightDone] = useState(false)
  // The user's REAL plan — a paying Creator who adds a NEW brand re-runs onboarding, and must NOT be
  // shown "Free tracks 1 competitor" or have their picks capped at 1. Free stays capped at 1.
  const [plan, setPlan] = useState<string | null>(null)
  const trackCap = (() => { const c = planEntitlements(plan).brandSpy; return c === Infinity ? 999 : Math.max(1, c) })()
  useEffect(() => { fetch('/api/credits/balance').then(r => r.ok ? r.json() : null).then(j => { if (j?.plan) setPlan(String(j.plan)) }).catch(() => {}) }, [])
  const brandIdRef = useRef<string | null>(null)
  const homeworkFired = useRef(false)
  const nightFired = useRef(false)

  // Resume, don't restart — persist progress so a browser back/refresh returns to the same step with the
  // same answers, instead of throwing the founder back to the welcome screen. (#5)
  const RESTORE_KEY = 'sm_onb_state_v1'
  const RESUMABLE: Phase[] = ['homework', 'guess', 'competitors', 'questions', 'culture', 'integrations', 'offer']
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RESTORE_KEY); if (!raw) return
      const s = JSON.parse(raw)
      if (!s || !RESUMABLE.includes(s.phase)) return
      if (s.url) setUrl(s.url); if (s.detect) setDetect(s.detect); if (s.analysis) setAnalysis(s.analysis)
      if (s.gName != null) setGName(s.gName); if (s.gSells != null) setGSells(s.gSells); if (s.gBuyer != null) setGBuyer(s.gBuyer)
      if (s.gVoice != null) setGVoice(s.gVoice); if (s.gDiff != null) setGDiff(s.gDiff)
      if (Array.isArray(s.markets)) setMarkets(s.markets); if (Array.isArray(s.suggested)) setSuggested(s.suggested)
      if (Array.isArray(s.picks)) setPicks(s.picks); if (s.culture) setCulture(s.culture); if (Array.isArray(s.notes)) setNotes(s.notes)
      if (s.brandId) brandIdRef.current = s.brandId
      homeworkFired.current = true   // don't re-run the crawl on resume
      setPhase(s.phase)
    } catch { /* ignore corrupt snapshot */ }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase === 'welcome' || phase === 'night' || phase === 'plan') return   // don't snapshot entry/terminal steps
    try { sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ phase, url, detect, analysis, gName, gSells, gBuyer, gVoice, gDiff, markets, suggested, picks, culture, notes, brandId: brandIdRef.current })) } catch { /* quota/private mode */ }
  }, [phase, url, detect, analysis, gName, gSells, gBuyer, gVoice, gDiff, markets, suggested, picks, culture, notes])

  const addLog = (t: string, done = false) => setLog(l => [...l.map(x => ({ ...x, done: true })), { t, done }])
  const note = (kind: string, content: string) => {
    const c = content.trim(); if (!c) return
    setNotes(n => n.some(x => x.content === c) ? n : [...n, { kind, content: c }])
    fetch('/api/interview/notebook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: [{ kind, content: c }], brandId: brandIdRef.current }) }).catch(() => {})
  }

  // ── Beat 2: the homework — real crawl + real analysis, log lines tied to real completions ──
  const startHomework = async () => {
    const u = url.trim(); if (!u || homeworkFired.current) return
    homeworkFired.current = true
    addLog(`opening ${u.replace(/^https?:\/\//, '')} …`)
    const detP = fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }) }).then(r => r.json()).catch(() => null)
    const anaP = fetch('/api/interview/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }) }).then(r => r.json()).catch(() => null)
    const d = await detP
    if (d?.brandName) addLog(`found the brand — ${d.brandName}${d.productImages?.length ? ` · ${d.productImages.length} product shots` : ''}`)
    else addLog('read the homepage')
    setDetect(d)
    const a = await anaP
    if (a?.sells) addLog('I think I understand the positioning')
    setAnalysis(a)
    addLog('done — here’s what I think I know', true)
    setGName(d?.brandName || ''); setGSells(a?.sells || ''); setGBuyer(a?.buyer || ''); setGVoice(a?.voice || ''); setGDiff(a?.differentiator || '')
    setTimeout(() => setPhase('guess'), 900)
  }

  const confirmGuesses = () => {
    if (gName) note('brand', `Works at ${gName}${url ? ` (${url.trim()})` : ''}.`)
    if (gSells) note('fact', `They sell: ${gSells}.`)
    if (gBuyer) note('fact', `The buyer: ${gBuyer}.`)
    if (gVoice) note('preference', `Brand voice: ${gVoice}.`)
    if (gDiff) note('fact', `What makes them different: ${gDiff}.`)
    setPhase('competitors')
  }

  // ── Markets picked → country-aware competitor suggestions from the live directory + crawled index ──
  useEffect(() => {
    if (phase !== 'competitors') return
    const kws: string[] = (analysis?.keywords?.length ? analysis.keywords : [analysis?.niche]).filter(Boolean).slice(0, 3)
    if (!kws.length) return
    setLoadingComp(true)
    Promise.all(kws.flatMap(k => [
      fetch(`/api/discovery/pages?q=${encodeURIComponent(k)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/discovery/brands?q=${encodeURIComponent(k)}&sort=ads`).then(r => r.json()).catch(() => null),
    ])).then(all => {
      const seen = new Set<string>(); const out: Comp[] = []
      for (const j of all) for (const b of ([...(j?.pages || []), ...(j?.brands || [])])) {
        const id = String(b.pageId || ''); if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ pageId: id, name: b.name, avatar: b.picture || b.avatar || null, adCount: b.adCount ?? null, country: b.country || null })
      }
      // country-aware ranking: brands from the founder's markets float up, then by ad volume
      out.sort((a, b) => (Number(markets.includes(String(b.country))) - Number(markets.includes(String(a.country)))) || ((b.adCount || 0) - (a.adCount || 0)))
      setSuggested(out.slice(0, 8))
    }).finally(() => setLoadingComp(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, markets.join(',')])

  // manual competitor search (same two sources as suggestions)
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      Promise.all([
        fetch(`/api/discovery/pages?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null),
        fetch(`/api/discovery/brands?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null),
      ]).then(([p, b]) => {
        const seen = new Set<string>(); const out: Comp[] = []
        for (const x of ([...(p?.pages || []), ...(b?.brands || [])])) {
          const id = String(x.pageId || ''); if (!id || seen.has(id)) continue
          seen.add(id); out.push({ pageId: id, name: x.name, avatar: x.picture || x.avatar || null, adCount: x.adCount ?? null, country: x.country || null })
        }
        setResults(out.slice(0, 6))
      })
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const togglePick = (c: Comp) => {
    setPicks(p => p.some(x => x.pageId === c.pageId) ? p.filter(x => x.pageId !== c.pageId) : p.length >= 5 ? p : [...p, c])
    // Added by a raw page id ("Facebook page <id>")? Resolve the real brand name so the chip shows it.
    if (/^facebook page \d+$/i.test(c.name) || /^\d+$/.test(c.name.trim())) {
      fetch('/api/discovery/resolve-names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageIds: [c.pageId] }) })
        .then(r => r.json()).then(j => { const nm = j?.names?.[c.pageId]; if (nm) setPicks(p => p.map(x => x.pageId === c.pageId ? { ...x, name: nm } : x)) })
        .catch(() => {})
    }
  }

  const confirmCompetitors = () => {
    if (markets.length) note('fact', `Markets: ${markets.map(m => COUNTRIES.find(c => c[0] === m)?.[1] || m).join(', ')}.`)
    if (picks.length) note('fact', `Competitors to watch: ${picks.map(p => p.name).join(', ')}.`)
    setPhase('questions'); setQi(0); setFreeText('')
  }

  // ── Beat 4: the questions only a human can answer — each with its WHY ──
  const QUESTIONS: { key: string; q: string; why: string; chips: string[] }[] = [
    {
      key: 'goal', q: 'If I worked here for the next 90 days — what would success look like?',
      why: 'I’ll optimize every recommendation around this.',
      chips: ['More sales', 'Lower cost per sale', 'A steady stream of creatives', 'Launch a new product', 'Build the brand'],
    },
    {
      key: 'scar', q: 'What marketing mistake should I never repeat?',
      why: 'I’d rather learn from your scars than make them again.',
      chips: ['Discounting cheapened us', 'Ads felt fake', 'Wrong audience', 'Spent with nothing to show', 'None yet — we’re new'],
    },
    {
      key: 'redline', q: 'If I wrote an ad tomorrow, what would make you say “that’s not us”?',
      why: 'I’ll remember this forever.',
      chips: ['Hype or shouting', 'Discount framing', 'Humor that tries too hard', 'Stock-photo feel'],
    },
    {
      key: 'worry', q: 'Of everyone out there — who worries you the most?',
      why: 'I’ll watch them the closest.',
      chips: picks.map(p => p.name).slice(0, 5),
    },
  ]

  const answerQ = (val: string) => {
    const v = val.trim(); if (!v) return
    const cur = QUESTIONS[qi]
    if (cur.key === 'goal') note('goal', `90-day success: ${v}.`)
    if (cur.key === 'scar') note('scar', `Never repeat: ${v}.`)
    if (cur.key === 'redline') { setRedline(v); note('rule', `"That's not us": ${v}. Retired before I started.`) }
    if (cur.key === 'worry') note('fact', `Worries them most: ${v} — watch closest.`)
    setFreeText('')
    if (qi < QUESTIONS.length - 1) setQi(qi + 1)
    else setPhase('culture')
  }

  // ── Culture: 4 dials that tune every department. Saved to the Company Brain (CEO prefs). ──
  const saveCulture = async () => {
    if (cultureSaving) return
    setCultureSaving(true)
    try { await fetch('/api/brain/culture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(culture) }).catch(() => {}) }
    finally { setCultureSaving(false); setPhase('integrations') }
  }

  // ── Beat 7 → 9: sign → create the brand, enroll the watch, start the night. All real work. ──
  const sign = async () => {
    if (signName.trim().length < 2 || nightFired.current) return
    nightFired.current = true
    setPhase('night')
    setNightLog([{ t: 'filing our agreement', done: false }])
    try {
      const body = {
        name: gName || detect?.brandName || 'My brand', website: url.trim(), description: gSells || undefined,
        tone: gVoice || undefined, target_audience: gBuyer || undefined,
        usps: gDiff ? [gDiff] : undefined, avoid_words: redline ? [redline] : undefined,
        product_images: (detect?.productImages?.length ? detect.productImages : detect?.images || []).slice(0, 4),
        brand_kit: detect?.brandKit || undefined,
      }
      const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => null)
      if (r?.brand?.id) {
        brandIdRef.current = r.brand.id
        // Make the just-created brand the ACTIVE project so the brief + every surface scope to it. Essential
        // when onboarding an Nth brand (?new=1) — otherwise the app stays on the previous brand.
        try { document.cookie = `sf_brand=${r.brand.id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax` } catch { /* ignore */ }
      }
    } catch { /* brand save is best-effort — the interview notes survive regardless */ }
    note('fact', `Hired on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — agreement signed by ${signName.trim()}.`)
    setNightLog(l => [...l.map(x => ({ ...x, done: true })), { t: 'agreement filed', done: false }])

    // Resolve any competitor added by a raw page id ("Facebook page <id>") to its real brand name, so the
    // follow, brand-spy crawl, the first report AND the brief all show the name — never the numeric id.
    let resolved = picks
    try {
      const fallbackIds = picks.filter(p => /^facebook page \d+$/i.test(p.name) || /^\d+$/.test(p.name.trim())).map(p => p.pageId)
      if (fallbackIds.length) {
        const { names } = await fetch('/api/discovery/resolve-names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageIds: fallbackIds }) }).then(r => r.json()).catch(() => ({ names: {} }))
        resolved = picks.map(p => (names && names[p.pageId]) ? { ...p, name: names[p.pageId] } : p)
      }
    } catch { /* keep original names */ }

    // real work: crawl EVERY competitor (data's ready if they upgrade), but only FOLLOW the plan-allowed
    // count. Free tracks 1 — the rest are saved and surfaced as an upgrade nudge, never silently dropped.
    const TRACK_LIMIT = trackCap   // plan-driven: Free = 1, Creator = 15 (not hardcoded — paid users add all their picks)
    for (let i = 0; i < resolved.length; i++) {
      const p = resolved[i]
      setNightLog(l => [...l.map(x => ({ ...x, done: true })), { t: `starting on ${p.name} — pulling their live ads`, done: false }])
      await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, name: p.name, crawlOnly: true }) }).catch(() => {})
      if (i < TRACK_LIMIT) {
        await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: p.pageId, brandName: p.name, action: 'follow', brandId: brandIdRef.current || undefined, spied: true }) }).catch(() => {})
      }
    }
    if (resolved.length > TRACK_LIMIT) note('fact', `Watching ${TRACK_LIMIT} of ${resolved.length} competitors on your plan (${resolved.slice(0, TRACK_LIMIT).map(p => p.name).join(', ')}). Upgrade to track them all: ${resolved.slice(TRACK_LIMIT).map(p => p.name).join(', ')}.`)
    setNightLog(l => [...l.map(x => ({ ...x, done: true })), { t: 'studying what wins in your market', done: false }])
    // Auto-author the first Competitor Intelligence Report on the primary competitor — the show-then-sell
    // wow that greets them on the brief. Fire-and-forget on gpt-4o (~$0.04 vs Opus ~$0.25) so a wave of
    // signups stays cheap; it runs server-side even after they navigate to /brief. Never blocks the night.
    if (resolved[0]?.name) {
      void fetch('/api/mello/documents/competitor-report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ competitor: resolved[0].name, brandId: brandIdRef.current || undefined, preferModel: 'gpt-4o', charge: false }),
      }).catch(() => {})
    }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from('user_profiles').update({ niche: analysis?.niche || null, onboarding_completed: true }).eq('user_id', user.id)
      // Stamp the same cookie the middleware onboarding-gate reads, so the very next navigation to
      // /brief passes instantly — never bounced back by a read that hasn't caught the write yet.
      try { document.cookie = `sm_onb=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax` } catch { /* ignore */ }
      try { sessionStorage.removeItem(RESTORE_KEY) } catch { /* ignore */ }   // onboarding done — clear the resume snapshot
    } catch { /* non-blocking */ }
    setNightLog(l => l.map(x => ({ ...x, done: true })))
    setNightDone(true)
  }

  const kindLabel: Record<string, string> = { brand: 'THE COMPANY', fact: 'NOTED', preference: 'VOICE', goal: 'THE GOAL', scar: 'NEVER AGAIN', rule: 'RED LINE' }
  const night = phase === 'night'

  // Plan step: start a Stripe checkout for a paid plan; on any misconfig/error, fall through to the app
  // on Free so onboarding never dead-ends. "Skip"/"Start on Free" go straight to /brief.
  const [planBusy, setPlanBusy] = useState<string>('')
  async function choosePlan(planId: 'starter' | 'business') {
    setPlanBusy(planId)
    try {
      // PayPal is the payment rail (card-only checkout). Stripe stays as a dormant fallback.
      if (process.env.NEXT_PUBLIC_PAYMENTS_PROVIDER !== 'stripe') {
        const { startPaypalCheckout } = await import('@/lib/paypal/start')
        await startPaypalCheckout({ kind: 'subscription', plan: planId, cycle: 'monthly' })
        return   // redirecting to PayPal card checkout
      }
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: planId, cycle: 'monthly' }) })
      const j = await r.json().catch(() => ({}))
      if (j?.url) { window.location.href = j.url; return }
    } catch { /* fall through */ }
    setPlanBusy(''); router.push('/brief')
  }

  // WhatsApp founder-connect removed from onboarding — founder briefs/approvals are Slack-only for now
  // (see project_whatsapp_founder_disabled). Customer WhatsApp is handled in the Inbox, not onboarding.

  return (
    <div style={{ minHeight: '100vh', background: night ? '#0b100c' : '#f6f8f5', fontFamily: "'Inter', -apple-system, sans-serif", transition: 'background .8s ease', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px' }}>
        <span style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: night ? '#eaf1e8' : INK }}>Selfmade</span>
        {!night && phase !== 'welcome' && (
          <button onClick={() => setNbOpen(o => !o)} style={{ ...btnGhost, padding: '8px 15px', fontSize: 12 }}>
            📓 Mello’s notebook{notes.length ? ` · ${notes.length}` : ''}
          </button>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 20px 60px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* ── BEAT 1 · WELCOME ── */}
          {phase === 'welcome' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><Mello /></div>
              <div style={say}>Hi. I’m Mello.<br />I’ll manage your marketing company.</div>
              <p style={sub}>This is your team — Research, Creative, Media Buying, Growth, Finance and Customer. They report to me, and I report to you. First, let me learn the business — about four minutes.</p>
              <TeamRoster />
              <button style={{ ...btnMain, marginTop: 26 }} onClick={() => setPhase('homework')}>Meet them properly — begin →</button>
            </div>
          )}

          {/* ── BEAT 2 · HOMEWORK ── */}
          {phase === 'homework' && (
            <div>
              <div style={say}>Where should I begin learning about your business?</div>
              {!log.length && (
                <>
                  <p style={sub}>Give me your website — I’d rather do my homework than ask you things I can read.</p>
                  <div style={{ display: 'flex', gap: 8, maxWidth: 420, margin: '22px auto 0' }}>
                    <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && startHomework()} placeholder="yourcompany.com" style={{ ...inputCss, borderRadius: 100, padding: '13px 20px' }} autoFocus />
                    <button style={btnMain} onClick={startHomework}>→</button>
                  </div>
                </>
              )}
              {!!log.length && (
                <div style={{ maxWidth: 420, margin: '24px auto 0', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 18px', font: '600 13px/2.1 ui-monospace, Menlo, monospace', color: MUTED }}>
                  {log.map((l, i) => <div key={i}>{l.done || i < log.length - 1 ? <span style={{ color: GREEN }}>✓</span> : <span className="spin-dot">›</span>} {l.t}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ── BEAT 3 · SMART GUESS ── */}
          {phase === 'guess' && (
            <div>
              <div style={say}>Here’s what I think I know.<br />Correct me where I’m wrong.</div>
              <div style={{ marginTop: 22 }}>
                {[
                  { k: 'name', label: 'The company', val: gName, set: setGName },
                  { k: 'sells', label: 'You sell', val: gSells, set: setGSells },
                  { k: 'buyer', label: 'Your buyer', val: gBuyer, set: setGBuyer },
                  { k: 'voice', label: 'Your voice', val: gVoice, set: setGVoice },
                  { k: 'diff', label: 'Your edge', val: gDiff, set: setGDiff },
                ].filter(r => r.val || editing === r.k).map(r => (
                  <div key={r.k} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '12px 16px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', color: MUTED, textTransform: 'uppercase', width: 92, flexShrink: 0 }}>{r.label}</span>
                    {editing === r.k
                      ? <input value={r.val} onChange={e => r.set(e.target.value)} onKeyDown={e => e.key === 'Enter' && setEditing(null)} onBlur={() => setEditing(null)} style={{ ...inputCss, padding: '7px 10px', fontSize: 13.5 }} autoFocus />
                      : <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: INK }}>{r.val}</span>}
                    {editing !== r.k && <button onClick={() => setEditing(r.k)} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>fix</button>}
                  </div>
                ))}
                {!gSells && !gBuyer && (
                  <div style={{ ...sub, marginTop: 4 }}>Give me one line on what you sell — I’ll take it from there tonight.
                    <input value={gSells} onChange={e => setGSells(e.target.value)} style={{ ...inputCss, marginTop: 10 }} placeholder="e.g. farm-fresh dairy, delivered — Lahore" /></div>
                )}
              </div>
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button style={btnMain} onClick={confirmGuesses}>✓ That’s us</button>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10, fontStyle: 'italic' }}>Everything you confirm goes in my notebook — I’ll hold myself to it.</div>
              </div>
            </div>
          )}

          {/* ── COMPETITORS — markets first (country-aware), then who to watch ── */}
          {phase === 'competitors' && (
            <div>
              <div style={say}>Where do you sell — and who should I be watching?</div>
              <p style={sub}>Markets first: they change which competitors matter. <i>I’m asking because I’ll pick rivals and trends from the right countries.</i></p>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'center', margin: '16px 0 22px' }}>
                {COUNTRIES.map(([code, label]) => (
                  <button key={code} style={chip(markets.includes(code))} onClick={() => setMarkets(m => m.includes(code) ? m.filter(x => x !== code) : [...m, code])}>{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.09em', color: MUTED, textTransform: 'uppercase', marginBottom: 10, textAlign: 'left' }}>Pick who I should watch — click to choose</div>
              <BrandPalette q={q} setQ={setQ} suggested={suggested} results={results} picks={picks} loading={loadingComp} onToggle={togglePick} extractId={extractPageId} />
              {picks.length > trackCap && (
                <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12.5, color: MUTED }}>
                  Your plan tracks <b style={{ color: INK }}>{trackCap} competitor{trackCap === 1 ? '' : 's'}</b> — I’ll start with <b style={{ color: INK }}>{picks.slice(0, trackCap).map(p => p.name).join(', ')}</b>. The other {picks.length - trackCap} unlock when you upgrade.
                </div>
              )}
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button style={{ ...btnMain, opacity: picks.length ? 1 : 0.5 }} disabled={!picks.length} onClick={confirmCompetitors}>
                  Watch {picks.length ? `these ${picks.length}` : 'them'} for me →
                </button>
              </div>
            </div>
          )}

          {/* ── BEAT 4 · THE QUESTIONS ── */}
          {phase === 'questions' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: MUTED, textTransform: 'uppercase', textAlign: 'center', marginBottom: 14 }}>Question {qi + 1} of {QUESTIONS.length} — only you can answer these</div>
              <div style={say}>{QUESTIONS[qi].q}</div>
              <p style={{ ...sub, fontStyle: 'italic' }}>{QUESTIONS[qi].why}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '20px 0 14px' }}>
                {QUESTIONS[qi].chips.filter(Boolean).map(c => <button key={c} style={chip(false)} onClick={() => answerQ(c)}>{c}</button>)}
              </div>
              <div style={{ display: 'flex', gap: 8, maxWidth: 430, margin: '0 auto' }}>
                <input value={freeText} onChange={e => setFreeText(e.target.value)} onKeyDown={e => e.key === 'Enter' && answerQ(freeText)} placeholder="…or say it your way" style={{ ...inputCss, borderRadius: 100, padding: '11px 18px' }} />
                <button style={{ ...btnGhost, padding: '10px 16px' }} onClick={() => answerQ(freeText)}>↵</button>
              </div>
            </div>
          )}

          {/* ── BEAT 4b · CULTURE — the 4 dials that tune every department ── */}
          {phase === 'culture' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: MUTED, textTransform: 'uppercase', textAlign: 'center', marginBottom: 14 }}>Last thing — how should the team behave?</div>
              <div style={say}>Set the company&rsquo;s temperament. Every part of the team follows it.</div>
              <p style={{ ...sub, fontStyle: 'italic' }}>You can change any of these later in the Company Brain.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460, margin: '22px auto 0' }}>
                {([
                  { k: 'aggressive', q: 'How aggressive are we?', opts: [['conservative', 'Conservative'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']] },
                  { k: 'premium', q: 'How premium are we?', opts: [['mass', 'Mass market'], ['premium', 'Premium'], ['luxury', 'Luxury']] },
                  { k: 'tone', q: 'Our tone?', opts: [['professional', 'Professional'], ['friendly', 'Friendly'], ['funny', 'Funny']] },
                  { k: 'risk', q: 'How much can I decide alone?', opts: [['ask', 'Always ask me'], ['sometimes', 'Sometimes decide'], ['auto', 'Decide for me']] },
                ] as { k: 'aggressive' | 'premium' | 'tone' | 'risk'; q: string; opts: [string, string][] }[]).map(row => (
                  <div key={row.k}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 8 }}>{row.q}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {row.opts.map(([val, label]) => (
                        <button key={val} style={chip(culture[row.k] === val)} onClick={() => setCulture(c => ({ ...c, [row.k]: val }))}>{label}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <button style={btnMain} onClick={saveCulture} disabled={cultureSaving}>{cultureSaving ? 'Saving…' : 'That’s us →'}</button>
              </div>
            </div>
          )}

          {/* ── BEAT 5 · INTEGRATIONS — channels connectable; Meta Ads AVAILABLE now (BYO /connect/meta),
                the rest still honest SOON. ── */}
          {phase === 'integrations' && (
            <div>
              <div style={say}>Give your team their tools.</div>
              <p style={sub}>Your company works through the apps you already use — no dashboard to check. First, where should the team reach you? I’ll send the daily brief here, and you approve, ask, or redirect right from chat.</p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', margin: '20px 0 6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                  <a href="/api/channels/slack/start" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '13px 18px', textDecoration: 'none', color: INK, fontSize: 14, fontWeight: 800, fontFamily: 'inherit' }}>
                    <ChannelLogo provider="slack" size={22} /> Add to Slack
                  </a>
                  <span style={{ fontSize: 11.5, fontWeight: 750, color: MUTED }}>Daily brief + approvals</span>
                </div>
                {/* WhatsApp founder-brief removed — founder briefs/approvals are Slack-only for now
                    (see project_whatsapp_founder_disabled). Customer WhatsApp lives in the Inbox, not here. */}
              </div>

              <div style={{ height: 1, background: LINE, margin: '22px 0 18px' }} />

              {/* Meta Ads — available now via the BYO connect wizard, so Media Buying starts with your history */}
              <div style={{ ...say, fontSize: 22 }}>Give Media Buying your ad account.</div>
              <p style={sub}>Connect Meta Ads and Media Buying sees what already worked — and builds on it from night one.</p>
              <a href="/connect/meta" target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'left', background: '#fff', border: `1.5px solid ${SELBORDER}`, borderRadius: 14, padding: '15px 18px', textDecoration: 'none', maxWidth: 430, margin: '18px auto 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ fontSize: 14.5, color: INK }}>Connect Meta Ads →</b>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.08em', background: '#ef4a1e', color: '#fff', borderRadius: 6, padding: '3px 8px' }}>AVAILABLE</span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>So Media Buying sees what already worked.</div>
              </a>

              <div style={{ height: 1, background: LINE, margin: '22px 0 18px' }} />

              <div style={{ ...say, fontSize: 22 }}>And soon — more for the team.</div>
              <p style={sub}>Each department works better with your own history. These are almost ready — when they are, I’ll ask again and tell you exactly what each one unlocks.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, margin: '20px 0 4px' }}>
                {[['Shopify', 'so the team knows what actually sells'], ['TikTok', 'so Creative learns your short-video wins'], ['Google', 'so Research sees what people search']].map(([n, d]) => (
                  <div key={n} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '13px 15px', opacity: .75 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b style={{ fontSize: 13.5, color: INK }}>{n}</b>
                      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.08em', background: '#f1f4f0', color: MUTED, borderRadius: 6, padding: '3px 7px' }}>SOON</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{d}</div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button style={btnMain} onClick={() => setPhase('offer')}>I’ll start from the market →</button>
              </div>
            </div>
          )}

          {/* ── BEAT 7 · THE AGREEMENT ── */}
          {phase === 'offer' && (
            <div style={{ background: PAPER, border: `1px solid ${PAPERLINE}`, borderRadius: 18, padding: '30px 30px 26px', boxShadow: '0 30px 70px -30px rgba(20,29,21,.25)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: LIME }} />
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.2em', color: '#8a927f', marginBottom: 18 }}>MARKETING EMPLOYEE AGREEMENT</div>
              {[['Employee', 'Mello & your marketing team'], ['Employer', gName || 'Your company'], ['Department', 'Marketing — the whole company'], ['Working hours', '24 / 7'], ['Start date', 'Today'], ['Mission', 'Help grow this business']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #ecebe0', fontSize: 13.5 }}>
                  <span style={{ color: '#8a927f' }}>{k}</span><b style={{ fontWeight: 750, color: INK }}>{v}</b>
                </div>
              ))}
              <div style={{ fontSize: 12.5, lineHeight: 1.9, color: '#4c5347', margin: '16px 0 20px' }}>
                <b style={{ color: INK }}>My promises:</b> I’ll remember every marketing decision. I’ll explain every recommendation. I’ll tell you when I don’t know. I’ll watch your competitors every day. I’ll protect your brand — {redline ? <i>“{redline}” is already retired</i> : 'your red lines are law'}. I’ll never stop improving.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'end' }}>
                <div>
                  <div style={{ borderBottom: `1.5px solid ${INK}`, height: 38, display: 'flex', alignItems: 'flex-end', paddingBottom: 3, fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 23, color: '#1f2a1c' }}>Mello</div>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: '#8a927f', marginTop: 6 }}>MELLO · YOUR MARKETING MANAGER</div>
                </div>
                <div>
                  <input value={signName} onChange={e => setSignName(e.target.value)} placeholder="Type your name to sign"
                    style={{ width: '100%', border: 'none', borderBottom: `1.5px solid ${INK}`, background: 'transparent', outline: 'none', height: 38, fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 23, color: '#1f2a1c' }} />
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: '#8a927f', marginTop: 6 }}>YOU · THE FOUNDER</div>
                </div>
              </div>
              <button style={{ ...btnMain, width: '100%', marginTop: 22, opacity: signName.trim().length < 2 ? .45 : 1 }} disabled={signName.trim().length < 2} onClick={sign}>
                Countersign &amp; hire the team
              </button>
            </div>
          )}

          {/* ── BEAT 9 · THE NIGHT ── */}
          {phase === 'night' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}><Mello state={nightDone ? 'delivered' : 'awake'} /></div>
              <div style={{ ...say, color: '#fff' }}>{nightDone ? 'Your first brief is ready.' : 'The team is starting work now.'}</div>
              <div style={{ maxWidth: 380, margin: '22px auto 0', textAlign: 'left', font: '600 13px/2.3 ui-monospace, Menlo, monospace', color: '#7d8a7c' }}>
                {nightLog.map((l, i) => <div key={i}>{l.done ? <span style={{ color: '#a9d96a' }}>✓</span> : <span className="spin-dot">›</span>} {l.t}</div>)}
              </div>
              {nightDone && (
                <>
                  <p style={{ ...sub, color: '#7d8a7c', marginTop: 24 }}>The team studies your market all night — competitors, angles, everything that wins. But I already have a first read for you.</p>
                  {/* Section 4 (show, then sell): the promised payoff must BE the payoff. This opens the real
                      first brief; the plan ask is sequenced after value, as a card inside ?welcome=1. */}
                  <button style={{ ...btnMain, background: '#ef4a1e', color: '#fff', marginTop: 18 }} onClick={() => router.push('/brief?welcome=1')}>Read my first briefing →</button>
                </>
              )}
            </div>
          )}

          {/* ── BEAT 10 · PICK A PLAN (skippable — Free is the default) ── */}
          {phase === 'plan' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}><Mello /></div>
              <div style={say}>One last thing — how do you want to work with me?</div>
              <p style={sub}>Start free and upgrade whenever. You can change or cancel anytime.</p>
              <div style={{ display: 'flex', gap: 12, margin: '26px auto 0', maxWidth: 720, flexWrap: 'wrap', justifyContent: 'center', textAlign: 'left' }}>
                {/* Free */}
                <div style={planCard}>
                  <div style={planName}>Free</div>
                  <div style={planPrice}>$0<span style={planPer}>/mo</span></div>
                  <div style={planFeat}>75 free credits (~5 image ads)<br />Spy on 1 competitor<br />Daily brief from Mello</div>
                  <button style={{ ...btnGhost, width: '100%', marginTop: 14 }} onClick={() => router.push('/brief')}>Start on Free →</button>
                </div>
                {/* Full-time — the ONE paid plan ($49/mo). Tiers collapsed to Polsia-simple. */}
                <div style={{ ...planCard, border: `2px solid ${SELBORDER}`, background: SELBG }}>
                  <div style={{ ...planBadge }}>FULL-TIME</div>
                  <div style={planName}>Mello, full-time</div>
                  <div style={planPrice}>$49<span style={planPer}>/mo</span></div>
                  <div style={planFeat}>Video ads<br />Unlimited image ads<br />Every competitor watched<br />Fresh creatives every morning</div>
                  <button style={{ ...btnMain, width: '100%', marginTop: 14, opacity: planBusy ? 0.6 : 1 }} disabled={!!planBusy} onClick={() => choosePlan('starter')}>{planBusy === 'starter' ? 'Opening…' : 'Go full-time · $49/mo'}</button>
                </div>
              </div>
              <p style={{ ...sub, marginTop: 16 }}>Prefer to pay as you go? You can buy credits anytime — no subscription.</p>
              <button style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 14, fontFamily: 'inherit' }} onClick={() => router.push('/brief')}>Skip for now — I’ll start free →</button>
            </div>
          )}
        </div>
      </div>

      {/* ── BEAT 6 · THE NOTEBOOK — never disappears; this is the memory being born ── */}
      {nbOpen && !night && (
        <div onClick={() => setNbOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,11,.35)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 340, maxWidth: '88vw', background: PAPER, borderLeft: `1px solid ${PAPERLINE}`, padding: '26px 24px', overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.2em', color: '#b3ab7e', marginBottom: 14 }}>WHAT I’M LEARNING</div>
            {!notes.length && <div style={{ fontSize: 13, color: '#8a927f', fontStyle: 'italic' }}>Empty for now — I write things down as you talk.</div>}
            {notes.map((n, i) => (
              <div key={i} style={{ marginBottom: 13, paddingBottom: 12, borderBottom: '1px dashed #e8e2c4' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: '#b3ab7e' }}>{kindLabel[n.kind] || n.kind.toUpperCase()}</div>
                <div style={{ fontSize: 13, color: '#3c4437', lineHeight: 1.6, marginTop: 3 }}>{n.content}</div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#b3ab7e', fontStyle: 'italic', marginTop: 6 }}>This notebook never disappears — it becomes my long-term memory of your business.</div>
          </div>
        </div>
      )}
      <style>{`@keyframes nb-pulse{50%{opacity:.35}} .spin-dot{display:inline-block;animation:nb-pulse 1s infinite}
        @keyframes team-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}} .team-in{animation:team-in .5s cubic-bezier(0,0,.2,1) both}
        @media (prefers-reduced-motion: reduce){.team-in{animation:none}}`}</style>
    </div>
  )
}
