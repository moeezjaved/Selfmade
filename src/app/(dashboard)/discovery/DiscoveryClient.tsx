'use client'
import { useState, useEffect, useRef, useCallback, useMemo, Component, Fragment, startTransition } from 'react'
import type { ReactNode } from 'react'
import { showSavedToast } from '@/components/motion/SavedToast'
import { Masonry } from 'masonic'
import { cleanCopy } from '@/lib/cleanCopy'

// masonic's virtualizer can throw during fast scroll near the load-more boundary
// (its positioner momentarily indexes past the items array → WeakMap.set(undefined)
// / itemKey on undefined). Without a boundary, that takes down the WHOLE discovery
// page ("Application error"). This catches the throw and REMOUNTS the masonry on the
// next tick — a fresh masonic mount rebuilds its positioner cleanly and recovers,
// so the user sees a brief blink instead of a dead page. Retries are capped.
class MasonryBoundary extends Component<{ children: ReactNode }, { k: number; errored: boolean }> {
  state = { k: 0, errored: false }
  static getDerivedStateFromError() { return { errored: true } }
  componentDidCatch() {
    if (this.state.k < 30) {
      setTimeout(() => this.setState((s) => ({ errored: false, k: s.k + 1 })), 50)
    }
  }
  render() {
    if (this.state.errored) {
      return <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
    }
    return <Fragment key={this.state.k}>{this.props.children}</Fragment>
  }
}
import { Search, ExternalLink, RefreshCw, Bookmark, BookmarkCheck, MoreHorizontal, Info, Link as LinkIcon, Download, Copy, Film } from 'lucide-react'
import CloneModal from './CloneModal'
import CloneVideoModal from './CloneVideoModal'
import { useRouter } from 'next/navigation'
import BrandDrawer from './BrandDrawer'

// ── Types ────────────────────────────────────────────────────
interface Creative {
  position: number
  asset_type: 'image' | 'video'
  r2_url: string
  hash: string | null
  width?: number | null    // original pixel dims → reserve card height (no reflow)
  height?: number | null
  poster_url?: string | null   // video poster frame (FB preview, re-hosted to R2)
}

interface Ad {
  id: string
  pageId: string
  pageName: string
  body: string
  title: string
  caption: string
  snapshotUrl: string
  thumbnailUrl?: string | null
  videoUrl?: string | null
  creatives?: Creative[]    // carousel slides (multi-image ads)
  startDate: string
  stopDate: string | null
  platforms: string[]
  languages: string[]
  mediaType: string
  isActive: boolean
  daysRunning: number
  isAffiliate?: boolean       // ad from another page driving to this brand's site
  affiliateOf?: string | null // canonical brand name this affiliate promotes
  // classified client-side
  format: string
  industries: string[]
  themes: string[]
  langNames: string[]
  // rollup-backed (migration 020)
  performanceScore?: number | null
  performanceTier?: string | null
  niche?: string | null
  creativeReuseCount?: number
  brandActiveAds?: number
  onScreenText?: string | null
}

// ── Classification ───────────────────────────────────────────

const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  ['Apparel & Accessories',   /cloth|fashion|dress|shoes|apparel|outfit|hoodie|jeans|bag|purse|handbag|accessori|shirt|jacket|pants|skirt/i],
  ['Beauty & Personal Care',  /beauty|skincare|makeup|cosmetic|serum|moistur|lipstick|mascara|cream|lotion|facial|glow|anti-ag|fragrance|perfume|cleanser|toner/i],
  ['Baby, Kids & Maternity',  /baby|toddler|kids|children|infant|maternity|pregnant|nursery|diaper|stroller/i],
  ['Food & Beverage',         /food|meal|recipe|restaurant|delivery|snack|drink|coffee|tea|juice|beverage|cuisine|chef|cook|chocolate|candy/i],
  ['Health & Fitness',        /fitness|gym|workout|weight loss|exercise|yoga|pilates|health|wellness|diet|supplement|vitamin|protein|keto/i],
  ['Electronics & Technology',/tech|software|app|device|phone|laptop|computer|electronic|gadget|digital|smart|wireless|battery/i],
  ['Finance & Insurance',     /financ|insur|invest|loan|credit|banking|money|wealth|trading|crypto|tax|mortgage|fund/i],
  ['Home & Garden',           /home|furniture|decor|garden|kitchen|bedroom|clean|interior|house|living room|sofa|rug|curtain/i],
  ['Travel & Tourism',        /travel|hotel|flight|vacation|holiday|tour|destination|trip|resort|cruise|airbnb/i],
  ['Pets',                    /\bpet\b|dog|cat|puppy|kitten|animal|vet|paw|leash|collar|bird|fish tank/i],
  ['Education',               /course|learn|education|training|skill|class|university|degree|certif|bootcamp/i],
  ['Real Estate',             /real estate|property|apartment|rent|buy home|mortgage|listing|realty|condo/i],
  ['Jewelry & Watches',       /jewelry|jewellery|ring|necklace|bracelet|watch|diamond|gold|silver|gem|pendant/i],
  ['Sports & Outdoors',       /sport|outdoor|hiking|camping|running|cycling|tennis|golf|soccer|football|athletic|basketball/i],
  ['Business Services',       /\bbusiness\b|marketing|agency|consult|b2b|enterprise|saas|crm|erp|automation|lead gen/i],
  ['E-Commerce',              /shop now|add to cart|order now|free shipping|buy \d|get yours|limited stock/i],
  ['Charity & NGO',           /charity|nonprofit|donate|ngo|cause|foundation|volunteer|relief/i],
]

const THEME_PATTERNS: [string, RegExp][] = [
  ['Before & After',  /before[\s\S]{0,60}after|after[\s\S]{0,60}before|transformation|results in \d|see the results/i],
  ['Question',        /\?/],
  ['Testimonial',     /\bi (was|tried|used|am|have been|love|hate|switched|started)\b|changed my|my experience|customer says|they said|she said|he said/i],
  ['Announcement',    /introducing|we'?re launching|just dropped|announcing|now available|coming soon|new arrival|meet the new/i],
  ['Sale/Discount',   /\d+\s*%\s*off|\bsale\b|discount|bogo|deal|save \$|free shipping|limited time|offer ends|coupon|promo/i],
  ['Pain Point',      /struggling|tired of|sick of|problem|solution|fix|stop suffering|never again|hate when|can't sleep|hard to/i],
  ['Tutorial',        /how to|step \d|tutorial|guide|learn how|\btip\b|\btricks?\b|what happens when|watch us/i],
  ['Social Proof',    /\d[\d,]+\s*(customer|review|sold|people|order|unit)|trusted by|join \d|rated \d|#1|best seller|award/i],
  ['UGC / Review',    /unboxing|honest review|i bought|first impression|worth it|would i recommend|rating/i],
]

function detectFormat(mediaType: string): string {
  if (!mediaType) return 'Image'
  const m = mediaType.toUpperCase()
  if (m.includes('VIDEO')) return 'Video'
  if (m.includes('CAROUSEL') || m === 'DCO') return 'Carousel'
  return 'Image'
}

function detectIndustries(text: string): string[] {
  const matches = INDUSTRY_KEYWORDS.filter(([, re]) => re.test(text)).map(([name]) => name)
  return matches.length ? matches : ['Other']
}

function detectThemes(text: string): string[] {
  return THEME_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ar: 'Arabic',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
  hi: 'Hindi', tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', fi: 'Finnish', id: 'Indonesian',
  th: 'Thai', vi: 'Vietnamese', uk: 'Ukrainian', ro: 'Romanian',
  el: 'Greek', he: 'Hebrew', cs: 'Czech', hu: 'Hungarian',
}

function classifyAd(raw: any): Ad {
  const text = `${raw.body} ${raw.title} ${raw.caption} ${raw.pageName}`
  // Prefer the format already saved in DB by the indexer; fall back to local detection
  const format = raw.format || detectFormat(raw.mediaType)
  // Prefer DB industries (set by indexer/AI classifier), fall back to local detection
  const industries = (raw.industries && raw.industries.length > 0) ? raw.industries : detectIndustries(text)
  return {
    ...raw,
    thumbnailUrl: raw.thumbnailUrl || raw.thumbnail_url || null,
    videoUrl: raw.videoUrl || raw.video_url || null,
    creatives: raw.creatives || [],
    format,
    industries,
    themes: detectThemes(text),
    langNames: (raw.languages || []).map((c: string) => LANG_NAMES[c] || c.toUpperCase()),
  }
}

// ── Constants ────────────────────────────────────────────────
const PLATFORM_OPTS = ['facebook', 'instagram', 'audience_network', 'messenger']
const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram',
  audience_network: 'Audience Network', messenger: 'Messenger',
}
const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📸', audience_network: '🌐', messenger: '💬',
}

const FORMAT_OPTS = ['Image', 'Video', 'Carousel']
const INDUSTRY_LIST = INDUSTRY_KEYWORDS.map(([name]) => name).concat(['Other'])
const THEME_LIST = THEME_PATTERNS.map(([name]) => name)
const STATUS_OPTS = [{ value: 'ALL', label: 'All' }, { value: 'ACTIVE', label: '🟢 Active' }, { value: 'INACTIVE', label: '⚫ Inactive' }]

const COUNTRIES = [
  { code: 'ALL', name: 'All Countries', flag: '🌍' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
]

const SORT_OPTS = [
  { value: 'recommended', label: '✨ Recommended' },
  { value: 'performance', label: '🏆 Performance' },
  { value: 'newest', label: 'Newest' },
  { value: 'recent', label: 'Most Recent' },
  { value: 'longest', label: 'Longest Running' },
  { value: 'most_used', label: 'Most Used' },
  { value: 'latest_added', label: 'Latest Added' },
  { value: 'oldest', label: 'Oldest First' },
]

// GetHookd-parity: performance tiers + coarse niches (backed by migration 020 rollup)
const TIER_OPTS = [
  { value: 'winning', label: '🏆 Winning' },
  { value: 'optimized', label: '⚡ Optimized' },
  { value: 'growing', label: '📈 Growing' },
  { value: 'scaling', label: '🚀 Scaling' },
  { value: 'testing', label: '🧪 Testing' },
]
// 33-niche taxonomy (GetHookd parity). Values MUST match the brand-level niche
// classifier's enum exactly (worker niche-classify). Ordered roughly by DTC volume.
const NICHE_OPTS = [
  { value: 'Beauty', label: '💄 Beauty' },
  { value: 'Skincare', label: '🧴 Skincare' },
  { value: 'Fashion', label: '👗 Fashion' },
  { value: 'Accessories', label: '👜 Accessories' },
  { value: 'Jewelry & Watches', label: '💍 Jewelry & Watches' },
  { value: 'Health & Wellness', label: '🧘 Health & Wellness' },
  { value: 'Supplements', label: '💊 Supplements' },
  { value: 'Medical', label: '🩺 Medical' },
  { value: 'Sports & Outdoors', label: '🏀 Sports & Outdoors' },
  { value: 'Pets', label: '🐾 Pets' },
  { value: 'Food & Drink', label: '🍔 Food & Drink' },
  { value: 'Home & Garden', label: '🏠 Home & Garden' },
  { value: 'Tech', label: '💻 Tech' },
  { value: 'App / Software', label: '📲 App / Software' },
  { value: 'Subscription Box', label: '📦 Subscription Box' },
  { value: 'Kids & Baby', label: '🍼 Kids & Baby' },
  { value: 'Travel', label: '✈️ Travel' },
  { value: 'Finance', label: '💰 Finance' },
  { value: 'Insurance', label: '🛡️ Insurance' },
  { value: 'Automotive', label: '🚗 Automotive' },
  { value: 'CBD / Cannabis', label: '🌿 CBD / Cannabis' },
  { value: 'Alcohol', label: '🍷 Alcohol' },
  { value: 'Entertainment', label: '🎬 Entertainment' },
  { value: 'Games', label: '🎮 Games' },
  { value: 'Media / News', label: '📰 Media / News' },
  { value: 'Book / Publishing', label: '📚 Book / Publishing' },
  { value: 'Info Products', label: '📈 Info Products' },
  { value: 'Business / Professional', label: '💼 Business / Professional' },
  { value: 'Service Business', label: '🔧 Service Business' },
  { value: 'Real Estate', label: '🏡 Real Estate' },
  { value: 'Charity / Non-Profit', label: '🤝 Charity / Non-Profit' },
  { value: 'Government', label: '🏛️ Government' },
  { value: 'Other', label: '🗂️ Other' },
]

// Creative-DNA filter options (Phase C) — match the classifier enums.
const HOOK_OPTS = ['Pain Point', 'Testimonial', 'Social Proof', 'Before & After', 'Question', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them'].map(v => ({ value: v, label: v }))
const EMOTION_OPTS = ['fear', 'curiosity', 'desire', 'trust', 'urgency', 'hope', 'excitement', 'relatability', 'aspiration', 'guilt', 'pride'].map(v => ({ value: v, label: v }))
const ANGLE_OPTS = ['Pain Point', 'Aspiration', 'Social Proof', 'Authority', 'Scarcity', 'Curiosity', 'Value', 'Story', 'Comparison'].map(v => ({ value: v, label: v }))
const FORMATSTYLE_OPTS = [{ value: 'UGC', label: '🤳 UGC' }, { value: 'Studio / Produced', label: '🎬 Studio / Produced' }, { value: 'Graphic / Text', label: '🔤 Graphic / Text' }, { value: 'Mixed', label: 'Mixed' }]
const VISUALSTYLE_OPTS = ['Selfie / Handheld', 'Bathroom / Mirror', 'Kitchen / Home', 'Outdoor / Lifestyle', 'Studio Product Shot', 'Before & After', 'Text Overlay Graphic', 'Unboxing', 'Talking Head', 'Demo / How-to', 'Flat Lay', 'Lifestyle Person', 'Other'].map(v => ({ value: v, label: v }))
const CTASTYLE_OPTS = [{ value: 'soft', label: 'Soft' }, { value: 'hard', label: 'Hard' }, { value: 'none', label: 'None' }]

// ── FilterDropdown ───────────────────────────────────────────
function FilterDropdown({ label, options, selected, onToggle, onClear, searchable }: {
  label: string
  options: { value: string; label: string; icon?: string }[]
  selected: string[]
  onToggle: (v: string) => void
  onClear: () => void
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // BUG-5: anchor the open panel to the trigger's VIEWPORT position at open time (position:fixed),
  // so a result-grid reflow underneath can't shift the option rows mid-click — which silently
  // selected the neighbouring filter ("Supplements" → "Health & Wellness"). Close on scroll so the
  // fixed panel can't visually detach from its trigger.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Only listen while the panel is OPEN. Previously these (mousedown + a capture-phase scroll
  // listener) were attached on mount for EVERY dropdown — so 6+ filter dropdowns each fired a
  // scroll handler on every grid scroll event, adding real jank. Gating on `open` means zero scroll
  // listeners during normal scrolling (panels are closed), and the scroll handler is passive.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    // Close on PAGE scroll (the menu is position:fixed and would detach) — but NOT when the user is
    // scrolling inside the menu's own option list, which was snapping it shut ("scroll not working").
    const onScroll = (e: Event) => { if (ref.current && ref.current.contains(e.target as Node)) return; setOpen(false) }
    document.addEventListener('mousedown', h)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('scroll', onScroll, { capture: true } as any) }
  }, [open])

  const visible = searchable
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect()
          if (r) setPos({ top: r.bottom + 4, left: r.left })
          setOpen(o => !o)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px',
          background: selected.length ? '#1a3a1a' : '#fff',
          border: `1px solid ${selected.length ? '#1a3a1a' : '#e2e8f0'}`,
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          color: selected.length ? '#dffe95' : '#374151',
          cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
        }}
      >
        {label}
        {selected.length > 0 && (
          <span style={{ background: '#dffe95', color: '#1a3a1a', borderRadius: 100, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>
            {selected.length}
          </span>
        )}
        <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && pos && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000,
          minWidth: 200, maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          {searchable && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          )}
          <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1, minHeight: 0 }}>
            {selected.length > 0 && (
              <button onClick={() => { onClear(); setOpen(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 12, color: '#dc2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear filter
              </button>
            )}
            {visible.map(o => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} style={{ accentColor: '#1a3a1a' }} />
                {o.icon && <span>{o.icon}</span>}
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SortDropdown ─────────────────────────────────────────────
function SortDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const current = SORT_OPTS.find(o => o.value === value) || SORT_OPTS[0]
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        Sort: {current.label} <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, minWidth: 180, padding: '6px 0' }}>
          {SORT_OPTS.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, color: o.value === value ? '#1a3a1a' : '#374151', fontWeight: o.value === value ? 700 : 400, background: o.value === value ? '#f0fdf4' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CountryDropdown ──────────────────────────────────────────
function CountryDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const current = COUNTRIES.find(c => c.code === value) || COUNTRIES[0]
  const visible = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
  )
  const isFiltered = value !== 'ALL'
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
        background: isFiltered ? '#1a3a1a' : '#fff',
        border: `1px solid ${isFiltered ? '#1a3a1a' : '#e2e8f0'}`,
        borderRadius: 8, fontSize: 13, fontWeight: 600,
        color: isFiltered ? '#dffe95' : '#374151',
        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}>
        <span>{current.flag}</span>
        {current.code === 'ALL' ? 'Country' : current.name}
        <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
          minWidth: 220, maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search country…"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {visible.map(c => (
              <button key={c.code} onClick={() => { onChange(c.code); setOpen(false); setSearch('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 14px', fontSize: 13, background: c.code === value ? '#f0fdf4' : 'none',
                  color: c.code === value ? '#1a3a1a' : '#111', fontWeight: c.code === value ? 700 : 400,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                <span style={{ fontSize: 18 }}>{c.flag}</span>
                <span>{c.name}</span>
                {c.code !== 'ALL' && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{c.code}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── NumberInput ──────────────────────────────────────────────
function NumberInput({ label, value, onChange, placeholder, suffix }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; suffix?: string
}) {
  const isActive = value !== '' && value !== '0'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        border: `1px solid ${isActive ? '#1a3a1a' : '#e2e8f0'}`,
        borderRadius: 8, background: isActive ? '#1a3a1a' : '#fff',
        padding: '0 8px', height: 30,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#dffe95' : '#6b7280', whiteSpace: 'nowrap' }}>{label}</span>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={0}
          style={{
            width: 36, border: 'none', outline: 'none', fontSize: 12, fontWeight: 600,
            background: 'transparent', color: isActive ? '#dffe95' : '#111',
            fontFamily: 'inherit', padding: 0,
          }}
        />
        {suffix && <span style={{ fontSize: 11, color: isActive ? '#dffe95' : '#9ca3af', whiteSpace: 'nowrap' }}>{suffix}</span>}
        {isActive && (
          <button onClick={() => onChange('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dffe95', fontSize: 14, padding: '0 0 0 2px', lineHeight: 1 }}>×</button>
        )}
      </div>
    </div>
  )
}

// ── Save Modal ───────────────────────────────────────────────
function SaveModal({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  const [boards, setBoards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/discovery/boards').then(r => r.json()).then(d => {
      setBoards(d.boards || [])
      setLoading(false)
    })
  }, [])

  const saveToBoard = async (boardId: string) => {
    if (saved.includes(boardId)) return
    setSaving(boardId)
    await fetch('/api/discovery/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: boardId, ad_id: ad.id, page_id: ad.pageId,
        page_name: ad.pageName, snapshot_url: ad.snapshotUrl, ad_data: ad,
      }),
    })
    setSaved(prev => [...prev, boardId])
    setSaving(null)
    showSavedToast('Saved to Board')
  }

  const createAndSave = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch('/api/discovery/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const data = await res.json()
    if (data.board) {
      setBoards(prev => [data.board, ...prev])
      await saveToBoard(data.board.id)
      setNewName('')
    }
    setCreating(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, minWidth: 320, maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 16 }}>💾 Save Ad to Board</div>

        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: '20px 0' }}>Loading boards…</div>
        ) : boards.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>No boards yet — create one below.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
            {boards.map(b => {
              const isSaved = saved.includes(b.id)
              return (
                <button key={b.id} onClick={() => saveToBoard(b.id)} disabled={isSaved || saving === b.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: isSaved ? '#f0fdf4' : '#f8fafc', border: `1px solid ${isSaved ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: 10, cursor: isSaved ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 20 }}>{b.emoji}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#111' }}>{b.name}</span>
                  {isSaved ? <span style={{ color: '#22c55e', fontSize: 18 }}>✓</span> : saving === b.id ? <span style={{ fontSize: 12, color: '#9ca3af' }}>…</span> : null}
                </button>
              )
            })}
          </div>
        )}

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>+ New Board</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createAndSave()}
              placeholder="Board name…"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={createAndSave} disabled={creating || !newName.trim()}
              style={{ padding: '8px 14px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {creating ? '…' : 'Save'}
            </button>
          </div>
        </div>

        <button onClick={onClose} style={{ marginTop: 14, width: '100%', padding: '8px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }}>
          Done
        </button>
      </div>
    </div>
  )
}

// ── InfiniteScrollSentinel ─────────────────────────────────────
// Invisible — silently triggers onLoad when scrolled near.
// Preloads early so cards appear seamlessly with no spinner.
function InfiniteScrollSentinel({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading) onLoadRef.current()
      },
      { rootMargin: '2500px' } // pre-load the next page ~2.5 screens early so its
                               // eager-loaded images finish before the user scrolls there
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  // Zero-height invisible sentinel — no spinner, no layout shift
  return <div ref={ref} style={{ width: '100%', height: 1 }} />
}

// ── AdCard ───────────────────────────────────────────────────
const AVATAR_COLORS = ['#1a3a1a','#1e3a5f','#4a1942','#3a1a1a','#1a3a38','#2d3a1a','#3a2a1a']
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}

// ── 3-dots menu (Atria-style: Ad details, Copy link, Download) ──
function MoreMenu({ ad }: { ad: Ad }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(ad.snapshotUrl)
      setCopied(true)
      setTimeout(() => { setCopied(false); setOpen(false) }, 1200)
    } catch { /* clipboard unavailable */ }
  }

  // Download primary asset (first carousel slide, else thumbnail/video)
  const downloadAsset = () => {
    const firstImage = ad.creatives?.find(c => c.asset_type === 'image')?.r2_url || ad.thumbnailUrl
    const firstVideo = ad.creatives?.find(c => c.asset_type === 'video')?.r2_url || ad.videoUrl
    const url = firstVideo || firstImage
    if (!url) return
    // Open in new tab — browser handles save
    const a = document.createElement('a')
    a.href = url
    a.download = `${ad.pageName || 'creative'}-${ad.id}.${url.endsWith('.mp4') ? 'mp4' : 'jpg'}`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="More"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 160, zIndex: 100, padding: 4, fontFamily: 'inherit' }}>
          <a href={`/discovery/${ad.id}`} onClick={() => setOpen(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, color: '#1f2937', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Info size={14} /> Ad details
          </a>
          <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, color: '#1f2937', textDecoration: 'none', borderRadius: 6, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <ExternalLink size={14} /> View on Meta
          </a>
          <button onClick={copyLink}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, color: '#1f2937', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <LinkIcon size={14} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button onClick={downloadAsset}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, color: '#1f2937', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Download size={14} /> Download
          </button>
        </div>
      )}
    </div>
  )
}

// ── ScriptsMenu (video hover overlay) ──
function ScriptsMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: '#dffe95',
          color: '#1a3a1a',
          border: 'none',
          padding: '7px 14px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        Scripts ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: 180,
          padding: 4, zIndex: 100,
        }}>
          <button
            onClick={() => { setOpen(false) }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12, color: '#1f2937', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            📝 Transcribe Script
          </button>
          <button
            onClick={() => { setOpen(false) }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12, color: '#1f2937', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            ✨ Create similar scripts
          </button>
        </div>
      )}
    </div>
  )
}

// ── Image CDN (Atria layer 4: right-sized srcset, no Vercel-optimizer cost) ──
// Creatives live on R2. To avoid shipping full-size images to every card, route them
// through Cloudflare Image Resizing (R2 is already Cloudflare → cheapest at scale).
// Set NEXT_PUBLIC_IMG_CDN to a Cloudflare custom-domain host that fronts the bucket
// with Image Resizing enabled (e.g. "cdn.tryselfmade.ai"). Until then images pass
// through full-size — the no-reflow box already keeps scroll smooth; this just trims
// bytes once the CDN is wired (a one-env-var switch, no code change).
const IMG_CDN = process.env.NEXT_PUBLIC_IMG_CDN || ''
// Transformations cost per-resize at scale; default OFF. With IMG_CDN set but transforms OFF we
// serve the R2 object DIRECTLY through the Cloudflare custom domain (free egress, edge-cached) —
// full-res but no per-image fee. Opt into resizing later with NEXT_PUBLIC_IMG_TRANSFORM=1, or move
// to drain-side pre-resized thumbnails (option B) for small-AND-free at 5M scale.
const IMG_TRANSFORM = process.env.NEXT_PUBLIC_IMG_TRANSFORM === '1'
// pub-*.r2.dev is ALREADY on Cloudflare's edge. NEXT_PUBLIC_IMG_DIRECT=1 serves R2 creatives from
// that URL as-is (no weserv proxy hop = no 1.2s latency), with ZERO setup — no custom domain / DNS.
// Full-res, but latency was the killer. (Custom domain via IMG_CDN later removes r2.dev rate limits.)
const IMG_DIRECT = process.env.NEXT_PUBLIC_IMG_DIRECT === '1'
const R2_HOST_RE = /^https?:\/\/[^/]*(r2\.dev|r2\.cloudflarestorage\.com)/i
// Grid cards render at ~340px wide → 480px covers 1.4× DPR; the srcset lets the
// browser pick 256/384/480/640 by column width & screen density.
const IMG_WIDTHS = [256, 384, 480, 640]
// Resize EVERY grid thumbnail. Why this matters: r2.dev serves the ORIGINAL
// creative (often 1080px+, several hundred KB) — downloading that per card is
// exactly why cards sat blank/"loading" while you scrolled (Atria/GetHookd serve
// ~480px webp, so they paint instantly).
//  • If NEXT_PUBLIC_IMG_CDN is set → Cloudflare Image Resizing on our own domain
//    (cheapest at scale, R2 is already Cloudflare). This is the production target.
//  • Otherwise → fall back to the weserv.nl edge image proxy so thumbnails are
//    small TODAY without waiting on the custom-domain setup. It caches at the edge
//    and emits webp; the card's skeleton + "image unavailable" fallback keep a rare
//    miss graceful. Flip the env var later and Cloudflare takes over — no code change.
const cdnAt = (url: string, w: number) => {
  if (!url) return url
  if (IMG_CDN) {
    const isR2 = R2_HOST_RE.test(url)
    // R2 creatives → serve via our Cloudflare custom domain (same bucket/key, just swap the host).
    if (isR2) {
      const path = url.replace(/^https?:\/\/[^/]+/, '')   // keep the /<key>
      // Transforms ON → Cloudflare Image Resizing (same-zone source). OFF → direct edge-cached serve.
      return IMG_TRANSFORM
        ? `https://${IMG_CDN}/cdn-cgi/image/width=${w},quality=75,format=auto${path}`
        : `https://${IMG_CDN}${path}`
    }
    // Non-R2 (raw Meta CDN URLs from un-drained ads): if transforms are on, Cloudflare can fetch +
    // resize the external URL; otherwise fall through to weserv so it's still small.
    if (IMG_TRANSFORM) return `https://${IMG_CDN}/cdn-cgi/image/width=${w},quality=75,format=auto/${url}`
  }
  // No custom domain: serve R2 creatives straight from r2.dev (already Cloudflare edge) to skip
  // weserv's latency. Non-R2 (Meta) URLs still go through weserv so they're resized + hotlink-safe.
  if (IMG_DIRECT && R2_HOST_RE.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}
const cdnSrc = (url: string) => cdnAt(url, 480)
const cdnSrcSet = (url: string) =>
  url ? IMG_WIDTHS.map((w) => `${cdnAt(url, w)} ${w}w`).join(', ') : undefined

// ── CarouselViewer ─ swipeable preview for multi-image ads ──
function CarouselViewer({ ad, avatarBg, iframeVisible }: { ad: Ad; avatarBg: string; iframeVisible: boolean }) {
  const router = useRouter()
  const [cloneOpen, setCloneOpen] = useState(false)
  const [videoCloneOpen, setVideoCloneOpen] = useState(false)
  // Build slide list: prefer creatives[] (full carousel), fall back to legacy single image/video
  type Slide = { type: 'image' | 'video'; url: string; width?: number | null; height?: number | null; poster?: string | null }
  const slides: Slide[] = useMemo(() => {
    if (ad.creatives && ad.creatives.length > 0) {
      const sorted = [...ad.creatives].sort((a, b) => {
        if (a.asset_type !== b.asset_type) return a.asset_type === 'image' ? -1 : 1
        return a.position - b.position
      })
      return sorted.map((c) => ({ type: c.asset_type, url: c.r2_url, width: c.width, height: c.height, poster: c.poster_url }))
    }
    const fallback: Slide[] = []
    if (ad.thumbnailUrl && !ad.thumbnailUrl.includes('graph.facebook.com')) {
      fallback.push({ type: 'image', url: ad.thumbnailUrl })
    }
    if (ad.videoUrl) fallback.push({ type: 'video', url: ad.videoUrl })
    return fallback
  }, [ad])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const total = slides.length
  const slide = slides[idx]

  // Reset load state whenever the visible slide changes (carousel nav)
  useEffect(() => { setImgLoaded(false); setImgError(false) }, [slide?.url])

  // Play INLINE (not navigate). stopPropagation so the card's onClick (→ detail page)
  // doesn't fire — clicking the play button was opening the detail page instead of
  // playing the video right there in the grid.
  // Mount + autoplay the video INLINE (stopPropagation so the card's onClick → detail
  // page doesn't fire). The <video> isn't in the DOM until `playing` flips, so nothing
  // downloads until this runs.
  const startPlay = (e?: React.MouseEvent) => { e?.stopPropagation(); setPlaying(true) }
  const next = (e?: React.MouseEvent) => { e?.stopPropagation(); setIdx(i => (i + 1) % total); setPlaying(false) }
  const prev = (e?: React.MouseEvent) => { e?.stopPropagation(); setIdx(i => (i - 1 + total) % total); setPlaying(false) }

  // No real creative on R2 → don't render anything.
  // Discovery API already filters these out, but defense in depth.
  if (!slide) return null

  // ── No-reflow card height (Atria technique) ────────────────────────────────
  // Reserve the EXACT visual height BEFORE any media loads, from the first
  // creative's stored pixel dims (padding-bottom = h/w ratio). The image/video then
  // fills that box absolutely, so there is ZERO layout shift when it decodes — the
  // masonry never reflows. All carousel slides share this one box (cover-fit) so
  // navigating doesn't change the card height. Fallback when dims are missing
  // (legacy creatives pre-backfill): square for images, 4:5 for video.
  const primary = slides[0]
  const rawPct = (primary?.width && primary?.height) ? (primary.height / primary.width) * 100 : null
  const aspectPct = rawPct != null
    ? Math.min(178, Math.max(56, rawPct))   // clamp 16:9 … 9:16 so nothing is absurdly tall/short
    : (primary?.type === 'video' ? 125 : 100)
  // Real video poster (FB preview frame, re-hosted to R2), resized via the CDN. When
  // present the card shows the actual first frame instead of the branded placeholder,
  // and the video only downloads on click (preload off) → fast + cheap.
  const posterSrc = (slide?.type === 'video' && slide.poster) ? cdnSrc(slide.poster) : undefined
  return (
    <>
    {cloneOpen && <CloneModal ad={{ id: ad.id, pageId: ad.pageId, pageName: ad.pageName }} onClose={() => setCloneOpen(false)} />}
    {videoCloneOpen && <CloneVideoModal sourceAdId={ad.id} sourcePoster={slide?.poster || undefined} onClose={() => setVideoCloneOpen(false)} />}
    <div
      className="ad-card-visual"
      onClick={() => router.push(`/discovery/${ad.id}`)}
      onMouseEnter={() => { if (slide?.type === 'video') setPlaying(true) }}
      onMouseLeave={() => { if (slide?.type === 'video') setPlaying(false) }}
      style={{
        position: 'relative', width: '100%', paddingBottom: `${aspectPct}%`,
        background: '#f1f3f5', overflow: 'hidden', lineHeight: 0, cursor: 'pointer',
      }}
    >
      {slide.type === 'image' ? (
        <>
          {/* skeleton shimmer while the image loads */}
          {!imgLoaded && !imgError && (
            <div className="thumb-skeleton" style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
          )}
          {imgError ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#adb5bd', fontSize: 13 }}>
              image unavailable
            </div>
          ) : (
            <img
              src={cdnSrc(slide.url)}
              srcSet={cdnSrcSet(slide.url)}
              sizes="(max-width: 700px) 50vw, 343px"
              alt={ad.pageName}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', display: 'block',
                opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.12s linear', zIndex: 2,
              }}
            />
          )}
        </>
      ) : (
        <>
          {/* RESTING STATE (not playing): show the real poster frame if we have one,
              otherwise the branded gradient+initial placeholder. The <video> is NOT
              mounted yet — so nothing downloads until the user hits play. */}
          {!playing && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 1,
              background: `linear-gradient(140deg, ${avatarBg} 0%, #14181c 130%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {/* brand initial watermark (visible until the poster paints; always visible if no poster) */}
              {!imgLoaded && (
                <span style={{ position: 'absolute', fontSize: 72, fontWeight: 900, color: 'rgba(255,255,255,0.10)', letterSpacing: '-0.05em', userSelect: 'none', lineHeight: 1 }}>
                  {(ad.pageName || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              )}
              {posterSrc && (
                <img
                  src={posterSrc}
                  alt={ad.pageName}
                  loading="lazy"
                  decoding="async"
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgLoaded(true)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.12s linear' }}
                />
              )}
            </div>
          )}
          {/* VIDEO — only mounted once the user hits play, so it never downloads upfront. */}
          {playing && (
            <video
              ref={videoRef}
              key={slide.url}
              src={slide.url}
              autoPlay
              controls
              playsInline
              preload="auto"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', outline: 'none', border: 'none', background: '#000', zIndex: 2 }}
              onEnded={() => setPlaying(false)}
            />
          )}
          {/* Play overlay — the button PLAYS inline (stopPropagation); clicking around it opens detail. */}
          {!playing && (
            <div onClick={() => router.push(`/discovery/${ad.id}`)}
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.18)', cursor: 'pointer', zIndex: 3 }}>
              <button onClick={startPlay} aria-label="Play" style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.25)', border: 'none', cursor: 'pointer', padding: 0 }}>
                <span style={{ fontSize: 20, marginLeft: 3, color: '#111' }}>▶</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Carousel arrows + dots */}
      {total > 1 && (
        <>
          <button onClick={prev} aria-label="Previous"
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none',
              width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, padding: 0, zIndex: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}>‹</button>
          <button onClick={next} aria-label="Next"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none',
              width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, padding: 0, zIndex: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}>›</button>
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 4 }}>
            {slides.map((_, i) => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === idx ? '#fff' : 'rgba(255,255,255,0.5)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
              }} />
            ))}
          </div>
          {/* Slide counter */}
          <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 4 }}>
            {idx + 1} / {total}
          </div>
        </>
      )}

      {/* Format badge (top-right) */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          {slide.type === 'video' ? '🎬 Video' : total > 1 ? '🔁 Carousel' : '🖼 Image'}
        </span>
      </div>

      {/* Hover overlay — bottom-up gradient ("shadow from below, faded by ~half height") + a lime
          Clone-ad pill anchored bottom-left, matching the mockup. Hidden once a video is PLAYING so
          it never covers the video or its native controls (scrubber/volume/fullscreen). */}
      <div
        className="hover-overlay"
        style={{
          position: 'absolute', inset: 0,
          // Bottom gradient backs the Clone pill on both images (Clone ad) and videos (Clone video).
          background: 'linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.30) 26%, rgba(0,0,0,0) 52%)',
          display: playing ? 'none' : 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-start',
          padding: 12,
          opacity: 0,
          transition: 'opacity .18s',
          pointerEvents: 'none',
          zIndex: 6,
        }}
      >
        {slide.type === 'video' && (
          <div style={{ position: 'absolute', top: 10, left: 10, pointerEvents: 'auto' }}>
            <ScriptsMenu />
          </div>
        )}
        {slide.type !== 'video' && (
        <button
          onClick={(e) => { e.stopPropagation(); setCloneOpen(true) }}
          style={{
            pointerEvents: 'auto',
            background: '#dffe95',
            color: '#14281a',
            border: 'none',
            padding: '8px 14px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#eaffad')}
          onMouseLeave={e => (e.currentTarget.style.background = '#dffe95')}
        >
          <Copy size={14} strokeWidth={2.4} /> Clone ad
        </button>
        )}
      </div>

      {/* Clone-video pill for VIDEO cards — bottom-left (matching the image "Clone ad" pill), in its
          OWN hover overlay NOT gated by `playing`, so it stays visible while the video autoplays on
          hover. Sits just above the native controls bar so it doesn't cover the scrubber. */}
      {slide.type === 'video' && (
        <div className="hover-overlay" style={{ position: 'absolute', bottom: 44, left: 12, opacity: 0, transition: 'opacity .18s', pointerEvents: 'none', zIndex: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setVideoCloneOpen(true) }}
            style={{ pointerEvents: 'auto', background: '#dffe95', color: '#14281a', border: 'none', padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#eaffad')}
            onMouseLeave={e => (e.currentTarget.style.background = '#dffe95')}
          >
            <Film size={14} strokeWidth={2.4} /> Clone video
          </button>
        </div>
      )}
    </div>
    </>
  )
}

function AdCard({ ad, onBrandClick, onBrandHover, onBrandLeave }: { ad: Ad; onBrandClick?: (pageId: string, name: string) => void; onBrandHover?: (pageId: string, el: HTMLElement) => void; onBrandLeave?: () => void }) {
  const router = useRouter()
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Brand profile picture — always available, shown instantly as placeholder
  // graph.facebook.com/{pageId}/picture redirects to the actual CDN image
  const brandPicture = ad.pageId ? `https://graph.facebook.com/${ad.pageId}/picture?type=large` : null

  const isBrandLogo = (url: string | null | undefined) =>
    !!url && url.includes('graph.facebook.com')

  const [videoUrl] = useState<string | null>(ad.videoUrl ?? null)
  const [playing, setPlaying] = useState(false)
  const [iframeVisible, setIframeVisible] = useState(false)
  // "Why Winning?" popup uses fixed positioning (computed on hover) so it ESCAPES the card's
  // overflow:hidden — otherwise it gets clipped at the card edge.
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Lazy-load the snapshot iframe when the card enters the viewport
  useEffect(() => {
    if (!ad.snapshotUrl || videoUrl) return
    const el = previewRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIframeVisible(true); obs.disconnect() } },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ad.snapshotUrl, videoUrl])

  const daysText = ad.daysRunning > 365
    ? `${Math.floor(ad.daysRunning / 365)}y ${Math.floor((ad.daysRunning % 365) / 30)}mo`
    : ad.daysRunning > 30
    ? `${Math.floor(ad.daysRunning / 30)}mo ${ad.daysRunning % 30}d`
    : ad.daysRunning > 0 ? `${ad.daysRunning}d` : 'New'

  const initials = ad.pageName?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const avatarBg = avatarColor(ad.pageName || '')
  // Template-body ads (DPA/catalog) store raw `{{product.brand}}` tokens, not real
  // copy — showing the literal template looks broken. cleanCopy strips the tokens
  // (even when mixed with real text), falling back to vision-recovered on-screen
  // text, then title, only if the body was nothing but tokens.
  const bodyText = cleanCopy(ad.body, ad.onScreenText, ad.title)
  const isLong = bodyText.length > 220
  const displayBody = expanded || !isLong ? bodyText : bodyText.slice(0, 220) + '…'

  return (
    <>
    {showSaveModal && <SaveModal ad={ad} onClose={() => { setShowSaveModal(false); setIsSaved(true) }} />}
    <div
      /* NO entrance animation here: masonic virtualizes + remounts cards on every scroll tick, so an
         `animate-fade-up` (opacity 0→1) would REPLAY on each remount = the "flashing/flickering" during
         scroll. The fade is a one-time entrance effect that virtualization turns into a per-scroll strobe.
         Cards just appear; no fade. (Diagnosed via instrumentation 2026-06-29.) */
      style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s, transform .2s', cursor: 'default' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
    >
      {/* ── Brand header (compact) ── */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarBg, color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, flexShrink: 0, letterSpacing: '-0.3px', overflow: 'hidden', position: 'relative' }}>
          {brandPicture ? (
            <>
              <span style={{ position: 'absolute' }}>{initials}</span>
              <img
                src={brandPicture}
                alt={ad.pageName}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </>
          ) : (
            initials
          )}
        </div>
        <button onClick={() => onBrandClick?.(ad.pageId, ad.pageName)}
          onMouseEnter={(e) => onBrandHover?.(ad.pageId, e.currentTarget as HTMLElement)}
          onMouseLeave={onBrandLeave}
          style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
          {ad.pageName || 'Unknown Brand'}
        </button>
        {ad.isAffiliate && (
          <span title={ad.affiliateOf ? `Affiliate ad promoting ${ad.affiliateOf}` : 'Affiliate ad'}
            style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: '.02em', color: '#9a3412', background: '#ffedd5', border: '1px solid #fed7aa', padding: '2px 6px', borderRadius: 100, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            ↗ Affiliate
          </span>
        )}
        {/* Performance tier badge — hover shows HOW it's scored, with this ad's real signals.
            (A user's #1 question is "how do you know it's winning?" — answer it on hover.) */}
        {(ad.performanceTier === 'winning' || ad.performanceTier === 'optimized') && (
          <span
            style={{ position: 'relative', flexShrink: 0, display: 'inline-flex', fontSize: 9, fontWeight: 800, letterSpacing: '.02em', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 100, textTransform: 'uppercase', cursor: 'help',
              color: ad.performanceTier === 'winning' ? '#166534' : '#92600a',
              background: ad.performanceTier === 'winning' ? '#dcfce7' : '#fef9c3',
              border: `1px solid ${ad.performanceTier === 'winning' ? '#bbf7d0' : '#fde68a'}` }}
            onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTipPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 230) }) }}
            onMouseLeave={() => setTipPos(null)}>
            {ad.performanceTier === 'winning' ? '🏆 Winning' : '⚡ Optimized'}
            {tipPos && (
              <span style={{ position: 'fixed', top: tipPos.top, left: tipPos.left, width: 214, zIndex: 9999,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: '10px 11px',
                fontSize: 11, lineHeight: 1.45, color: '#334155', textTransform: 'none', letterSpacing: 0, fontWeight: 400, textAlign: 'left', pointerEvents: 'none' }}>
                <span style={{ display: 'block', fontWeight: 800, fontSize: 11.5, color: '#0f172a', marginBottom: 5 }}>
                  {ad.performanceTier === 'winning' ? '🏆 Why “Winning”?' : '⚡ Why “Optimized”?'}
                </span>
                <span style={{ display: 'block', marginBottom: 6 }}>A percentile rank across our <b>entire</b> library — it rewards <b>proven</b> ads, not guesses:</span>
                <span style={{ display: 'block', marginBottom: 6 }}>
                  📅 <b>{ad.daysRunning}d</b> running <span style={{ color: '#94a3b8' }}>— longevity (40%)</span><br/>
                  🔁 creative reused <b>{ad.creativeReuseCount ?? 0}×</b> <span style={{ color: '#94a3b8' }}>— re-run = it works (25%)</span><br/>
                  📊 brand runs <b>{ad.brandActiveAds ?? 0}</b> active ads <span style={{ color: '#94a3b8' }}>— scale (20%)</span>
                </span>
                <span style={{ display: 'block', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Score {Math.round((ad.performanceScore ?? 0) * 100)}/100 · must run ≥14 days to qualify</span>
                <span style={{ display: 'block', fontSize: 10, color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: 5 }}>ⓘ Meta doesn’t publish impressions — so we rank by public signals advertisers can’t fake (how long it runs, how often it’s reused, brand scale).</span>
              </span>
            )}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
          <button onClick={() => setShowSaveModal(true)} title="Save to board"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSaved ? '#1a3a1a' : '#9ca3af', padding: 3, borderRadius: 4, transition: 'color .15s', display: 'inline-flex' }}>
            <span key={isSaved ? 'saved' : 'unsaved'} style={{ display: 'inline-flex', animation: isSaved ? 'savepop .3s ease' : 'none' }}>
              {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            </span>
          </button>
          <MoreMenu ad={ad} />
        </div>
      </div>

      {/* ── Date range (compact) ── */}
      <div style={{ padding: '0 10px 6px', fontSize: 10, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db', animation: ad.isActive ? 'livepulse 2s infinite' : 'none' }} />
        <span>
          {ad.startDate ? new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          {' - '}
          {ad.stopDate ? new Date(ad.stopDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present'}
        </span>
        {/* Reuse — how many ad placements run THIS same creative (deduped into one card). A high
            number = a creative the brand is scaling hard across countries/retailers. */}
        {(ad.creativeReuseCount ?? 0) > 1 && (
          <span title={`This creative runs as ${ad.creativeReuseCount} separate ads (across countries / retailers) — shown once here`}
            style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: '#3730a3', background: '#e0e7ff', border: '1px solid #c7d2fe', padding: '1px 6px', borderRadius: 100, whiteSpace: 'nowrap' }}>
            ↻ {ad.creativeReuseCount} placements
          </span>
        )}
      </div>

      {/* ── Ad copy body (compact) ── */}
      {bodyText && (
        <div style={{ padding: '0 10px 8px', fontSize: 12, color: '#1f2937', lineHeight: 1.4 }}>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: expanded ? 'none' : 2, WebkitBoxOrient: 'vertical' }}>{bodyText}</div>
          {isLong && (
            <button onClick={() => setExpanded(e => !e)}
              style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0 0', fontFamily: 'inherit', fontWeight: 600 }}>
              {expanded ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}

      {/* ── Visual preview (carousel-aware) — clickable to detail page ── */}
      <div
        ref={previewRef}
        onClick={(e) => {
          // Don't navigate if user clicked an interactive child (button, video controls, etc.)
          const target = e.target as HTMLElement
          if (target.closest('button, a, video')) return
          router.push(`/discovery/${ad.id}`)
        }}
        style={{ cursor: 'pointer' }}
      >
        <CarouselViewer ad={ad} avatarBg={avatarBg} iframeVisible={iframeVisible} />
      </div>

      {/* ── Destination card (Atria-style, compact) ── */}
      {(ad.caption || ad.title) && (
        <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, background: '#fff' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {ad.caption && (
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'lowercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ad.caption}
              </div>
            )}
            {ad.title && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#111', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ad.title}
              </div>
            )}
          </div>
          <a
            href={ad.snapshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: 6,
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              color: '#111',
              textDecoration: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {(ad as any).cta || 'Learn more'}
          </a>
        </div>
      )}

      {/* No bottom tags — Atria keeps cards minimal. Format/industry shown in filters. */}
    </div>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────
export default function DiscoveryPage() {
  const router = useRouter()
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'adcopy' | 'brand' | 'category'>('adcopy')
  const [chipTip, setChipTip] = useState<{ label: string; top: number; left: number } | null>(null)  // preset-chip explainer popup
  const [rawAds, setRawAds] = useState<Ad[]>([])
  // Mirror of rawAds + a bounded "empty page" counter for infinite-scroll stall recovery (Bug 11):
  // a loadMore window that returns only already-seen creatives appends 0 rows, so the scroll sentinel
  // never re-fires and the feed stalls. When that happens we auto-advance to the next window.
  const rawAdsRef = useRef<Ad[]>([])
  const emptyStreakRef = useRef(0)
  useEffect(() => { rawAdsRef.current = rawAds }, [rawAds])
  const [loading, setLoading] = useState(true)  // start in loading → grid shows the skeleton from
  // the first render (not the empty state) until the initial fetch lands, so the load reads as a
  // smooth skeleton→cards instead of blank/empty→sudden-burst.
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  // Server-side filters (trigger re-fetch)
  const [sort, setSort] = useState('recommended')
  const [status, setStatus] = useState('ALL')
  const [platforms, setPlatforms] = useState<string[]>([])
  // Default ALL — we crawl country=ALL (worldwide), so per-country filtering isn't
  // active yet. Showing everything by default avoids hiding ads behind a US filter.
  const [country, setCountry] = useState('ALL')

  // Client-side filters (applied to loaded ads instantly)
  const [format, setFormat] = useState<string[]>([])
  const [industry, setIndustry] = useState<string[]>([])
  const [language, setLanguage] = useState<string[]>([])
  const [theme, setTheme] = useState<string[]>([])
  const [minDaysStr, setMinDaysStr] = useState('')        // → server run_time min (days_running ≥ N)
  const [minBrandAdsStr, setMinBrandAdsStr] = useState('') // → server active_ads_count (brand_active_ads ≥ N)
  // GetHookd-parity filters (rollup-backed, server-side)
  const [tiers, setTiers] = useState<string[]>([])
  const [niches, setNiches] = useState<string[]>([])
  const [adsPerBrandStr, setAdsPerBrandStr] = useState('')
  const [minReuseStr, setMinReuseStr] = useState('')
  // Creative-DNA filters (Phase C)
  const [hookTypes, setHookTypes] = useState<string[]>([])
  const [emotions, setEmotions] = useState<string[]>([])
  const [angles, setAngles] = useState<string[]>([])
  const [formatStyles, setFormatStyles] = useState<string[]>([])
  const [visualStyles, setVisualStyles] = useState<string[]>([])
  const [ctaStyles, setCtaStyles] = useState<string[]>([])

  // Top brands strip
  const [topBrands, setTopBrands] = useState<{ pageId: string; name: string; adCount: number; picture: string | null }[]>([])
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [hoverBrand, setHoverBrand] = useState<string | null>(null)
  const [hoverRect, setHoverRect] = useState<{ left: number; top: number } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openHover = (pid: string, el: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const r = el.getBoundingClientRect()
    const W = 300, estH = 300, vw = window.innerWidth, vh = window.innerHeight
    let left = r.left; if (left + W > vw - 12) left = vw - W - 12; if (left < 12) left = 12
    let top = r.bottom + 8
    if (top + estH > vh - 12 && r.top - estH - 8 > 12) top = r.top - estH - 8
    setHoverRect({ left, top }); setHoverBrand(pid)
  }
  const closeHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHoverBrand(null), 140) }
  const keepHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }
  // Responsive masonry column count.
  const [gridCols, setGridCols] = useState(4)
  useEffect(() => {
    const calc = () => { const w = window.innerWidth; setGridCols(w < 700 ? 2 : w < 1050 ? 3 : w < 1450 ? 4 : 5) }
    calc(); window.addEventListener('resize', calc); return () => window.removeEventListener('resize', calc)
  }, [])
  // masonic measures the DOM to position cards — the server can't replicate that, so SSR vs client
  // diverge → React hydration error (#418/#423) → the boundary discards + remounts the grid: the
  // "feed vanishes then comes back" flash. Render the masonry ONLY after mount so it never SSRs.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // Followed brands (for the Follow button on the hover card).
  const [followed, setFollowed] = useState<Set<string>>(new Set())
  useEffect(() => { fetch('/api/follows').then(r => r.json()).then(d => setFollowed(new Set(d.pageIds || []))).catch(() => {}) }, [])
  const toggleFollow = async (pageId: string, name: string) => {
    setFollowed(prev => { const s = new Set(prev); s.has(pageId) ? s.delete(pageId) : s.add(pageId); return s })  // optimistic
    try {
      const r = await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, brandName: name, action: 'toggle' }) })
      const d = await r.json()
      setFollowed(prev => { const s = new Set(prev); d.following ? s.add(pageId) : s.delete(pageId); return s })
    } catch { /* keep optimistic */ }
  }

  // Search dropdown
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownBrands, setDropdownBrands] = useState<{ pageId: string; name: string; picture: string | null; category: string; adCount: number | string }[]>([])
  const [dropdownLoading, setDropdownLoading] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced brand search for dropdown
  useEffect(() => {
    if (!searchInput.trim() || searchInput.trim().length < 2) {
      setDropdownBrands([])
      return
    }
    const timer = setTimeout(async () => {
      setDropdownLoading(true)
      try {
        const res = await fetch(`/api/discovery/pages?q=${encodeURIComponent(searchInput.trim())}`)
        const data = await res.json()
        setDropdownBrands(data.pages || [])
      } catch {
        setDropdownBrands([])
      } finally {
        setDropdownLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Time filter (All time, 7d, 30d, 90d, 180d)
  const [timeDays, setTimeDays] = useState(0)

  // Brand drawer
  const [selectedBrand, setSelectedBrand] = useState<{ pageId: string; name: string } | null>(null)

  const [searchSource, setSearchSource] = useState<'indexed' | 'live'>('indexed')
  const [dbPage, setDbPage] = useState(0)
  const [dbTotal, setDbTotal] = useState(0)
  const [totalInDB, setTotalInDB] = useState(0)

  const fetchAds = useCallback(async (reset = true, cursor?: string, forcePage?: number) => {
    setLoading(true)
    setError('')
    const page = reset ? 0 : (forcePage ?? dbPage + 1)
    if (reset) setDbPage(0)

    try {
      // ── Try our indexed DB first ──
      const dbParams = new URLSearchParams({
        q: query, mode: searchMode, sort, status,
        page: String(page),
        // When a brand is selected, filter by its exact page_id (not page_name).
        // A single Meta page can run partnership/branded-content ads under several
        // display names (e.g. Mars Men's page also shows "Chuck Liddell", "Thrillist").
        // Keying on page_id captures ALL of the brand's ads and avoids name drift.
        ...(searchMode === 'brand' && selectedBrand?.pageId
          ? { pageId: selectedBrand.pageId, brandName: selectedBrand.name }
          : {}),
        ...(platforms.length ? { platforms: platforms.join(',') } : {}),
        ...(format.length === 1 ? { format: format[0] } : {}),
        // Multi-select filters now applied SERVER-side (was browser-only → only
        // filtered the 40 loaded ads). Send all selected so they cover the full set.
        ...(industry.length ? { industry: industry.join(',') } : {}),
        ...(theme.length ? { theme: theme.join(',') } : {}),
        // (language stays client-side until language-detection lands — DB stores
        //  ISO codes but the UI picker uses display names.)
        ...(timeDays > 0 ? { days: String(timeDays) } : {}),
        // GetHookd-parity (rollup-backed, server-side)
        ...(tiers.length ? { performance_scores: tiers.join(',') } : {}),
        ...(niches.length ? { niche: niches.join('|') } : {}),          // '|' — niche names contain commas
        ...(parseInt(minBrandAdsStr) > 0 ? { active_ads_count: String(parseInt(minBrandAdsStr)) } : {}),
        ...(parseInt(minDaysStr) > 0 ? { run_time: `${parseInt(minDaysStr)}+` } : {}),
        ...(parseInt(minReuseStr) > 0 ? { min_reuse: String(parseInt(minReuseStr)) } : {}),
        ...(parseInt(adsPerBrandStr) > 0 ? { ads_per_brand: String(parseInt(adsPerBrandStr)) } : {}),
        // Creative-DNA filters (Phase C)
        ...(hookTypes.length ? { hook_type: hookTypes.join(',') } : {}),
        ...(emotions.length ? { emotion: emotions.join(',') } : {}),
        ...(angles.length ? { angle: angles.join(',') } : {}),
        ...(formatStyles.length ? { format_style: formatStyles.join(',') } : {}),
        ...(visualStyles.length ? { visual_style: visualStyles.join(',') } : {}),
        ...(ctaStyles.length ? { cta_style: ctaStyles.join(',') } : {}),
      })
      // Robust fetch+parse. A timed-out query can 500 with a NON-JSON body ("An error occurred"),
      // which threw "Unexpected token 'A'… is not valid JSON" on .json(). Parse defensively, and
      // treat any transient error as retryable — retry ONCE silently before showing a banner, so a
      // brief index-busy blip (e.g. right after toggling filters) self-heals instead of flashing an error.
      const runSearch = async (): Promise<{ ok: boolean; data: any }> => {
        try {
          const r = await fetch(`/api/discovery/db-search?${dbParams}`)
          let d: any = null
          try { d = await r.json() } catch { d = null }   // non-JSON error page → null
          const transient = !r.ok || d == null || d?.searchMethod === 'error'
          return { ok: !transient, data: d }
        } catch { return { ok: false, data: null } }      // network error → retryable
      }
      let { ok: searchOk, data: dbData } = await runSearch()
      if (!searchOk) {
        await new Promise(res => setTimeout(res, 900))     // brief backoff, then one silent retry
        ;({ ok: searchOk, data: dbData } = await runSearch())
      }
      if (!searchOk) {
        // Only surface the banner on a FRESH search (reset). A scroll-append blip must NOT blow away
        // the grid the user is already looking at or flash an error — just stop paginating quietly
        // (it retries on the next scroll). This was the "scroll down then up → error + 0 ads" bug.
        setHasMore(false)
        if (reset) { setError('Search hit a snag — the index was busy. Try again in a moment.'); setDbTotal(0) }
        return
      }
      dbData = dbData || {}

      if (!dbData.error && dbData.ads?.length > 0) {
        // We have indexed results — use them
        const classified = dbData.ads.map((ad: any) => classifyAd({
          ...ad, mediaType: ad.format || '',
        }))
        // PRELOAD this page's thumbnails into the browser cache NOW. The page is fetched ~2.5 screens
        // AHEAD of the viewport (eager prefetch + 2500px sentinel), so kicking off the image loads here
        // means each card's image is already decoded by the time it scrolls into view → it renders
        // instantly instead of the grey-placeholder-then-flash pop-in. (The slow weserv image proxy
        // ~1.2s is why cards were appearing before their image; warming the cache early hides it.)
        if (typeof window !== 'undefined') {
          for (const a of classified) {
            const c = (a as any).creatives?.[0]
            const u = c && (c.asset_type === 'video' ? c.poster_url : c.r2_url)
            if (u) { const im = new window.Image(); im.decoding = 'async'; im.src = cdnSrc(u) }
          }
        }
        const applyResults = () => {
          // Cross-page dedup: drop ads whose hash was already shown
          setRawAds(prev => {
            if (reset) return classified
            // Key by creative hash (so the SAME creative reused across many ad_ids
            // shows once), falling back to ad id (so a re-fetched page can't dupe an
            // ad that happens to have no hash yet). Both guard the offset-pagination
            // overlap where page N re-returns creatives already shown on page N-1.
            const dedupKey = (a: Ad) =>
              (a as any).image_hash || (a as any).video_hash || `id:${a.id}`
            const seen = new Set<string>()
            for (const a of prev) seen.add(dedupKey(a))
            const newOnes = classified.filter((a: Ad) => {
              const k = dedupKey(a)
              if (seen.has(k)) return false
              seen.add(k)
              return true
            })
            return [...prev, ...newOnes]
          })
          setDbTotal(dbData.total || 0)
          setTotalInDB(dbData.totalInDB || 0)
          setSearchSource('indexed')
          setNextCursor(null)
          // Stall recovery: if THIS loadMore window contributed no new creative (all dupes) but the
          // server says there's more, keep advancing so the feed doesn't freeze. Bounded so a genuinely
          // exhausted feed (or a bad hash run) can't loop forever; falls back to the sentinel otherwise.
          if (!reset && dbData.hasMore) {
            const dedupKey2 = (a: Ad) => (a as any).image_hash || (a as any).video_hash || `id:${a.id}`
            const seen2 = new Set(rawAdsRef.current.map(dedupKey2))
            const anyNew = classified.some((a: Ad) => !seen2.has(dedupKey2(a)))
            if (!anyNew) {
              emptyStreakRef.current += 1
              if (emptyStreakRef.current <= 6) setTimeout(() => loadMoreRef.current(), 160)
            } else { emptyStreakRef.current = 0 }
          } else { emptyStreakRef.current = 0 }
        }
        // The page CURSOR and hasMore must advance SYNCHRONOUSLY — never inside the startTransition
        // below. If they're deferred, the next loadMore fires with a stale `dbPage`, re-requests the
        // same page, and the cross-page dedup drops every row → infinite scroll silently stalls.
        setDbPage(page)
        setHasMore(dbData.hasMore)
        // A fresh search (reset) is urgent → render immediately. A loadMore APPEND is non-urgent:
        // wrap the heavy list append in startTransition so React renders the ~15 new overscan cards
        // at LOW priority and can interrupt to keep scroll at 60fps — cards appear a beat later
        // instead of blocking the main thread.
        if (reset) applyResults()
        else startTransition(applyResults)
        return
      }

      // No indexed results. Do NOT fall back to the live Meta Ads Library — its
      // results ignore our filters and are full of spam/arbitrage ads (cloaked
      // domains, fake "surveys", unrelated niches). Discovery only ever shows our
      // own curated, crawled ads. Empty search → clean empty state; exhausted
      // scroll → just stop. (Use admin → Brands → Preview to vet uncrawled brands.)
      if (reset) setRawAds([])
      setHasMore(false)
      setNextCursor(null)
      // Don't wipe the running total when a deep loadMore page comes back empty
      // (genuine end of feed) — only reset it on a fresh search.
      setDbTotal(prev => dbData.total || (reset ? 0 : prev))
      setTotalInDB(dbData.totalInDB || 0)
      setSearchSource('indexed')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, searchMode, sort, status, platforms, country, format, industry, theme, dbPage, timeDays, selectedBrand?.pageId, tiers, niches, minBrandAdsStr, minDaysStr, minReuseStr, adsPerBrandStr, hookTypes, emotions, angles, formatStyles, visualStyles, ctaStyles])

  // Fetch ads when query/filters change. BOTH browse (empty query) and search go
  // through fetchAds so EVERY server filter (niche, performance tier, brand-ads,
  // run-time, reuse, ads-per-brand) applies in both modes. Previously browse used a
  // separate minimal fetch that ignored the new filters → e.g. picking Niche did
  // nothing on an empty search. (dbPage is intentionally NOT a dep — paginating must
  // not reset the grid; fetchAds(true) always loads page 0.)
  useEffect(() => {
    fetchAds(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchMode, sort, status, platforms, country, format, industry, theme, timeDays, selectedBrand?.pageId, tiers, niches, minBrandAdsStr, minDaysStr, minReuseStr, adsPerBrandStr, hookTypes, emotions, angles, formatStyles, visualStyles, ctaStyles])

  // TOP BRANDS strip — computed from the ACTUAL loaded results so it always matches
  // the grid (and sums to the matching count), including semantic-matched brands a
  // separate server query would miss. Counts grow as more pages load via infinite scroll.
  useEffect(() => {
    // Build the brand strip from the loaded feed — on the DEFAULT feed too, not just search.
    // Count = the brand's total active ads (brandActiveAds, rollup-backed) so the chips read like
    // the mockup ("2,777 ads"), falling back to the loaded-in-feed count when that's unavailable.
    const m: Record<string, { pageId: string; name: string; total: number; loaded: number; picture: string | null }> = {}
    for (const ad of rawAds) {
      if (!ad.pageId) continue
      if (!m[ad.pageId]) m[ad.pageId] = { pageId: ad.pageId, name: ad.pageName, total: 0, loaded: 0, picture: null }
      m[ad.pageId].loaded++
      if (ad.brandActiveAds && ad.brandActiveAds > m[ad.pageId].total) m[ad.pageId].total = ad.brandActiveAds
    }
    const list = Object.values(m).map(b => ({ pageId: b.pageId, name: b.name, adCount: b.total || b.loaded, picture: b.picture }))
    setTopBrands(list.sort((a, b) => b.adCount - a.adCount).slice(0, 20))
    setBrandsLoading(false)
  }, [rawAds])

  // Collect available languages from loaded ads
  const availableLanguages = useMemo(() => {
    const set = new Set<string>()
    rawAds.forEach(ad => ad.langNames.forEach(l => { if (l) set.add(l) }))
    return Array.from(set).sort()
  }, [rawAds])

  const minDays = parseInt(minDaysStr) || 0
  const minBrandAds = parseInt(minBrandAdsStr) || 0

  // Apply client-side filters
  const filteredAds = useMemo(() => {
    return rawAds.filter(ad => {
      if (!ad || !ad.id) return false   // never feed masonic a null/undefined item (it crashes itemKey)
      if (format.length && !format.includes(ad.format)) return false
      if (industry.length && !ad.industries.some(i => industry.includes(i))) return false
      if (language.length && !ad.langNames.some(l => language.includes(l))) return false
      if (theme.length && !ad.themes.some(t => theme.includes(t))) return false
      // Run-time (days_running ≥) and brand-ads (brand_active_ads ≥) are now applied
      // SERVER-side against catalog-wide counts — no client re-filter (the old loaded-
      // count check wrongly hid valid server results).
      return true
    })
  }, [rawAds, format, industry, language, theme])

  // Masonry remount signature. masonic's positioner caches per-index geometry; when
  // a filter SHRINKS the result set without a remount, its cached range still points
  // past the now-shorter items array → it reads `items[staleIndex]` (undefined) and
  // does WeakMap.set(undefined) → throw (the old "client-side exception"). The fix:
  // give Masonry a `key` that changes whenever a NEW result set is fetched, so it
  // gets a clean positioner. This MUST mirror the fetchAds(true) effect deps exactly
  // — every server-side filter — or a filter that changes the data but not the key
  // would desync the positioner again. (load-more keeps the key stable → no remount,
  // so infinite scroll still appends smoothly.) The error boundary stays as a backstop.
  const gridKey = useMemo(() => [
    query, searchMode, selectedBrand?.pageId || '', sort, status, country, timeDays,
    platforms.join(','), format.join(','), industry.join(','), language.join(','), theme.join(','),
    tiers.join(','), niches.join('|'), minBrandAdsStr, minDaysStr, minReuseStr, adsPerBrandStr,
    hookTypes.join(','), emotions.join(','), angles.join(','),
    formatStyles.join(','), visualStyles.join(','), ctaStyles.join(','),
  ].join('|'), [query, searchMode, selectedBrand?.pageId, sort, status, country, timeDays,
    platforms, format, industry, language, theme, tiers, niches, minBrandAdsStr, minDaysStr, minReuseStr,
    adsPerBrandStr, hookTypes, emotions, angles, formatStyles, visualStyles, ctaStyles])

  // ── Virtualized masonry plumbing (masonic) ──────────────────────────────
  // Route the (non-memoized) card handlers through a ref so the masonry render
  // component stays stable — otherwise masonic re-renders every visible card on
  // each parent render.
  const cardHandlers = useRef({ setSelectedBrand, openHover, closeHover })
  cardHandlers.current = { setSelectedBrand, openHover, closeHover }
  const MasonryCard = useMemo(() => {
    const Card = ({ data: ad }: { index: number; data: Ad; width: number }) => {
      // Defensive: masonic's virtualizer can momentarily hand us an undefined item
      // when the items array grows mid-scroll (during infinite-load). Without this
      // guard, AdCard reads ad.creatives/etc. on undefined → crashes the whole page.
      if (!ad) return null
      return (
        <AdCard
          ad={ad}
          onBrandClick={(pid, name) => cardHandlers.current.setSelectedBrand({ pageId: pid, name })}
          onBrandHover={(pid, el) => cardHandlers.current.openHover(pid, el)}
          onBrandLeave={() => cardHandlers.current.closeHover()}
        />
      )
    }
    Card.displayName = 'MasonryCard'
    return Card
  }, [])
  // Infinite load. masonic's useInfiniteLoader does NOT work here — it only fires
  // when it renders an index BEYOND the loaded array, but we only ever render the
  // items we have (no placeholders), so it never triggers. Instead use onRender
  // directly: masonic calls it with the rendered [start, stop] range; when the
  // user scrolls within ~12 of the end of the loaded set, fetch the next page.
  // The loadingMoreRef guard prevents double-fetch before `loading` state flips.
  const loadingMoreRef = useRef(false)
  const loadMoreRef = useRef<() => void>(() => {})
  loadMoreRef.current = () => {
    if (loadingMoreRef.current || loading || !hasMore || searchSource !== 'indexed') return
    loadingMoreRef.current = true
    Promise.resolve(fetchAds(false, undefined, dbPage + 1)).finally(() => { loadingMoreRef.current = false })
  }
  const handleMasonryRender = useCallback((_start: number, stopIndex: number, items: Ad[]) => {
    if (stopIndex >= items.length - 12) loadMoreRef.current()
  }, [])

  // Seamless scroll without the jitter: prefetch ONE page ahead eagerly (a buffer is ready before
  // the user scrolls), then let the 2500px scroll sentinel take over (it loads ~2.5 screens early).
  // Eager-loading 3 pages at once made the masonry re-settle in visible bursts; 1 keeps a buffer
  // with a single gentle append. (Page 1 is snapshot-backed → instant.)
  const EAGER_PAGES = 1
  useEffect(() => {
    if (!loading && !loadingMoreRef.current && hasMore && searchSource === 'indexed' && dbPage < EAGER_PAGES) {
      loadMoreRef.current()
    }
  }, [dbPage, loading, hasMore, searchSource, rawAds.length])

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  const activeFilterCount = format.length + industry.length + language.length + theme.length
    + (status !== 'ALL' ? 1 : 0) + platforms.length + (minDays > 0 ? 1 : 0) + (minBrandAds > 0 ? 1 : 0)
    + tiers.length + niches.length + ((parseInt(minReuseStr) || 0) > 0 ? 1 : 0) + ((parseInt(adsPerBrandStr) || 0) > 0 ? 1 : 0)
    + hookTypes.length + emotions.length + angles.length + formatStyles.length + visualStyles.length + ctaStyles.length

  const isPermError = error.toLowerCase().includes('permission') || error.toLowerCase().includes('application does not')

  // CLIENT-ONLY render. This whole page is client-data driven (everything loads via useEffect) and
  // some of its first-paint content diverged server↔client → React hydration errors #418/#423/#425,
  // which made the feed "vanish then return". Rendering a static placeholder until mounted means the
  // server HTML and the first client render are identical (nothing dynamic), so there's no hydration
  // step to fail. After mount the real UI renders client-side. (Dashboard = auth-gated, no SEO cost.)
  if (!mounted) {
    // Skeleton (not blank grey) for the pre-mount frame, identical to the route-level loading skeleton
    // and the grid skeleton below → the whole load reads as one continuous skeleton→cards, with no
    // flash of empty space between the chunk loading and the data landing.
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '14px 24px' }}>
        <div style={{ height: 38, width: 360, maxWidth: '60%', background: '#e9edf2', borderRadius: 10, marginBottom: 16 }} className="shimmer" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px,100%), 1fr))', gap: 14, alignItems: 'start' }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e9edf2', overflow: 'hidden' }}>
              <div style={{ aspectRatio: i % 3 === 0 ? '3 / 4' : i % 3 === 1 ? '1 / 1' : '4 / 5', background: '#e9edf2' }} className="shimmer" />
              <div style={{ padding: 12 }}>
                <div style={{ height: 10, background: '#e9edf2', borderRadius: 6, marginBottom: 7, width: '72%' }} className="shimmer" />
                <div style={{ height: 9, background: '#eef1f5', borderRadius: 6, width: '45%' }} className="shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes fadeUp { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } } .hide-scrollbar::-webkit-scrollbar { display: none } .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none }`}</style>

      {/* Brand Drawer */}
      {selectedBrand && (
        <BrandDrawer
          pageId={selectedBrand.pageId}
          pageName={selectedBrand.name}
          onClose={() => setSelectedBrand(null)}
        />
      )}

      {/* Brand hover preview card (Atria-style) — single floating instance, shared by the
          TOP BRANDS strip and every ad-card brand name. Resolves data from rawAds. */}
      {hoverBrand && hoverRect && (() => {
        const hbAds = rawAds.filter(a => a.pageId === hoverBrand)
        const hbName = hbAds[0]?.pageName || topBrands.find(b => b.pageId === hoverBrand)?.name || 'Brand'
        const hue = (hbName.charCodeAt(0) || 65) * 7 % 360
        const thumbs = hbAds.map(a => a.thumbnailUrl || a.creatives?.[0]?.r2_url).filter(Boolean).slice(0, 3)
        const isFollowed = followed.has(hoverBrand)
        const viewAds = () => { setSearchInput(hbName); setQuery(hbName); setSearchMode('brand'); setSelectedBrand(null); setHoverBrand(null) }
        return (
          <div onMouseEnter={keepHover} onMouseLeave={closeHover}
            style={{ position: 'fixed', top: hoverRect.top, left: hoverRect.left, width: 300, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 14px 36px rgba(0,0,0,0.18)', zIndex: 300, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: `hsl(${hue},50%,85%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: `hsl(${hue},50%,30%)`, overflow: 'hidden', flexShrink: 0 }}>
                <img src={`https://graph.facebook.com/${hoverBrand}/picture?type=large`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hbName}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{hbAds.length} ad{hbAds.length === 1 ? '' : 's'} in results</div>
              </div>
            </div>
            {thumbs.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {thumbs.map((t, i) => <img key={i} src={t as string} alt="" style={{ width: '33%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 8, background: '#f1f3f5' }} />)}
              </div>
            )}
            <button onClick={() => toggleFollow(hoverBrand, hbName)}
              style={{ width: '100%', padding: '9px', marginBottom: 8, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, border: isFollowed ? '1px solid #1a3a1a' : '1px solid #ef4444', background: isFollowed ? '#f0fdf4' : '#fff', color: isFollowed ? '#1a3a1a' : '#ef4444' }}>
              {isFollowed ? '✓ Following' : '♡ Follow'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={viewAds} style={{ flex: 1, padding: '9px', borderRadius: 9, border: 'none', background: '#1a3a1a', color: '#dffe95', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>View ads</button>
              <button onClick={() => { window.open(`/discovery/brand/${hoverBrand}`, '_blank', 'noopener'); setHoverBrand(null) }} style={{ flex: 1, padding: '9px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Details</button>
            </div>
          </div>
        )
      })()}

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 40 }}>

        {/* Row 1: title + nav + search + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ marginRight: 4, flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>Ad Discovery</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Live creative intelligence from Meta</div>
          </div>

          {/* Sub-nav tabs */}
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 9, padding: 3, flexShrink: 0 }}>
            {[
              { label: '🔍 Explore', href: '/discovery' },
              { label: '🏷️ Brands', href: '/discovery/brands' },
            ].map(tab => (
              <a key={tab.href} href={tab.href}
                style={{
                  padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                  background: tab.href === '/discovery' ? '#fff' : 'transparent',
                  color: tab.href === '/discovery' ? '#111' : '#6b7280',
                  textDecoration: 'none',
                  boxShadow: tab.href === '/discovery' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>
                {tab.label}
              </a>
            ))}
          </div>
          {/* Search with dropdown */}
          <div ref={searchContainerRef} style={{ flex: 1, maxWidth: 520, position: 'relative' }}>
            <form onSubmit={e => { e.preventDefault(); if (searchInput.trim()) { setQuery(searchInput); setShowDropdown(false) } }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={15} style={{ position: 'absolute', left: 12, color: '#9ca3af', pointerEvents: 'none' }} />
                <input
                  value={searchInput}
                  onChange={e => { setSearchInput(e.target.value); setShowDropdown(true) }}
                  onFocus={() => { if (searchInput.trim()) setShowDropdown(true) }}
                  onKeyDown={e => { if (e.key === 'Escape') setShowDropdown(false) }}
                  placeholder="Search for ads or brands with AI…"
                  style={{ width: '100%', padding: '9px 36px', border: `1.5px solid ${showDropdown && searchInput ? '#1a3a1a' : '#e2e8f0'}`, borderRadius: showDropdown && searchInput ? '10px 10px 0 0' : 10, fontSize: 14, outline: 'none', fontFamily: 'inherit', background: '#f8fafc', color: '#111', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                />
                {searchInput && (
                  <button type="button" onClick={() => { setSearchInput(''); setQuery(''); setShowDropdown(false) }}
                    style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>×</button>
                )}
              </div>
            </form>

            {/* Dropdown */}
            {showDropdown && searchInput.trim().length >= 1 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 14px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.13)', zIndex: 200, overflow: 'hidden' }}>

                {/* Search type suggestions */}
                <div style={{ padding: '4px 6px 4px' }}>
                  {([
                    { label: 'Ad copy', key: 'adcopy' as const, hint: 'Ads that mention this keyword' },
                    { label: 'Brand', key: 'brand' as const, hint: 'Brands with this name' },
                    { label: 'Categories', key: 'category' as const, hint: 'Ads in this industry/niche' },
                  ]).map(opt => (
                    <button key={opt.key}
                      onMouseDown={e => {
                        e.preventDefault()
                        setSearchMode(opt.key)
                        setQuery(searchInput)
                        // For category mode, auto-apply matching industry filter
                        if (opt.key === 'category') {
                          const q = searchInput.toLowerCase()
                          const matched = INDUSTRY_LIST.filter(ind => ind.toLowerCase().includes(q) || q.includes(ind.toLowerCase().split(' ')[0]))
                          if (matched.length) setIndustry(matched.slice(0, 3))
                        }
                        setShowDropdown(false)
                      }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        <span style={{ fontWeight: 600 }}>{opt.label}</span>
                        <span style={{ color: '#9ca3af', fontWeight: 400 }}> contains </span>
                        <span style={{ fontWeight: 600 }}>"{searchInput}"</span>
                      </span>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 8, flexShrink: 0 }}>{opt.hint}</span>
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: '#f1f5f9' }} />

                {/* Brand results */}
                <div style={{ padding: '6px 6px 4px' }}>
                  {dropdownLoading && (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, border: '2px solid #e2e8f0', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                      Searching brands…
                    </div>
                  )}
                  {!dropdownLoading && dropdownBrands.map(brand => (
                    <button key={brand.pageId}
                      onMouseDown={e => {
                        e.preventDefault()
                        // Clicking a brand suggestion opens that brand's full analytics VIEW
                        // (/discovery/brand — overview, hooks, personas, angles…). NOT the Brand Spy
                        // tracked-brand page: viewing from search must not imply spying or light up
                        // the Brand Spy menu. Tracking a brand is an explicit "Spy this brand" action.
                        setShowDropdown(false)
                        router.push(`/discovery/brand/${brand.pageId}`)
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {/* Avatar */}
                      {brand.picture
                        ? <img src={brand.picture} alt={brand.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>🏷️</div>
                      }
                      {/* Name + meta */}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand.name}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                          {/* Meta icon */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
                          <span>Meta ad library</span>
                          {brand.adCount !== undefined && brand.adCount !== 0 && (
                            <span style={{ color: '#374151', fontWeight: 600 }}>· {typeof brand.adCount === 'number' ? brand.adCount.toLocaleString() : brand.adCount} Ads</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  {/* See more brands */}
                  {!dropdownLoading && dropdownBrands.length > 0 && (
                    <button
                      onMouseDown={e => { e.preventDefault(); setQuery(searchInput); setShowDropdown(false) }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '9px 12px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#1877F2', marginTop: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      See more brands
                    </button>
                  )}
                  {!dropdownLoading && dropdownBrands.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>No brands found — try searching by ad copy above</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => { if (query.trim()) fetchAds(true) }} disabled={loading || !query.trim()}
            title={query.trim() ? 'Refresh results' : 'Enter a search term first'}
            style={{ padding: '8px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer', color: query.trim() ? '#374151' : '#9ca3af', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: !query.trim() ? 0.5 : 1 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Preset chips (GetHookd-style quick filter combos) */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 }}>
          {[
            { label: '🏆 Best of the Month', tip: 'The top-percentile ads of the last 30 days. "Winning" = ranked across our whole library by how long an ad runs (advertisers kill losers fast), how often the brand re-runs the same creative, and brand scale — must run ≥14 days. Meta doesn’t publish impressions, so we rank by signals advertisers can’t fake.', apply: () => { setTiers(['winning']); setNiches([]); setTimeDays(0); setSort('performance') } },
            { label: '🔥 Winning ads', tip: 'Ads in the top percentile of our library. Scored by longevity (how long it runs), creative reuse (how often the brand re-runs it), and brand scale — must run ≥14 days to qualify. Meta hides impressions, so we rank by public signals advertisers can’t fake.', apply: () => { setTiers(['winning']); setSort('performance') } },
            { label: '📊 Brands · 100+ active ads', apply: () => { setMinBrandAdsStr('100') } },
            { label: '💄 Beauty ads', apply: () => { setNiches(['Beauty']) } },
            { label: '👗 Fashion ads', apply: () => { setNiches(['Fashion']) } },
          ].map((p: { label: string; tip?: string; apply: () => void }) => (
            <button key={p.label} onClick={p.apply}
              onMouseEnter={p.tip ? (e) => { const r = e.currentTarget.getBoundingClientRect(); setChipTip({ label: p.label, top: r.bottom + 5, left: Math.min(r.left, window.innerWidth - 280) }) } : undefined}
              onMouseLeave={p.tip ? () => setChipTip(null) : undefined}
              style={{ position: 'relative', padding: '5px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e2e8f0', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              {p.label}
              {p.tip && chipTip?.label === p.label && (
                <span style={{ position: 'fixed', top: chipTip.top, left: chipTip.left, width: 270, zIndex: 9999,
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: '11px 12px',
                  fontSize: 11.5, lineHeight: 1.5, color: '#475569', fontWeight: 400, textAlign: 'left', pointerEvents: 'none' }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: 12, color: '#0f172a', marginBottom: 5 }}>How “Winning” is calculated</span>
                  {p.tip}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filter toolbar — every filter visible, uniform + evenly spaced. Wraps to tidy rows on
            narrower widths (rowGap gives each wrapped row breathing space). Sort pinned right. */}
        <div style={{ display: 'flex', gap: 8, rowGap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Time filter (segmented) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', flexShrink: 0 }}>
            {[
              { label: 'All time', days: 0 },
              { label: '7d', days: 7 },
              { label: '30d', days: 30 },
              { label: '90d', days: 90 },
              { label: '180d', days: 180 },
            ].map(f => (
              <button key={f.days} onClick={() => setTimeDays(f.days)}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: timeDays === f.days ? '#1a3a1a' : 'transparent',
                  color: timeDays === f.days ? '#dffe95' : '#6b7280',
                  border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* All filters inline — uniform dropdowns */}
          <FilterDropdown label="Performance" options={TIER_OPTS} selected={tiers} onToggle={toggle(setTiers)} onClear={() => setTiers([])} />
          <FilterDropdown label="Format" options={FORMAT_OPTS.map(f => ({ value: f, label: f, icon: f === 'Video' ? '🎬' : f === 'Carousel' ? '🔁' : '🖼' }))} selected={format} onToggle={toggle(setFormat)} onClear={() => setFormat([])} />
          <FilterDropdown label="Platform" options={PLATFORM_OPTS.map(p => ({ value: p, label: PLATFORM_LABELS[p], icon: PLATFORM_ICONS[p] }))} selected={platforms} onToggle={toggle(setPlatforms)} onClear={() => setPlatforms([])} />
          <FilterDropdown label="Industry" options={INDUSTRY_LIST.map(i => ({ value: i, label: i }))} selected={industry} onToggle={toggle(setIndustry)} onClear={() => setIndustry([])} searchable />
          <FilterDropdown label="Status" options={STATUS_OPTS} selected={status !== 'ALL' ? [status] : []} onToggle={v => setStatus(prev => prev === v ? 'ALL' : v)} onClear={() => setStatus('ALL')} />
          <FilterDropdown label="Niche" options={NICHE_OPTS} selected={niches} onToggle={toggle(setNiches)} onClear={() => setNiches([])} searchable />
          <FilterDropdown label="Hook" options={HOOK_OPTS} selected={hookTypes} onToggle={toggle(setHookTypes)} onClear={() => setHookTypes([])} searchable />
          <FilterDropdown label="Emotion" options={EMOTION_OPTS} selected={emotions} onToggle={toggle(setEmotions)} onClear={() => setEmotions([])} />
          <FilterDropdown label="Angle" options={ANGLE_OPTS} selected={angles} onToggle={toggle(setAngles)} onClear={() => setAngles([])} />
          <FilterDropdown label="UGC / Studio" options={FORMATSTYLE_OPTS} selected={formatStyles} onToggle={toggle(setFormatStyles)} onClear={() => setFormatStyles([])} />
          <FilterDropdown label="Visual" options={VISUALSTYLE_OPTS} selected={visualStyles} onToggle={toggle(setVisualStyles)} onClear={() => setVisualStyles([])} searchable />
          <FilterDropdown label="Theme" options={THEME_LIST.map(t => ({ value: t, label: t }))} selected={theme} onToggle={toggle(setTheme)} onClear={() => setTheme([])} searchable />

          {/* Numeric thresholds — grouped in a subtle container so they read as one set, not scattered */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, flexShrink: 0 }}>
            <NumberInput label="Run ≥ days" value={minDaysStr} onChange={setMinDaysStr} placeholder="0" />
            <NumberInput label="Brand ads ≥" value={minBrandAdsStr} onChange={setMinBrandAdsStr} placeholder="0" />
            <NumberInput label="Reuse ≥" value={minReuseStr} onChange={setMinReuseStr} placeholder="0" />
            <NumberInput label="Ads/brand" value={adsPerBrandStr} onChange={setAdsPerBrandStr} placeholder="3" />
          </div>

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFormat([]); setIndustry([]); setLanguage([]); setTheme([])
                setStatus('ALL'); setPlatforms([]); setMinDaysStr(''); setMinBrandAdsStr('')
                setTiers([]); setNiches([]); setMinReuseStr(''); setAdsPerBrandStr('')
                setHookTypes([]); setEmotions([]); setAngles([]); setFormatStyles([]); setVisualStyles([]); setCtaStyles([])
              }}
              style={{ fontSize: 12, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 8px', fontFamily: 'inherit' }}
            >
              Clear all ({activeFilterCount})
            </button>
          )}

          <div style={{ marginLeft: 'auto' }}>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '24px', overflowX: 'hidden', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>

        {/* Permission error */}
        {isPermError && (
          <div style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center', padding: '0 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 10 }}>API Access Needed</div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 28 }}>
              Meta requires identity confirmation before allowing Ads Library access.<br /><br />
              <strong style={{ color: '#111' }}>One-time setup (~ 1 min):</strong><br />
              1. Go to <a href="https://www.facebook.com/ads/library/api/" target="_blank" rel="noopener noreferrer" style={{ color: '#1a3a1a', fontWeight: 700 }}>facebook.com/ads/library/api</a><br />
              2. Click <strong>"Confirm Identity"</strong> and complete verification<br />
              3. Come back here and refresh
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="https://www.facebook.com/ads/library/api/" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#1a3a1a', color: '#dffe95', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                🔑 Confirm Identity on Meta
              </a>
              <a href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country === 'ALL' ? 'US' : country}${query ? `&q=${encodeURIComponent(query)}` : ''}&media_type=all`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#f1f5f9', color: '#374151', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none', border: '1px solid #e2e8f0' }}>
                <ExternalLink size={14} /> Browse Meta Ads Library
              </a>
            </div>
          </div>
        )}

        {/* Other error */}
        {error && !isPermError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '14px 18px', marginBottom: 20, color: '#dc2626', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Skeleton */}
        {loading && rawAds.length === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px,100%), 1fr))', gap: 12 }}>
            {[...Array(12)].map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e2e8f0' }} className="shimmer" />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, background: '#e2e8f0', borderRadius: 6, marginBottom: 6, width: '60%' }} className="shimmer" />
                    <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '40%' }} className="shimmer" />
                  </div>
                </div>
                <div style={{ aspectRatio: '4 / 5', background: '#e2e8f0' }} className="shimmer" />
                <div style={{ padding: '10px 14px 12px' }}>
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, marginBottom: 6 }} className="shimmer" />
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '80%' }} className="shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Landing state — no search yet */}
        {!loading && !error && rawAds.length === 0 && !query && (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🔍</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 10 }}>Search the Meta Ads Library</div>
            <div style={{ fontSize: 15, color: '#6b7280', marginBottom: 32, lineHeight: 1.7 }}>
              Type a brand name, keyword, or product to discover<br />ads currently running on Facebook & Instagram
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {['Nike', 'Skincare', 'Weight loss', 'SAAS', 'Fashion', 'Coffee', 'Gym', 'Travel'].map(term => (
                <button key={term} onClick={() => { setSearchInput(term); setQuery(term) }}
                  style={{ padding: '8px 18px', background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 100, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a3a1a'; e.currentTarget.style.color = '#1a3a1a' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#374151' }}>
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty — searched but no results */}
        {!loading && !error && rawAds.length === 0 && query && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤷</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>No ads found for "{query}"</div>
            <div style={{ fontSize: 14 }}>Try a different search term or adjust your filters</div>
          </div>
        )}

        {/* No matches after client filter */}
        {!loading && !error && rawAds.length > 0 && filteredAds.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🎛️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 6 }}>No ads match your filters</div>
            <div style={{ fontSize: 13 }}>{rawAds.length} ads loaded — try adjusting the filters above</div>
          </div>
        )}

        {/* ── Top Brands Strip (like Atria) ── */}
        {(topBrands.length > 0 || brandsLoading) && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{query ? 'Top Brands' : 'Top brands · most active'}</div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {brandsLoading && !topBrands.length && [1,2,3,4,5].map(i => (
                <div key={i} style={{ flexShrink: 0, width: 140, height: 64, background: '#e2e8f0', borderRadius: 10 }} className="shimmer" />
              ))}
              {topBrands.map(brand => {
                const hue = brand.name.charCodeAt(0) * 7 % 360
                const hovered = hoverBrand === brand.pageId
                const viewAds = () => { setSearchInput(brand.name); setQuery(brand.name); setSearchMode('brand'); setSelectedBrand(null) }
                return (
                  <div key={brand.pageId} style={{ flexShrink: 0 }}
                    onMouseEnter={(e) => openHover(brand.pageId, e.currentTarget as HTMLElement)}
                    onMouseLeave={closeHover}>
                    <button onClick={viewAds}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', minWidth: 140, maxWidth: 200, border: `1.5px solid ${hovered ? '#1a3a1a' : '#e2e8f0'}`, boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.08)' : 'none' }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, hsl(${hue},62%,52%), hsl(${(hue + 28) % 360},60%,44%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0, boxShadow: `0 2px 6px hsla(${hue},55%,40%,0.35)` }}>
                        {brand.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand.name}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{brand.adCount.toLocaleString()} Ads</div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Ad grid */}
        {filteredAds.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>
                Showing <strong style={{ color: '#111' }}>{filteredAds.length.toLocaleString()}</strong> unique {filteredAds.length === 1 ? 'creative' : 'creatives'}
                {searchSource === 'indexed' && dbTotal > filteredAds.length ? <span title="The same creative often runs across many countries/retailers as separate ads — we show each once."> · from {dbTotal.toLocaleString()} placements</span> : ''}
                {hasMore ? ' · scroll for more' : ''}
              </span>
              {/* Search mode badge */}
              <span style={{ background: searchMode === 'brand' ? '#eff6ff' : searchMode === 'category' ? '#f0fdf4' : '#faf5ff', color: searchMode === 'brand' ? '#1d4ed8' : searchMode === 'category' ? '#166534' : '#7c3aed', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, border: `1px solid ${searchMode === 'brand' ? '#bfdbfe' : searchMode === 'category' ? '#bbf7d0' : '#e9d5ff'}` }}>
                {searchMode === 'brand' ? '🏷️ Brand' : searchMode === 'category' ? '📂 Category' : '📝 Ad copy'} · "{query}"
              </span>
              {/* Source badge */}
              <span style={{ background: searchSource === 'indexed' ? '#f0fdf4' : '#fffbeb', color: searchSource === 'indexed' ? '#166534' : '#92400e', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100 }}>
                {searchSource === 'indexed' ? `⚡ ${totalInDB.toLocaleString()} ads indexed` : '🔴 Live from Meta'}
              </span>
              {activeFilterCount > 0 && <span style={{ background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100 }}>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
              {loading && <span style={{ opacity: 0.6 }}>• Loading…</span>}
            </div>
            {/* Virtualized masonry (masonic) — balanced Pinterest columns where only
                the visible cards are mounted (windowing). Deep scroll stays flat in
                memory (no DOM accumulation / tab freeze). onRender drives infinite load.
                Keyed by the server query so a NEW search remounts to a fresh grid+top. */}
            {mounted && (
            <MasonryBoundary>
              <Masonry
                key={gridKey}
                items={filteredAds}
                columnGutter={12}
                columnCount={gridCols}
                // Mount ~3 screens ahead so each card's image preloads with plenty of lead time and is
                // already decoded before it scrolls into view → NO grey-placeholder-then-flash pop-in.
                // (Lowering this to 1.5 to chase "scroll jank" was a mistake — the actual jank was the
                // SimplyTrends browser extension; cutting overscan just removed the image preload and
                // re-introduced the pop-in. With the extension gone and the loadMore append wrapped in
                // startTransition, 3 screens render fine.)
                overscanBy={3}
                itemKey={(ad: Ad, i: number) => ad?.id ?? `_${i}`}
                render={MasonryCard}
                onRender={handleMasonryRender}
              />
            </MasonryBoundary>
            )}
            {/* No "loading more" text — eager prefetch + 2500px sentinel keep the next pages ready
                before the user reaches them (Atria-style). Just a spacer so the scroll area is stable. */}
            {loading && hasMore && <div style={{ height: 24 }} />}
          </>
        )}
      </div>
    </div>
  )
}
