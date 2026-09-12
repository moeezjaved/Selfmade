'use client'
/**
 * Your Ads — the most important page in the app. Two jobs on one screen:
 *   · Launch a new ad  — pick creative(s) from a modal (or upload), everything else pre-filled/generated,
 *     with the FULL targeting the old M4 wizard asked (goal, audience by interest, age/gender, location,
 *     retargeting) but organised so it stays simple. Fires the same /api/m4/launch engine.
 *   · Your live ads    — the live account with per-ad Manage (Scale/Pause/Duplicate/Edit via Mello).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import FacebookAdsCard from '@/components/brief/FacebookAdsCard'

const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a', LINE = 'rgba(20,18,15,.12)', LINE2 = 'rgba(20,18,15,.07)', INSET = '#f7f6f4', ORANGE = '#e02f06', GOOD = '#12a150', PAPER = '#fbfaf8'
const SANS = 'Inter, system-ui, sans-serif'

type Creative = { id: string; image_url: string | null; media_type?: string | null; prompt?: string | null; brand_name?: string | null; hash?: string; local?: boolean }
type Page = { id: string; name: string; website?: string; instagram?: { id: string } | null }
type Interest = { id: string; name: string }

const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['PK', 'Pakistan'],
  ['IN', 'India'], ['AE', 'UAE'], ['SA', 'Saudi Arabia'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'],
  ['SE', 'Sweden'], ['ES', 'Spain'], ['IT', 'Italy'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['NG', 'Nigeria'],
  ['ZA', 'South Africa'], ['PH', 'Philippines'], ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'],
]
const toCode = (c?: string): string => {
  if (!c) return ''
  const s = c.trim(); if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  const hit = COUNTRIES.find(([, name]) => name.toLowerCase() === s.toLowerCase())
  return hit ? hit[0] : ''
}
const CTAS = ['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'GET_OFFER', 'SUBSCRIBE', 'CONTACT_US', 'BOOK_TRAVEL']
const OBJECTIVES: { key: string; label: string; sub: string }[] = [
  { key: 'OUTCOME_SALES', label: 'Sales', sub: 'Buyers & conversions' },
  { key: 'OUTCOME_TRAFFIC', label: 'Traffic', sub: 'Clicks to your site' },
  { key: 'OUTCOME_LEADS', label: 'Leads', sub: 'Sign-ups & enquiries' },
]
// Budget symbol + sensible daily presets PER the ad account's currency (Meta rejects sub-minimum budgets —
// e.g. PKR min is ~Rs281/day — so a "$20" default on a PKR account was floored). Dynamic from the account.
const CURRENCY = (c: string): { sym: string; presets: string[]; def: string } => {
  const m: Record<string, { sym: string; presets: string[]; def: string }> = {
    USD: { sym: '$', presets: ['10', '20', '50', '100'], def: '20' },
    GBP: { sym: '£', presets: ['10', '20', '50', '100'], def: '20' },
    EUR: { sym: '€', presets: ['10', '20', '50', '100'], def: '20' },
    CAD: { sym: 'C$', presets: ['15', '30', '70', '150'], def: '30' },
    AUD: { sym: 'A$', presets: ['15', '30', '70', '150'], def: '30' },
    PKR: { sym: 'Rs', presets: ['500', '1000', '2500', '5000'], def: '1000' },
    INR: { sym: '₹', presets: ['500', '1000', '2500', '5000'], def: '1000' },
    AED: { sym: 'AED', presets: ['40', '80', '200', '400'], def: '80' },
    SAR: { sym: 'SAR', presets: ['40', '80', '200', '400'], def: '80' },
    NGN: { sym: '₦', presets: ['5000', '10000', '25000', '50000'], def: '10000' },
    BRL: { sym: 'R$', presets: ['50', '100', '250', '500'], def: '100' },
    MXN: { sym: 'MX$', presets: ['200', '400', '1000', '2000'], def: '400' },
    ZAR: { sym: 'R', presets: ['150', '300', '750', '1500'], def: '300' },
    PHP: { sym: '₱', presets: ['500', '1000', '2500', '5000'], def: '1000' },
    IDR: { sym: 'Rp', presets: ['150000', '300000', '750000', '1500000'], def: '300000' },
    MYR: { sym: 'RM', presets: ['40', '80', '200', '400'], def: '80' },
  }
  return m[c] || { sym: `${c} `, presets: ['10', '20', '50', '100'], def: '20' }
}

// ── tiny line icons (single-colour, match the app) ──
const Ic = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>
)
const ICONS = {
  ad: 'M3 5h18v14H3z|M3 15l5-5 4 4 3-3 6 6',
  goal: 'M12 2v4|M12 18v4|M2 12h4|M18 12h4', // simplified target
  people: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2|M12 7a4 4 0 1 0 0 0.01|M22 21v-2a4 4 0 0 0-3-3.87',
  copy: 'M4 7h16|M4 12h16|M4 17h10',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z|M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  money: 'M12 2v20|M17 6.5c0-2-2.2-3.5-5-3.5s-5 1.3-5 3.3S9 12 12 12s5 1 5 3.2-2.2 3.3-5 3.3-5-1.5-5-3.5',
}

// Defined at MODULE scope (not inside the component) — a component defined inside render is a NEW type
// every keystroke, so React remounts the whole subtree, which resets scroll + steals focus. This was the
// "fill budget → jumps up to creatives" bug.
function Section({ icon, n, title, children }: { icon: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 16, padding: '18px 18px 20px', boxShadow: '0 1px 2px rgba(20,18,15,.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: INSET, color: INK, display: 'grid', placeItems: 'center' }}><Ic d={icon} /></span>
        <span style={{ fontSize: 15, fontWeight: 750, color: INK }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: FAINT }}>{n}</span>
      </div>
      {children}
    </section>
  )
}

export default function QuickLaunch() {
  // data
  const [creatives, setCreatives] = useState<Creative[] | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'launch' | 'manage'>('launch')
  const [prefilling, setPrefilling] = useState(true)

  // launch selections
  const [selected, setSelected] = useState<string[]>([])          // main (prospecting) creative ids
  const [retargetSel, setRetargetSel] = useState<string[]>([])    // optional separate creatives for retargeting
  const [retainSel, setRetainSel] = useState<string[]>([])        // optional separate creatives for retention
  const [pickerFor, setPickerFor] = useState<null | 'main' | 'retarget' | 'retain'>(null)   // which selection the modal edits
  const [pageId, setPageId] = useState('')
  const [objective, setObjective] = useState('OUTCOME_SALES')
  const [primaryText, setPrimaryText] = useState('')
  const [headline, setHeadline] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')
  const [url, setUrl] = useState('')
  const [budget, setBudget] = useState('20')
  // Locations come straight from Facebook (countries, regions, cities) — not a hardcoded list.
  const [locations, setLocations] = useState<{ key: string; name: string; type: string; country_name?: string }[]>([])
  const [locQuery, setLocQuery] = useState('')
  const [locResults, setLocResults] = useState<any[]>([])
  const [locSearching, setLocSearching] = useState(false)
  // Ad account this ad runs in — scoped to the active brand (same as Reports). Page/pixel/URL follow it.
  const [accounts, setAccounts] = useState<{ account_id: string; account_name: string; currency: string }[]>([])
  const [accountId, setAccountId] = useState('')
  // Conversion pixel(s) from the connected account.
  const [pixels, setPixels] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [pixelId, setPixelId] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)   // AI copy (re)generation
  const detected = useRef<{ product: string; description: string; targetCustomer: string; brand: string }>({ product: '', description: '', targetCustomer: '', brand: '' })
  // audience
  const [broad, setBroad] = useState(true)                        // Advantage+ vs interest-targeted
  const [interests, setInterests] = useState<Interest[]>([])
  const [iQuery, setIQuery] = useState('')
  const [iResults, setIResults] = useState<Interest[]>([])
  const [iSearching, setISearching] = useState(false)
  const [ageMin, setAgeMin] = useState('18')
  const [ageMax, setAgeMax] = useState('65')
  const [gender, setGender] = useState<'ALL' | 'MEN' | 'WOMEN'>('ALL')
  // Campaign types (M4 parity): new customers is always on; retargeting = warm visitors; retention = past
  // buyers. Each can carry its own message; the budget is split across whichever are on (60% new / 40% warm).
  const [retarget, setRetarget] = useState(false)
  const [retention, setRetention] = useState(false)
  const [retargetMsg, setRetargetMsg] = useState('')
  const [retainMsg, setRetainMsg] = useState('')

  // upload
  const [uploaded, setUploaded] = useState<Creative[]>([])         // uploaded-from-computer creatives (carry Meta hash)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState<'' | 'uploading' | 'launching'>('')
  const [result, setResult] = useState<{ ok: boolean; msg: string; note?: string; href?: string; hrefLabel?: string; external?: boolean } | null>(null)
  const copyEdited = useRef(false)
  const budgetTouched = useRef(false)
  const acctCurrency = accounts.find((a) => a.account_id === accountId)?.currency || 'USD'
  const cur = CURRENCY(acctCurrency)

  // ── load creatives + pages + detect brand → prefill url/country → generate copy ──
  useEffect(() => {
    let wantImg = ''
    try { const sp = new URLSearchParams(window.location.search); wantImg = sp.get('img') || ''; if (sp.get('tab') === 'manage') setTab('manage') } catch { /* SSR */ }

    fetch('/api/creatives?limit=60').then((r) => r.json()).then((d) => {
      let list: Creative[] = (Array.isArray(d.creatives) ? d.creatives : []).filter((c: Creative) => c.image_url && c.media_type !== 'video')
      if (wantImg) {
        const hit = list.find((c) => c.image_url === wantImg)
        if (hit) setSelected([hit.id])
        else { list = [{ id: '_img', image_url: wantImg, media_type: 'image' }, ...list]; setSelected(['_img']) }
      }
      setCreatives(list)
    }).catch(() => setCreatives([]))

    // Ad accounts for the ACTIVE brand (strict, same as Reports) → the account picker. Fall back to the
    // whole workspace so a brand with nothing linked can still choose one. Selecting drives pages/pixel below.
    fetch('/api/meta/accounts').then((r) => r.json()).then((d) => {
      const brandAccts = Array.isArray(d.accounts) ? d.accounts : []
      const list = brandAccts.length ? brandAccts : (Array.isArray(d.workspaceAccounts) ? d.workspaceAccounts : [])
      const norm = list.map((a: any) => ({ account_id: String(a.account_id), account_name: a.account_name || a.account_id, currency: a.currency || 'USD' }))
      setAccounts(norm)
      if (!norm.length) { setMetaConnected(false); return }
      const primary = brandAccts.find((a: any) => a.is_primary) || list[0]
      setAccountId(String(primary.account_id))
    }).catch(() => setMetaConnected(false))

    ;(async () => {
      try {
        const d = await fetch('/api/m4/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json())
        if (d?.website && !url) setUrl(String(d.website))
        // Pre-add the detected country as a REAL Facebook location chip (buildGeo reads {type,key}).
        const cc = toCode(d?.country)
        if (cc) setLocations((l) => l.length ? l : [{ key: cc, name: COUNTRIES.find(([c]) => c === cc)?.[1] || cc, type: 'country' }])
        detected.current = { product: d?.product || '', description: d?.description || '', targetCustomer: d?.targetCustomer || '', brand: d?.brand || '' }
        // Enrich from BRAND HUB (curated product facts + product names) so copy is about the real product,
        // not a generic "our range of products". The Brand Hub is the source of truth we already have.
        const dom = String(d?.website || url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        if (dom) {
          const [kit, prods] = await Promise.all([
            fetch(`/api/ads-studio/brand-kit?domain=${encodeURIComponent(dom)}`).then((r) => r.json()).catch(() => null),
            fetch(`/api/ads-studio/products?domain=${encodeURIComponent(dom)}`).then((r) => r.json()).catch(() => null),
          ])
          const pTitle = (Array.isArray(prods?.products) && prods.products[0]?.title) || ''
          const facts = (Array.isArray(kit?.facts) ? kit.facts : []).slice(0, 5).join('. ')
          detected.current = {
            product: pTitle || detected.current.product || kit?.siteName || '',
            description: facts || detected.current.description || '',
            targetCustomer: detected.current.targetCustomer,
            brand: kit?.siteName || detected.current.brand || '',
          }
        }
      } catch { /* best-effort */ }
      await genCopy()   // ALWAYS write copy (now grounded in the real product from Brand Hub)
      setPrefilling(false)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pages + pixel follow the SELECTED ad account (so they match where the ad runs — not a fallback account).
  useEffect(() => {
    if (!accountId) return
    // Default the budget to something sensible for THIS account's currency (unless the user set it).
    const curNow = accounts.find((a) => a.account_id === accountId)?.currency || 'USD'
    if (!budgetTouched.current) setBudget(CURRENCY(curNow).def)
    const q = `?account_id=${encodeURIComponent(accountId)}`
    fetch(`/api/m4/pages${q}`).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) })).then(({ ok, d }) => {
      setMetaConnected(ok && !d?.error ? true : (d?.error === 'No Meta account' ? false : true))
      const ps: Page[] = Array.isArray(d.pages) ? d.pages : []
      setPages(ps)
      setPageId((cur) => cur && ps.some((p) => p.id === cur) ? cur : (ps[0]?.id || ''))
      if (ps[0]?.website) setUrl((u) => u || ps[0].website || '')
    }).catch(() => setMetaConnected(true))

    fetch(`/api/m4/pixels${q}`).then((r) => r.json()).then((d) => {
      const px = Array.isArray(d.pixels) ? d.pixels : []
      setPixels(px)
      setPixelId((cur) => cur && px.some((p: any) => p.id === cur) ? cur : ((px.find((p: any) => p.active) || px[0])?.id || ''))
    }).catch(() => setPixels([]))
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  // AI copy — always produce something. Uses detected product/desc, falling back to the brand name or the
  // site domain so the fields never sit empty. `force` rewrites even if the user has edited.
  const genCopy = async (force = false) => {
    if (copyEdited.current && !force) return
    const dc = detected.current
    const domain = (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const product = dc.product || dc.brand || domain || 'our product'
    const description = dc.description || `Products from ${dc.brand || domain || 'our store'}`
    setCopyBusy(true)
    try {
      const cp = await fetch('/api/m4/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product, description, targetCustomer: dc.targetCustomer || '', type: 'main', tone: 'benefit' }) }).then((r) => r.json())
      if (cp) { if (cp.primaryText) setPrimaryText(cp.primaryText); if (cp.headline) setHeadline(String(cp.headline).slice(0, 40)); if (force) copyEdited.current = false }
    } catch { /* keep whatever's there */ } finally { setCopyBusy(false) }
  }

  // Auto-write the message for a retargeting / retention campaign (grounded in the same product).
  const genCampaignCopy = async (type: 'retargeting' | 'retainer', setMsg: (s: string) => void) => {
    const dc = detected.current
    const domain = (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const product = dc.product || dc.brand || domain || 'our product'
    const description = dc.description || `Products from ${dc.brand || domain || 'our store'}`
    try {
      const cp = await fetch('/api/m4/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product, description, targetCustomer: dc.targetCustomer || '', type, tone: 'benefit' }) }).then((r) => r.json())
      if (cp?.primaryText) setMsg(String(cp.primaryText))
    } catch { /* leave empty — user can write it */ }
  }

  // ── interest search (debounced) ──
  useEffect(() => {
    if (broad || iQuery.trim().length < 2) { setIResults([]); return }
    const t = setTimeout(async () => {
      setISearching(true)
      try {
        const d = await fetch(`/api/m4/search-interests?q=${encodeURIComponent(iQuery.trim())}`).then((r) => r.json())
        const res: Interest[] = (Array.isArray(d.results) ? d.results : []).map((x: any) => ({ id: String(x.id), name: String(x.name) })).filter((x: Interest) => !interests.some((i) => i.id === x.id))
        setIResults(res.slice(0, 8))
      } catch { setIResults([]) } finally { setISearching(false) }
    }, 280)
    return () => clearTimeout(t)
  }, [iQuery, broad]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── location search — real Facebook locations (countries, regions, cities) ──
  useEffect(() => {
    if (locQuery.trim().length < 2) { setLocResults([]); return }
    const t = setTimeout(async () => {
      setLocSearching(true)
      try {
        const d = await fetch(`/api/m4/locations?q=${encodeURIComponent(locQuery.trim())}`).then((r) => r.json())
        const res = (Array.isArray(d.results) ? d.results : []).filter((x: any) => !locations.some((l) => l.key === x.key))
        setLocResults(res.slice(0, 8))
      } catch { setLocResults([]) } finally { setLocSearching(false) }
    }, 280)
    return () => clearTimeout(t)
  }, [locQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── upload from computer (image or video) ──
  const onUpload = async (file: File) => {
    setUploadErr('')
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
    if (file.size > 200 * 1024 * 1024) { setUploadErr('That file is over 200MB — pick a smaller one.'); return }
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('isVideo', isVideo ? 'true' : 'false')
      const d = await fetch('/api/m4/upload-image', { method: 'POST', body: fd }).then((r) => r.json())
      if (!d?.hash) { setUploadErr(d?.error || 'Couldn’t prepare that file for Meta — try another.'); setUploading(false); return }
      const id = `_up_${Date.now()}`
      const c: Creative = { id, image_url: URL.createObjectURL(file), media_type: isVideo ? 'video' : 'image', brand_name: file.name, hash: String(d.hash), local: true }
      setUploaded((u) => [c, ...u]); setSelFor(pickerFor || 'main')((s) => [id, ...s])
    } catch { setUploadErr('Upload failed — try again.') } finally { setUploading(false) }
  }

  const allCreatives: Creative[] = [...uploaded, ...(creatives || [])]
  const setSelFor = (k: 'main' | 'retarget' | 'retain') => k === 'retarget' ? setRetargetSel : k === 'retain' ? setRetainSel : setSelected
  const selFor = (k: 'main' | 'retarget' | 'retain') => k === 'retarget' ? retargetSel : k === 'retain' ? retainSel : selected
  const creativesOf = (ids: string[]) => allCreatives.filter((c) => ids.includes(c.id))
  const chosen = creativesOf(selected)                          // main (prospecting) creatives
  const activeSel = pickerFor ? selFor(pickerFor) : selected
  const page = pages.find((p) => p.id === pageId) || null
  // Toggle within the selection the modal is currently editing (main / retarget / retain).
  const toggle = (id: string) => setSelFor(pickerFor || 'main')((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const missing: string[] = []
  if (!chosen.length) missing.push('an ad')
  if (!pageId) missing.push('a Facebook Page')
  if (!url.trim()) missing.push('a destination URL')
  if (!headline.trim() || !primaryText.trim()) missing.push('ad copy')
  if (!locations.length) missing.push('a location')
  if (!broad && interests.length === 0) missing.push('at least one interest (or switch to Advantage+)')
  const ready = missing.length === 0 && !busy

  // resolve a creative's Meta hash: uploaded already have it; saved ones upload their image URL.
  const hashFor = async (c: Creative): Promise<{ hash: string; type: 'image' | 'video' } | null> => {
    if (c.hash) return { hash: c.hash, type: c.media_type === 'video' ? 'video' : 'image' }
    if (!c.image_url) return null
    const up = await fetch('/api/m4/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: c.image_url }) }).then((r) => r.json()).catch(() => null)
    return up?.hash ? { hash: up.hash, type: 'image' } : null
  }

  const launch = async () => {
    if (!ready) return
    setResult(null)
    try {
      setBusy('uploading')
      const resolveList = async (cs: Creative[]) => (await Promise.all(cs.map(async (c) => { const h = await hashFor(c); return h ? { id: c.id, name: c.brand_name || 'Your ad', pack: 1, type: h.type, hash: h.hash } : null }))).filter(Boolean) as any[]
      const creativesBody = await resolveList(chosen)
      if (!creativesBody.length) { setBusy(''); setResult({ ok: false, msg: 'Couldn’t prepare your creative(s) for Meta — try again or pick another.' }); return }
      // Retargeting/Retention use their OWN creatives if picked, else reuse the main ad.
      const retargetBody = retarget ? (retargetSel.length ? await resolveList(creativesOf(retargetSel)) : creativesBody) : []
      const retainBody = retention ? (retainSel.length ? await resolveList(creativesOf(retainSel)) : creativesBody) : []

      setBusy('launching')
      const body = {
        campaignName: `${chosen[0]?.brand_name || 'New'} — ${OBJECTIVES.find((o) => o.key === objective)?.label || 'Ad'}`,
        creatives: creativesBody,
        interests: broad ? [] : interests.map((i) => ({ id: i.id, name: i.name })),
        budget: String(parseFloat(budget) || 20),
        ageMin, ageMax, gender,
        objective,
        accountId,
        pixelId,
        pageId,
        instagramActorId: page?.instagram?.id || '',
        // Retargeting (warm visitors) + Retention (past buyers) campaigns — reuse the chosen creatives, with
        // their own message (falls back to the main copy). includeRetainer flips the retention campaign on.
        retargetingCreatives: retargetBody,
        retainerCreatives: retainBody,
        includeRetainer: retention,
        retargetingCopy: retarget ? { primaryText: (retargetMsg || primaryText).trim().slice(0, 300), headline: headline.trim().slice(0, 40), cta, destinationUrl: url.trim() } : {},
        retainerCopy: retention ? { primaryText: (retainMsg || primaryText).trim().slice(0, 300), headline: headline.trim().slice(0, 40), cta, destinationUrl: url.trim() } : {},
        websiteUrl: url.trim(),
        headline: headline.trim().slice(0, 40),
        primaryText: primaryText.trim().slice(0, 300),
        cta,
        locations: locations.map((l) => ({ key: l.key, name: l.name, type: l.type })),
        location: locations.find((l) => l.type === 'country')?.key || 'US',
      }
      const r = await fetch('/api/m4/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      setBusy('')
      // Meta needs the account to accept Custom Audiences ToS before retargeting/retention can run.
      if (d.needsCustomAudienceTos && d.tosUrl) { setResult({ ok: !!d.success, msg: d.note || 'Accept Meta’s Custom Audiences Terms, then relaunch so retargeting/retention go out too.', href: d.tosUrl, hrefLabel: 'Open Meta’s accept page →' }); return }
      if (!r.ok || d.error) { setResult({ ok: false, msg: d.error || 'Launch failed — try again.', href: d.needsReconnect ? '/settings' : (r.status === 402 ? '/upgrade' : d.tosUrl || undefined), hrefLabel: 'Fix it →' }); return }
      const total = (d.broad_adsets || 0) + (d.interest_adsets || 0) + (d.retargeting_adsets || 0) + (d.retainer_adsets || 0)
      const kinds = [d.broad_adsets && 'new customers', d.interest_adsets && 'interest audiences', d.retargeting_adsets && 'retargeting', d.retainer_adsets && 'retention'].filter(Boolean).join(', ')
      // "Turn it on" happens in Meta (the ads launched PAUSED there) — deep-link straight to this account's
      // Ads Manager, not our Reports page.
      const adsMgr = `https://www.facebook.com/adsmanager/manage/campaigns?act=${String(accountId || '').replace(/^act_/, '')}`
      setResult({ ok: true, msg: `Your ad is set up on ${d.account || 'Meta'}${kinds ? ` — ${kinds}` : ''} — paused for your review.`, note: total ? `${total} ad set${total === 1 ? '' : 's'} created.` : d.note, href: adsMgr, hrefLabel: 'Review & turn it on in Meta →', external: true })
    } catch { setBusy(''); setResult({ ok: false, msg: 'Something went wrong — try again.' }) }
  }

  // ── shared bits ──
  const input: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 11, padding: '12px 13px', fontSize: 15, fontFamily: SANS, color: INK, background: '#fff', boxSizing: 'border-box', outline: 'none' }
  const label = (t: string, hint?: string) => <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}><span style={{ fontSize: 13, color: INK, fontWeight: 650 }}>{t}</span>{hint && <span style={{ fontSize: 12, color: FAINT }}>{hint}</span>}</div>
  const pill = (on: boolean): React.CSSProperties => ({ border: `1.5px solid ${on ? ORANGE : LINE}`, background: on ? '#fff5f2' : '#fff', color: on ? ORANGE : INK, borderRadius: 999, padding: '8px 15px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: SANS })

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '30px 22px 90px', fontFamily: SANS, color: INK }}>
      {/* header + tabs */}
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 820, letterSpacing: '-.025em' }}>Your ads</h1>
      <p style={{ margin: '7px 0 0', color: SUB, fontSize: 14.5, lineHeight: 1.5 }}>
        {metaConnected === false ? 'Connect your Facebook account to get started.'
          : tab === 'manage' ? 'Everything that’s live. Hit Manage on any ad to scale, pause, duplicate or edit it — Mello does it, you approve.'
          : <>Pick a creative, we pre-fill the rest. Launches paused for your review. {prefilling && <span style={{ color: ORANGE, fontWeight: 700 }}>Setting things up…</span>}</>}
      </p>

      {metaConnected === true && (
        <div style={{ display: 'inline-flex', gap: 4, marginTop: 18, background: INSET, borderRadius: 999, padding: 4 }}>
          {([['launch', 'Launch a new ad'], ['manage', 'Your live ads']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ border: 0, background: tab === k ? '#fff' : 'transparent', color: tab === k ? INK : SUB, boxShadow: tab === k ? '0 1px 3px rgba(20,18,15,.14)' : 'none', borderRadius: 999, padding: '8px 18px', fontSize: 13.5, fontWeight: 750, cursor: 'pointer', fontFamily: SANS }}>{lbl}</button>
          ))}
        </div>
      )}

      {/* file input for uploads */}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; fs.forEach((f) => onUpload(f)) }} />

      {metaConnected !== true ? (
        metaConnected === false ? (
          <div style={{ marginTop: 26, border: `1px solid ${LINE}`, borderRadius: 18, padding: '34px 24px', background: PAPER, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#1877F2', display: 'grid', placeItems: 'center', margin: '0 auto 14px', color: '#fff', fontWeight: 900, fontSize: 24 }}>f</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Connect Facebook to run ads</div>
            <div style={{ fontSize: 14, color: SUB, maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.55 }}>Ads run inside your own Meta ad account — connect once (about a minute) and your ad is a few clicks away.</div>
            <Link href="/connect-meta?next=/m4/quick" style={{ display: 'inline-block', background: ORANGE, color: '#fff', borderRadius: 999, padding: '13px 28px', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}>Connect Facebook →</Link>
          </div>
        ) : <div style={{ marginTop: 44, textAlign: 'center', color: FAINT, fontSize: 14 }}>Checking your Facebook connection…</div>
      ) : tab === 'manage' ? (
        <div style={{ marginTop: 22 }}>
          <FacebookAdsCard initial={{ accounts: [] } as any} ctaHref="/reports" ctaLabel="See the full report" />
        </div>
      ) : (
        <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
          {/* AD ACCOUNT — where this ad runs (scoped to the brand, like Reports). Everything below follows it. */}
          {accounts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: INSET, border: `1px solid ${LINE2}`, borderRadius: 14, padding: '12px 15px', flexWrap: 'wrap' }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: '#1877F2', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 15, flex: 'none' }}>f</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: SUB }}>Ad account</div>
                <div style={{ fontSize: 12.5, color: FAINT }}>Where this ad runs</div>
              </div>
              {accounts.length === 1 ? (
                <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: INK }}>{accounts[0].account_name} <span style={{ color: FAINT, fontWeight: 500 }}>· {accounts[0].currency}</span></div>
              ) : (
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, fontWeight: 600, fontFamily: SANS, color: INK, background: '#fff', cursor: 'pointer', maxWidth: '100%' }}>
                  {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name} · {a.currency}</option>)}
                </select>
              )}
            </div>
          )}

          {/* 1 · YOUR AD */}
          <Section icon={ICONS.ad} n={1} title="Your ad">
            {chosen.length === 0 ? (
              <button onClick={() => setPickerFor('main')} style={{ width: '100%', border: `1.5px dashed ${LINE}`, borderRadius: 14, background: PAPER, padding: '26px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: SUB, fontFamily: SANS }}>
                <span style={{ color: ORANGE }}><Ic d="M12 5v14|M5 12h14" size={22} /></span>
                <span style={{ fontSize: 14.5, fontWeight: 750, color: INK }}>Select your ad{`(s)`}</span>
                <span style={{ fontSize: 12.5, color: FAINT }}>Choose from your creatives, or upload from your computer</span>
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {chosen.map((c) => (
                    <div key={c.id} style={{ position: 'relative', width: 80, height: 100, borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}`, background: INSET }}>
                      {c.media_type === 'video'
                        ? <video src={c.image_url!} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        /* eslint-disable-next-line @next/next/no-img-element */
                        : <img src={c.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      <button onClick={() => toggle(c.id)} aria-label="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 0, background: 'rgba(20,18,15,.72)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setPickerFor('main')} style={{ width: 80, height: 100, borderRadius: 10, border: `1.5px dashed ${LINE}`, background: '#fff', cursor: 'pointer', color: SUB, display: 'grid', placeItems: 'center' }}><Ic d="M12 5v14|M5 12h14" size={20} /></button>
                </div>
                <div style={{ fontSize: 12.5, color: FAINT, marginTop: 9 }}>{chosen.length} selected · they’ll run as separate ads in one campaign</div>
              </div>
            )}
          </Section>

          {/* 2 · GOAL */}
          <Section icon={ICONS.goal} n={2} title="Goal">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {OBJECTIVES.map((o) => {
                const on = objective === o.key
                return (
                  <button key={o.key} onClick={() => setObjective(o.key)} style={{ border: `1.5px solid ${on ? ORANGE : LINE}`, background: on ? '#fff5f2' : '#fff', borderRadius: 13, padding: '13px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: SANS }}>
                    <div style={{ fontSize: 14.5, fontWeight: 780, color: on ? ORANGE : INK }}>{o.label}</div>
                    <div style={{ fontSize: 11.5, color: SUB, marginTop: 2 }}>{o.sub}</div>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* 3 · AUDIENCE */}
          <Section icon={ICONS.people} n={3} title="Audience">
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button onClick={() => setBroad(true)} style={pill(broad)}>✨ Let Meta find buyers</button>
              <button onClick={() => setBroad(false)} style={pill(!broad)}>🎯 Target by interest</button>
            </div>
            {!broad && (
              <div style={{ marginBottom: 14 }}>
                {label('Interests', 'type to search, add a few')}
                {interests.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {interests.map((i) => (
                      <span key={i.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff5f2', border: `1px solid ${ORANGE}44`, color: ORANGE, borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 700 }}>{i.name}<button onClick={() => setInterests((x) => x.filter((y) => y.id !== i.id))} style={{ border: 0, background: 'none', color: ORANGE, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button></span>
                    ))}
                  </div>
                )}
                <input value={iQuery} onChange={(e) => setIQuery(e.target.value)} placeholder="e.g. clean skincare, wellness, yoga…" style={input} />
                {(iSearching || iResults.length > 0) && (
                  <div style={{ marginTop: 6, border: `1px solid ${LINE}`, borderRadius: 11, overflow: 'hidden', background: '#fff' }}>
                    {iSearching && <div style={{ padding: '10px 12px', fontSize: 13, color: FAINT }}>Searching…</div>}
                    {iResults.map((r) => (
                      <button key={r.id} onClick={() => { setInterests((x) => [...x, r]); setIQuery(''); setIResults([]) }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderTop: `1px solid ${LINE2}`, background: '#fff', padding: '10px 12px', fontSize: 13.5, color: INK, cursor: 'pointer', fontFamily: SANS }}>{r.name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                {label('Age')}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select value={ageMin} onChange={(e) => setAgeMin(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{Array.from({ length: 48 }, (_, i) => 18 + i).map((a) => <option key={a} value={a}>{a}</option>)}</select>
                  <span style={{ color: FAINT }}>–</span>
                  <select value={ageMax} onChange={(e) => setAgeMax(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{Array.from({ length: 48 }, (_, i) => 18 + i).map((a) => <option key={a} value={a}>{a}{a === 65 ? '+' : ''}</option>)}</select>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                {label('Gender')}
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ALL', 'WOMEN', 'MEN'] as const).map((g) => <button key={g} onClick={() => setGender(g)} style={{ ...pill(gender === g), flex: 1, textAlign: 'center', padding: '10px 6px' }}>{g === 'ALL' ? 'All' : g === 'WOMEN' ? 'Women' : 'Men'}</button>)}
                </div>
              </div>
            </div>
          </Section>

          {/* 4 · CAMPAIGNS — who to reach (M4 parity: new customers always; + retargeting + retention) */}
          <Section icon={ICONS.people} n={4} title="Who to reach">
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ border: `1.5px solid ${GOOD}55`, background: '#f1faf3', borderRadius: 13, padding: '13px 15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ color: GOOD }}>✓</span>
                  <span style={{ fontSize: 14, fontWeight: 750 }}>New customers</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: GOOD }}>Always on</span>
                </div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, paddingLeft: 26 }}>Prospecting — reach people who’ve never heard of you ({broad ? 'broad Advantage+' : 'by interest'}).</div>
              </div>

              {([
                { kind: 'retarget' as const, on: retarget, set: setRetarget, msg: retargetMsg, setMsg: setRetargetMsg, sel: retargetSel, title: 'Retargeting', sub: 'People who visited or engaged but didn’t buy — the warmest audience.', ph: 'Message for returning visitors — e.g. “Still thinking it over? Here’s 10% off.”' },
                { kind: 'retain' as const, on: retention, set: setRetention, msg: retainMsg, setMsg: setRetainMsg, sel: retainSel, title: 'Retention', sub: 'Past buyers — bring them back for another order.', ph: 'Message for past buyers — e.g. “Time to restock? Members save today.”' },
              ]).map((c) => {
                const pics = creativesOf(c.sel)
                return (
                <div key={c.title} style={{ border: `1.5px solid ${c.on ? ORANGE : LINE}`, background: c.on ? '#fff5f2' : '#fff', borderRadius: 13, padding: '13px 15px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                    <input type="checkbox" checked={c.on} onChange={(e) => { const on = e.target.checked; c.set(on); if (on && !c.msg.trim()) genCampaignCopy(c.kind === 'retarget' ? 'retargeting' : 'retainer', c.setMsg) }} style={{ width: 16, height: 16, accentColor: ORANGE }} />
                    <span style={{ fontSize: 14, fontWeight: 750, color: c.on ? ORANGE : INK }}>{c.title}</span>
                  </label>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, paddingLeft: 26 }}>{c.sub}</div>
                  {c.on && <>
                    <textarea value={c.msg} onChange={(e) => c.setMsg(e.target.value)} rows={2} placeholder={c.ph} style={{ ...input, marginTop: 10, resize: 'vertical', lineHeight: 1.45, fontSize: 13.5 }} />
                    {/* Optional: a DIFFERENT creative for this audience. Empty = reuse the main ad above. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                      {pics.map((p) => (
                        <div key={p.id} style={{ position: 'relative', width: 46, height: 58, borderRadius: 8, overflow: 'hidden', border: `1px solid ${LINE}`, background: INSET }}>
                          {p.media_type === 'video' ? <video src={p.image_url!} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            /* eslint-disable-next-line @next/next/no-img-element */
                            : <img src={p.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          <button onClick={() => setSelFor(c.kind)((s) => s.filter((x) => x !== p.id))} aria-label="Remove" style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', border: 0, background: 'rgba(20,18,15,.72)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                      <button onClick={() => setPickerFor(c.kind)} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: SANS }}>{pics.length ? 'Change creative' : '+ Different creative'}</button>
                      {!pics.length && <span style={{ fontSize: 12, color: FAINT }}>reusing your main ad</span>}
                    </div>
                  </>}
                </div>
              )})}
              {(retarget || retention) && <div style={{ fontSize: 12, color: FAINT }}>Budget is split automatically — ~60% to new customers, ~40% to warm audiences.</div>}
            </div>
          </Section>

          {/* 4 · COPY */}
          <Section icon={ICONS.copy} n={5} title="Ad copy">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -40, marginBottom: 12 }}>
              <button onClick={() => genCopy(true)} disabled={copyBusy} style={{ border: `1px solid ${LINE}`, background: '#fff', color: ORANGE, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 750, cursor: copyBusy ? 'default' : 'pointer', fontFamily: SANS }}>{copyBusy ? 'Writing…' : '✨ Rewrite with AI'}</button>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>{label('Primary text', 'what people read')}<textarea value={primaryText} onChange={(e) => { copyEdited.current = true; setPrimaryText(e.target.value) }} rows={3} placeholder={prefilling ? 'Writing your copy…' : 'Say why they should care…'} style={{ ...input, resize: 'vertical', lineHeight: 1.45 }} /></div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 220 }}>{label('Headline', '≤ 40 chars')}<input value={headline} onChange={(e) => { copyEdited.current = true; setHeadline(e.target.value.slice(0, 40)) }} placeholder="One hard-hitting benefit" style={input} /></div>
                <div style={{ flex: 1, minWidth: 150 }}>{label('Button')}<select value={cta} onChange={(e) => setCta(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{CTAS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</option>)}</select></div>
              </div>
            </div>
          </Section>

          {/* 5 · DESTINATION */}
          <Section icon={ICONS.pin} n={6} title="Where it goes">
            <div style={{ display: 'grid', gap: 14 }}>
              <div>{label('Facebook Page', 'the ad posts from here')}
                {pages.length === 0 ? <div style={{ ...input, color: ORANGE }}>No Page — <Link href="/connect-meta?next=/m4/quick" style={{ color: ORANGE, fontWeight: 700 }}>connect Meta →</Link></div>
                  : <select value={pageId} onChange={(e) => setPageId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.instagram ? ' · + Instagram' : ''}</option>)}</select>}
              </div>
              {/* Location — real Facebook targeting locations (country / region / city). */}
              <div>{label('Location', 'search Facebook — country, region or city')}
                {locations.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {locations.map((l) => (
                      <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff5f2', border: `1px solid ${ORANGE}44`, color: ORANGE, borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 700 }}>{l.name}{l.type !== 'country' && <span style={{ color: FAINT, fontWeight: 500, textTransform: 'capitalize' }}>· {l.type}</span>}<button onClick={() => setLocations((x) => x.filter((y) => y.key !== l.key))} style={{ border: 0, background: 'none', color: ORANGE, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button></span>
                    ))}
                  </div>
                )}
                <input value={locQuery} onChange={(e) => setLocQuery(e.target.value)} placeholder="e.g. Pakistan, Lahore, California…" style={input} />
                {(locSearching || locResults.length > 0) && (
                  <div style={{ marginTop: 6, border: `1px solid ${LINE}`, borderRadius: 11, overflow: 'hidden', background: '#fff' }}>
                    {locSearching && <div style={{ padding: '10px 12px', fontSize: 13, color: FAINT }}>Searching…</div>}
                    {locResults.map((r: any) => (
                      <button key={r.key} onClick={() => { setLocations((x) => [...x, { key: r.key, name: r.name, type: r.type, country_name: r.country_name }]); setLocQuery(''); setLocResults([]) }} style={{ display: 'flex', width: '100%', textAlign: 'left', border: 0, borderTop: `1px solid ${LINE2}`, background: '#fff', padding: '10px 12px', fontSize: 13.5, color: INK, cursor: 'pointer', fontFamily: SANS, gap: 6, alignItems: 'baseline' }}>{r.name}<span style={{ color: FAINT, fontSize: 12, textTransform: 'capitalize' }}>{r.type}{r.country_name && r.type !== 'country' ? ` · ${r.country_name}` : ''}</span></button>
                    ))}
                  </div>
                )}
              </div>
              {pixels.length > 0 && (
                <div>{label('Conversion tracking', 'your Meta pixel')}
                  <select value={pixelId} onChange={(e) => setPixelId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>{pixels.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? ' · active' : ''}</option>)}</select>
                </div>
              )}
              <div>{label('Where clicks go')}<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com" style={input} /></div>
            </div>
          </Section>

          {/* 6 · BUDGET */}
          <Section icon={ICONS.money} n={7} title="Daily budget">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 11, padding: '0 12px', background: '#fff' }}>
                <span style={{ color: SUB, fontSize: 15 }}>{cur.sym}</span>
                <input value={budget} onChange={(e) => { budgetTouched.current = true; setBudget(e.target.value.replace(/[^\d.]/g, '')) }} inputMode="decimal" style={{ border: 0, outline: 0, padding: '13px 6px', fontSize: 17, width: 90, fontFamily: SANS, color: INK, fontWeight: 700 }} />
                <span style={{ color: FAINT, fontSize: 13 }}>/day</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{cur.presets.map((b) => <button key={b} onClick={() => { budgetTouched.current = true; setBudget(b) }} style={{ ...pill(budget === b), padding: '8px 13px' }}>{cur.sym}{b}</button>)}</div>
            </div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 8 }}>In {acctCurrency} — the currency of the selected ad account.</div>
          </Section>

          {/* LAUNCH */}
          <div style={{ position: 'sticky', bottom: 0, background: 'linear-gradient(180deg,rgba(255,255,255,0),#fff 34%)', paddingTop: 18, marginTop: 2 }}>
            <button onClick={launch} disabled={!ready} style={{ width: '100%', border: 0, background: ORANGE, color: '#fff', borderRadius: 14, padding: '15px 24px', fontWeight: 820, fontSize: 15.5, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5, fontFamily: SANS }}>
              {busy === 'uploading' ? 'Preparing…' : busy === 'launching' ? 'Launching…' : '🚀 Launch ad'}
            </button>
            <div style={{ textAlign: 'center', fontSize: 12.5, color: SUB, marginTop: 9 }}>{missing.length ? `Add ${missing.join(', ')}` : `${cur.sym}${parseFloat(budget) || cur.def}/day · ${broad ? 'Advantage+ audience' : `${interests.length} interest${interests.length === 1 ? '' : 's'}`} · created paused for your review`}</div>
          </div>

          {result && (
            <div style={{ border: `1px solid ${result.ok ? 'rgba(18,161,80,.4)' : 'rgba(224,47,6,.35)'}`, background: result.ok ? '#f1faf3' : '#fff5f2', borderRadius: 14, padding: '15px 16px', fontSize: 14.5, color: INK, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 800, color: result.ok ? GOOD : ORANGE }}>{result.ok ? '✓ Ready to go live' : 'Couldn’t launch'}</div>
              <div style={{ marginTop: 4 }}>{result.msg}</div>
              {result.note && <div style={{ marginTop: 6, color: SUB, fontSize: 13 }}>{result.note}</div>}
              {result.href && (result.external
                ? <a href={result.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 10, fontWeight: 800, color: ORANGE, textDecoration: 'none' }}>{result.hrefLabel || 'Open →'}</a>
                : <Link href={result.href} style={{ display: 'inline-block', marginTop: 10, fontWeight: 800, color: ORANGE, textDecoration: 'none' }}>{result.hrefLabel || 'Open →'}</Link>)}
            </div>
          )}
        </div>
      )}

      {/* CREATIVE PICKER MODAL */}
      {pickerFor && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setPickerFor(null) }} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(20,18,15,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 760, maxHeight: '88vh', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', boxShadow: '0 -20px 60px -30px rgba(0,0,0,.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${LINE2}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{pickerFor === 'retarget' ? 'Retargeting creative(s)' : pickerFor === 'retain' ? 'Retention creative(s)' : 'Choose your ad(s)'}</div>
              <span style={{ fontSize: 13, color: FAINT }}>{activeSel.length} selected</span>
              <button onClick={() => setPickerFor(null)} style={{ marginLeft: 'auto', border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '8px 20px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: SANS }}>Done</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto' }}>
              {uploadErr && <div style={{ marginBottom: 12, fontSize: 13, color: ORANGE }}>{uploadErr}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ aspectRatio: '4/5', border: `1.5px dashed ${LINE}`, borderRadius: 12, background: PAPER, cursor: uploading ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: SUB, fontFamily: SANS }}>
                  <span style={{ color: ORANGE }}><Ic d="M12 19V5|M5 12l7-7 7 7" size={22} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 750, color: INK, textAlign: 'center', padding: '0 8px' }}>{uploading ? 'Uploading…' : 'Upload photo or video'}</span>
                  <span style={{ fontSize: 10.5, color: FAINT }}>from your computer</span>
                </button>
                {creatives === null ? <div style={{ color: FAINT, fontSize: 13, alignSelf: 'center' }}>Loading…</div> : allCreatives.map((c) => {
                  const on = activeSel.includes(c.id)
                  return (
                    <button key={c.id} onClick={() => toggle(c.id)} style={{ position: 'relative', padding: 0, border: `2.5px solid ${on ? ORANGE : LINE}`, borderRadius: 12, overflow: 'hidden', background: INSET, cursor: 'pointer', aspectRatio: '4/5' }}>
                      {c.media_type === 'video'
                        ? <video src={c.image_url!} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        /* eslint-disable-next-line @next/next/no-img-element */
                        : <img src={c.image_url!} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                      {c.media_type === 'video' && <span style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 6px' }}>▶ Video</span>}
                      {c.local && <span style={{ position: 'absolute', top: 6, left: 6, background: INK, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 6px' }}>Yours</span>}
                      {on && <span style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>✓</span>}
                    </button>
                  )
                })}
                {creatives && allCreatives.length === 0 && <div style={{ color: FAINT, fontSize: 13, gridColumn: '1/-1' }}>No creatives yet — upload one, or <Link href="/ads-workspace" style={{ color: ORANGE, fontWeight: 700 }}>make an ad →</Link></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
