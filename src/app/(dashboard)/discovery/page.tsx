'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, ExternalLink, RefreshCw, Bookmark, BookmarkCheck, MoreHorizontal, Info, Link as LinkIcon, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'
import BrandDrawer from './BrandDrawer'

// ── Types ────────────────────────────────────────────────────
interface Creative {
  position: number
  asset_type: 'image' | 'video'
  r2_url: string
  hash: string | null
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const visible = searchable
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
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

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
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
          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
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
          <div style={{ overflowY: 'auto' }}>
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

// ── CarouselViewer ─ swipeable preview for multi-image ads ──
function CarouselViewer({ ad, avatarBg, iframeVisible }: { ad: Ad; avatarBg: string; iframeVisible: boolean }) {
  const router = useRouter()
  // Build slide list: prefer creatives[] (full carousel), fall back to legacy single image/video
  type Slide = { type: 'image' | 'video'; url: string }
  const slides: Slide[] = useMemo(() => {
    if (ad.creatives && ad.creatives.length > 0) {
      const sorted = [...ad.creatives].sort((a, b) => {
        if (a.asset_type !== b.asset_type) return a.asset_type === 'image' ? -1 : 1
        return a.position - b.position
      })
      return sorted.map((c) => ({ type: c.asset_type, url: c.r2_url }))
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

  const next = (e?: React.MouseEvent) => { e?.stopPropagation(); setIdx(i => (i + 1) % total); setPlaying(false) }
  const prev = (e?: React.MouseEvent) => { e?.stopPropagation(); setIdx(i => (i - 1 + total) % total); setPlaying(false) }

  // No real creative on R2 → don't render anything.
  // Discovery API already filters these out, but defense in depth.
  if (!slide) return null

  // Natural aspect ratio — image/video sets the height, no cropping (Atria-style)
  return (
    <div
      className="ad-card-visual"
      onClick={() => router.push(`/discovery/${ad.id}`)}
      style={{
        position: 'relative', background: '#f1f3f5', overflow: 'hidden', lineHeight: 0, cursor: 'pointer',
        // Natural aspect (Atria-style masonry) — full creative, no crop, no letterbox.
        // A min-height placeholder reserves space while loading so the column doesn't
        // collapse; the masonry columns (round-robin, stable) keep scroll smooth.
        width: '100%', minHeight: !imgLoaded ? 220 : undefined,
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
              src={slide.url}
              alt={ad.pageName}
              loading="eager"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              style={{
                width: '100%', height: 'auto', display: 'block', verticalAlign: 'top',
                opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.35s ease', position: 'relative', zIndex: 2,
              }}
            />
          )}
        </>
      ) : (
        <>
          {!imgLoaded && (
            <div className="thumb-skeleton" style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
          )}
          <video
            ref={videoRef}
            key={slide.url}
            src={slide.url}
            controls={playing}
            preload="metadata"
            playsInline
            onLoadedData={() => setImgLoaded(true)}
            onLoadedMetadata={() => setImgLoaded(true)}
            onCanPlay={() => setImgLoaded(true)}
            style={{ width: '100%', height: 'auto', maxHeight: 560, display: 'block', verticalAlign: 'top', outline: 'none', border: 'none', background: '#000', opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.35s ease', position: 'relative', zIndex: 2 }}
            onEnded={() => setPlaying(false)}
          />
          {imgLoaded && !playing && (
            <div onClick={() => router.push(`/discovery/${ad.id}`)}
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', cursor: 'pointer', zIndex: 3 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                <span style={{ fontSize: 20, marginLeft: 3 }}>▶</span>
              </div>
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

      {/* Hover overlay — Clone ad (image, centered) or Scripts (video, top-left so it doesn't cover play button) */}
      <div
        className="hover-overlay"
        style={{
          position: 'absolute', inset: 0,
          background: slide.type === 'video' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: slide.type === 'video' ? 'flex-start' : 'center',
          justifyContent: slide.type === 'video' ? 'flex-start' : 'center',
          padding: slide.type === 'video' ? 10 : 0,
          opacity: 0,
          transition: 'opacity .15s',
          pointerEvents: 'none',
          zIndex: 6,
        }}
      >
        {slide.type === 'video' ? (
          <div style={{ pointerEvents: 'auto' }}>
            <ScriptsMenu />
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); /* Clone wired up later */ }}
            style={{
              pointerEvents: 'auto',
              background: 'linear-gradient(90deg, #f97316, #ea580c)',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}
          >
            <span style={{ fontSize: 14 }}>✨</span> Clone ad
          </button>
        )}
      </div>
    </div>
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
  const bodyText = ad.body || ''
  const isLong = bodyText.length > 220
  const displayBody = expanded || !isLong ? bodyText : bodyText.slice(0, 220) + '…'

  return (
    <>
    {showSaveModal && <SaveModal ad={ad} onClose={() => { setShowSaveModal(false); setIsSaved(true) }} />}
    <div
      style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s', cursor: 'default' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
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
        {/* Performance tier badge — only the top tiers (winning/optimized) to avoid noise */}
        {(ad.performanceTier === 'winning' || ad.performanceTier === 'optimized') && (
          <span title={`Performance tier: ${ad.performanceTier}`}
            style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: '.02em', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 100, textTransform: 'uppercase',
              color: ad.performanceTier === 'winning' ? '#166534' : '#92600a',
              background: ad.performanceTier === 'winning' ? '#dcfce7' : '#fef9c3',
              border: `1px solid ${ad.performanceTier === 'winning' ? '#bbf7d0' : '#fde68a'}` }}>
            {ad.performanceTier === 'winning' ? '🏆 Winning' : '⚡ Optimized'}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
          <button onClick={() => setShowSaveModal(true)} title="Save to board"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSaved ? '#1a3a1a' : '#9ca3af', padding: 3, borderRadius: 4, transition: 'color .15s' }}>
            {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </button>
          <MoreMenu ad={ad} />
        </div>
      </div>

      {/* ── Date range (compact) ── */}
      <div style={{ padding: '0 10px 6px', fontSize: 10, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db' }} />
        <span>
          {ad.startDate ? new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          {' - '}
          {ad.stopDate ? new Date(ad.stopDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present'}
        </span>
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
  const [rawAds, setRawAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(false)
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
      })
      const dbRes = await fetch(`/api/discovery/db-search?${dbParams}`)
      const dbData = await dbRes.json()

      if (!dbData.error && dbData.ads?.length > 0) {
        // We have indexed results — use them
        const classified = dbData.ads.map((ad: any) => classifyAd({
          ...ad, mediaType: ad.format || '',
        }))
        // Cross-page dedup: drop ads whose hash was already shown
        setRawAds(prev => {
          if (reset) return classified
          const seen = new Set<string>()
          for (const a of prev) {
            const k = (a as any).image_hash || (a as any).video_hash
            if (k) seen.add(k)
          }
          const newOnes = classified.filter((a: Ad) => {
            const k = (a as any).image_hash || (a as any).video_hash
            if (!k) return true
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          return [...prev, ...newOnes]
        })
        setHasMore(dbData.hasMore)
        setDbPage(page)
        setDbTotal(dbData.total || 0)
        setTotalInDB(dbData.totalInDB || 0)
        setSearchSource('indexed')
        setNextCursor(null)
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
      setDbTotal(dbData.total || 0)
      setTotalInDB(dbData.totalInDB || 0)
      setSearchSource('indexed')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, searchMode, sort, status, platforms, country, format, industry, theme, dbPage, timeDays, selectedBrand?.pageId, tiers, niches, minBrandAdsStr, minDaysStr, minReuseStr, adsPerBrandStr])

  // Fetch ads when query/filters change — always load DB ads even without a query
  useEffect(() => {
    if (query.trim()) {
      fetchAds(true)
    } else {
      // Browse mode: load latest indexed ads from DB without a query
      setError('')
      setNextCursor(null)
      setTopBrands([])
      setLoading(true)
      const params = new URLSearchParams({ q: '', sort, status, page: '0', ...(platforms.length ? { platforms: platforms.join(',') } : {}), ...(timeDays > 0 ? { days: String(timeDays) } : {}) })
      fetch(`/api/discovery/db-search?${params}`)
        .then(r => r.json())
        .then(d => {
          if (d.ads?.length) {
            setRawAds(d.ads.map((ad: any) => classifyAd({ ...ad, mediaType: ad.format || '' })))
            setHasMore(d.hasMore)
            setDbPage(0)
            setDbTotal(d.total || 0)
            setTotalInDB(d.totalInDB || 0)
            setSearchSource('indexed')
          } else {
            setRawAds([])
            setHasMore(false)
          }
        })
        .catch(() => { setRawAds([]); setHasMore(false) })
        .finally(() => setLoading(false))
    }
  }, [query, searchMode, sort, status, platforms, country, timeDays, industry, theme])

  // TOP BRANDS strip — computed from the ACTUAL loaded results so it always matches
  // the grid (and sums to the matching count), including semantic-matched brands a
  // separate server query would miss. Counts grow as more pages load via infinite scroll.
  useEffect(() => {
    if (!query.trim()) { setTopBrands([]); return }
    const m: Record<string, { pageId: string; name: string; adCount: number; picture: string | null }> = {}
    for (const ad of rawAds) {
      if (!ad.pageId) continue
      if (!m[ad.pageId]) m[ad.pageId] = { pageId: ad.pageId, name: ad.pageName, adCount: 0, picture: null }
      m[ad.pageId].adCount++
    }
    setTopBrands(Object.values(m).sort((a, b) => b.adCount - a.adCount).slice(0, 20))
    setBrandsLoading(false)
  }, [query, rawAds])

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

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  const activeFilterCount = format.length + industry.length + language.length + theme.length
    + (status !== 'ALL' ? 1 : 0) + platforms.length + (minDays > 0 ? 1 : 0) + (minBrandAds > 0 ? 1 : 0)
    + tiers.length + niches.length + ((parseInt(minReuseStr) || 0) > 0 ? 1 : 0) + ((parseInt(adsPerBrandStr) || 0) > 0 ? 1 : 0)

  const isPermError = error.toLowerCase().includes('permission') || error.toLowerCase().includes('application does not')

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
              <button onClick={() => { setSelectedBrand({ pageId: hoverBrand, name: hbName }); setHoverBrand(null) }} style={{ flex: 1, padding: '9px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Details</button>
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
            <div style={{ fontSize: 11, color: '#6b7280' }}>Browse live ads from Meta Ads Library</div>
          </div>

          {/* Sub-nav tabs */}
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 9, padding: 3, flexShrink: 0 }}>
            {[
              { label: '🔍 Explore', href: '/discovery' },
              { label: '🎨 Creatives', href: '/discovery/creatives' },
              { label: '🔖 Saved', href: '/discovery/saved' },
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
                        // Atria-style: filter main feed to this brand's ads AND open the drawer.
                        // setSearchMode('brand') ensures the search runs as page_name match,
                        // so the main grid shows only Gymshark's creatives instead of any ad
                        // mentioning "gym" in the body.
                        setSearchInput(brand.name)
                        setQuery(brand.name)
                        setSearchMode('brand')
                        setSelectedBrand({ pageId: brand.pageId, name: brand.name })
                        setShowDropdown(false)
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
            { label: '🏆 Best of the Month', apply: () => { setTiers(['winning']); setNiches([]); setTimeDays(30); setSort('performance') } },
            { label: '🔥 Winning ads', apply: () => { setTiers(['winning']); setSort('performance') } },
            { label: '📊 Brands · 100+ active ads', apply: () => { setMinBrandAdsStr('100') } },
            { label: '💄 Beauty ads', apply: () => { setNiches(['Beauty']) } },
            { label: '👗 Fashion ads', apply: () => { setNiches(['Fashion']) } },
          ].map(p => (
            <button key={p.label} onClick={p.apply}
              style={{ padding: '5px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e2e8f0', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Row 2: filters — time buttons + country + format etc all on one line */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Time filter (inline) */}
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
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: timeDays === f.days ? '#1a3a1a' : 'transparent',
                  color: timeDays === f.days ? '#dffe95' : '#6b7280',
                  border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

          {/* Country filter removed — we crawl worldwide (country=ALL); per-country
              filtering isn't active, so the selector was misleading. `country` stays
              'ALL' in state so the search query is unchanged. */}

          <FilterDropdown
            label="Performance"
            options={TIER_OPTS}
            selected={tiers} onToggle={toggle(setTiers)} onClear={() => setTiers([])}
          />
          <FilterDropdown
            label="Niche"
            options={NICHE_OPTS}
            selected={niches} onToggle={toggle(setNiches)} onClear={() => setNiches([])}
            searchable
          />
          <FilterDropdown
            label="Format"
            options={FORMAT_OPTS.map(f => ({ value: f, label: f, icon: f === 'Video' ? '🎬' : f === 'Carousel' ? '🔁' : '🖼' }))}
            selected={format} onToggle={toggle(setFormat)} onClear={() => setFormat([])}
          />
          <FilterDropdown
            label="Platform"
            options={PLATFORM_OPTS.map(p => ({ value: p, label: PLATFORM_LABELS[p], icon: PLATFORM_ICONS[p] }))}
            selected={platforms} onToggle={toggle(setPlatforms)} onClear={() => setPlatforms([])}
          />
          <FilterDropdown
            label="Industry"
            options={INDUSTRY_LIST.map(i => ({ value: i, label: i }))}
            selected={industry} onToggle={toggle(setIndustry)} onClear={() => setIndustry([])}
            searchable
          />
          <FilterDropdown
            label="Status"
            options={STATUS_OPTS}
            selected={status !== 'ALL' ? [status] : []}
            onToggle={v => setStatus(prev => prev === v ? 'ALL' : v)}
            onClear={() => setStatus('ALL')}
          />
          <FilterDropdown
            label="Language"
            options={availableLanguages.length
              ? availableLanguages.map(l => ({ value: l, label: l }))
              : Object.values(LANG_NAMES).sort().map(l => ({ value: l, label: l }))
            }
            selected={language} onToggle={toggle(setLanguage)} onClear={() => setLanguage([])}
            searchable
          />
          <FilterDropdown
            label="Theme"
            options={THEME_LIST.map(t => ({ value: t, label: t }))}
            selected={theme} onToggle={toggle(setTheme)} onClear={() => setTheme([])}
            searchable
          />

          <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

          {/* Run-time minimum — days_running ≥ N (server-side) */}
          <NumberInput label="Run ≥ days" value={minDaysStr} onChange={setMinDaysStr} placeholder="0" />
          {/* Brand active-ad count — brand_active_ads ≥ N (server-side) */}
          <NumberInput label="Brand ads ≥" value={minBrandAdsStr} onChange={setMinBrandAdsStr} placeholder="0" />
          {/* Creative reuse — creative_reuse_count ≥ N (server-side) */}
          <NumberInput label="Reuse ≥" value={minReuseStr} onChange={setMinReuseStr} placeholder="0" />
          {/* Limit ads per brand (GetHookd "Limit ads per brand"; default cap 3) */}
          <NumberInput label="Ads/brand" value={adsPerBrandStr} onChange={setAdsPerBrandStr} placeholder="3" />

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFormat([]); setIndustry([]); setLanguage([]); setTheme([])
                setStatus('ALL'); setPlatforms([]); setMinDaysStr(''); setMinBrandAdsStr('')
                setTiers([]); setNiches([]); setMinReuseStr(''); setAdsPerBrandStr('')
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
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
        {(topBrands.length > 0 || brandsLoading) && query && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Top Brands</div>
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
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: `hsl(${hue},50%,85%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: `hsl(${hue},50%,30%)`, flexShrink: 0 }}>
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
                Showing <strong style={{ color: '#111' }}>{filteredAds.length}</strong>
                {rawAds.length !== filteredAds.length ? ` of ${rawAds.length}` : ''}
                {searchSource === 'indexed' && dbTotal > 0 ? ` of ${dbTotal.toLocaleString()} matching` : ''} ads
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
            {/* Masonry (Atria-style) — natural-aspect cards distributed round-robin into
                fixed columns. Items keep their column when more load, so appending never
                rebalances/jitters the existing cards; only the loading column settles. */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: '100%' }}>
              {Array.from({ length: gridCols }, (_, ci) => (
                <div key={ci} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {filteredAds.filter((_, i) => i % gridCols === ci).map(ad => (
                    <div key={ad.id} style={{ animation: 'fadeUp 0.3s ease-out both' }}>
                      <AdCard ad={ad} onBrandClick={(pid, name) => setSelectedBrand({ pageId: pid, name })}
                        onBrandHover={openHover} onBrandLeave={closeHover} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {/* Infinite scroll sentinel — auto-loads next page when in view */}
            {hasMore && (
              <InfiniteScrollSentinel
                loading={loading}
                onLoad={() =>
                  searchSource === 'indexed'
                    ? fetchAds(false, undefined, dbPage + 1)
                    : fetchAds(false, nextCursor || undefined)
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
