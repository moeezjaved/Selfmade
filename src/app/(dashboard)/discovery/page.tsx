'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, ExternalLink, RefreshCw } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────
interface Ad {
  id: string
  pageId: string
  pageName: string
  body: string
  title: string
  caption: string
  snapshotUrl: string
  startDate: string
  stopDate: string | null
  platforms: string[]
  languages: string[]
  mediaType: string
  isActive: boolean
  daysRunning: number
  // classified client-side
  format: string
  industries: string[]
  themes: string[]
  langNames: string[]
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
  return {
    ...raw,
    format: detectFormat(raw.mediaType),
    industries: detectIndustries(text),
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
  { value: 'recent', label: 'Most Recent' },
  { value: 'longest', label: 'Longest Running' },
  { value: 'oldest', label: 'Oldest First' },
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
        display: 'flex', alignItems: 'center', gap: 6,
        border: `1px solid ${isActive ? '#1a3a1a' : '#e2e8f0'}`,
        borderRadius: 8, background: isActive ? '#1a3a1a' : '#fff',
        padding: '0 10px 0 10px', height: 34,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#dffe95' : '#6b7280', whiteSpace: 'nowrap' }}>{label}</span>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={0}
          style={{
            width: 60, border: 'none', outline: 'none', fontSize: 13, fontWeight: 600,
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

// ── AdCard ───────────────────────────────────────────────────
function AdCard({ ad }: { ad: Ad }) {
  const daysText = ad.daysRunning > 365
    ? `${Math.floor(ad.daysRunning / 365)}y ${Math.floor((ad.daysRunning % 365) / 30)}mo`
    : ad.daysRunning > 30
    ? `${Math.floor(ad.daysRunning / 30)}mo ${ad.daysRunning % 30}d`
    : ad.daysRunning > 0
    ? `${ad.daysRunning}d`
    : 'New'

  const initials = ad.pageName?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  const formatIcon = ad.format === 'Video' ? '🎬' : ad.format === 'Carousel' ? '🔁' : '🖼'

  return (
    <div
      style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Brand header */}
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ad.pageName || 'Unknown Brand'}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#9ca3af', display: 'inline-block', flexShrink: 0 }} />
            {ad.isActive ? 'Active' : 'Inactive'} · {daysText}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span title={ad.format} style={{ fontSize: 14 }}>{formatIcon}</span>
          <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
            title="View on Meta Ads Library"
            style={{ color: '#6b7280', flexShrink: 0 }}
            onClick={e => e.stopPropagation()}>
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      {/* Preview */}
      <div style={{ position: 'relative', background: '#f8fafc', overflow: 'hidden', height: 280 }}>
        {ad.snapshotUrl ? (
          <iframe
            src={ad.snapshotUrl}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
            scrolling="no"
            title={`Ad by ${ad.pageName}`}
            loading="lazy"
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
            No preview
          </div>
        )}
        <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
          style={{ position: 'absolute', inset: 0, zIndex: 2 }} aria-label="View ad" />
      </div>

      {/* Copy */}
      {(ad.body || ad.title) && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f5f9' }}>
          {ad.title && <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{ad.title}</div>}
          {ad.body && <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ad.body}</div>}
        </div>
      )}

      {/* Tags — themes + platforms */}
      <div style={{ padding: '8px 14px 12px', marginTop: 'auto' }}>
        {ad.themes.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {ad.themes.slice(0, 2).map(t => (
              <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#f0fdf4', color: '#166534', borderRadius: 100, border: '1px solid #bbf7d0' }}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {ad.platforms.slice(0, 3).map(p => (
              <span key={p} title={PLATFORM_LABELS[p] || p} style={{ fontSize: 13 }}>{PLATFORM_ICONS[p] || '🌐'}</span>
            ))}
          </div>
          {ad.startDate && (
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              {new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────
export default function DiscoveryPage() {
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [rawAds, setRawAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  // Server-side filters (trigger re-fetch)
  const [sort, setSort] = useState('recent')
  const [status, setStatus] = useState('ALL')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [country, setCountry] = useState('US')

  // Client-side filters (applied to loaded ads instantly)
  const [format, setFormat] = useState<string[]>([])
  const [industry, setIndustry] = useState<string[]>([])
  const [language, setLanguage] = useState<string[]>([])
  const [theme, setTheme] = useState<string[]>([])
  const [minDaysStr, setMinDaysStr] = useState('')
  const [minBrandAdsStr, setMinBrandAdsStr] = useState('')

  const fetchAds = useCallback(async (reset = true, cursor?: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        q: query, sort, status,
        ...(country && country !== 'ALL' ? { country } : {}),
        ...(platforms.length ? { platforms: platforms.join(',') } : {}),
        ...(cursor ? { after: cursor } : {}),
      })
      const res = await fetch(`/api/discovery?${params}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setLoading(false); return }
      const classified = (data.ads || []).map(classifyAd)
      setRawAds(prev => reset ? classified : [...prev, ...classified])
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, sort, status, platforms, country])

  useEffect(() => { fetchAds(true) }, [query, sort, status, platforms, country])

  // Collect available languages from loaded ads
  const availableLanguages = useMemo(() => {
    const set = new Set<string>()
    rawAds.forEach(ad => ad.langNames.forEach(l => { if (l) set.add(l) }))
    return Array.from(set).sort()
  }, [rawAds])

  // Brand ad counts from loaded results
  const brandAdCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    rawAds.forEach(ad => { counts[ad.pageId] = (counts[ad.pageId] || 0) + 1 })
    return counts
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
      if (minDays > 0 && ad.daysRunning < minDays) return false
      if (minBrandAds > 0 && (brandAdCounts[ad.pageId] || 0) < minBrandAds) return false
      return true
    })
  }, [rawAds, format, industry, language, theme, minDays, minBrandAds, brandAdCounts])

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(searchInput) }

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  const activeFilterCount = format.length + industry.length + language.length + theme.length
    + (status !== 'ALL' ? 1 : 0) + platforms.length + (minDays > 0 ? 1 : 0) + (minBrandAds > 0 ? 1 : 0)

  const isPermError = error.toLowerCase().includes('permission') || error.toLowerCase().includes('application does not')

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 40 }}>

        {/* Row 1: title + search + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ marginRight: 4, flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>Ad Discovery</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Browse live ads from Meta Ads Library</div>
          </div>
          <form onSubmit={handleSearch} style={{ flex: 1, maxWidth: 500 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search for ads or brands…"
                style={{ width: '100%', padding: '9px 36px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none', fontFamily: 'inherit', background: '#f8fafc', color: '#111', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = '#1a3a1a')}
                onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
              />
              {searchInput && (
                <button type="button" onClick={() => { setSearchInput(''); setQuery('') }}
                  style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>×</button>
              )}
            </div>
          </form>
          <button onClick={() => fetchAds(true)} disabled={loading}
            style={{ padding: '8px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Row 2: filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Country — server-side, prominent */}
          <CountryDropdown value={country} onChange={v => { setCountry(v); setRawAds([]) }} />

          <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

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

          {/* Runtime minimum */}
          <NumberInput
            label="Min Runtime"
            value={minDaysStr}
            onChange={setMinDaysStr}
            placeholder="0"
            suffix="days"
          />

          {/* Brand active ads minimum */}
          <NumberInput
            label="Brand Ads ≥"
            value={minBrandAdsStr}
            onChange={setMinBrandAdsStr}
            placeholder="0"
            suffix="ads"
          />

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFormat([]); setIndustry([]); setLanguage([]); setTheme([])
                setStatus('ALL'); setPlatforms([]); setMinDaysStr(''); setMinBrandAdsStr('')
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
      <div style={{ padding: '24px' }}>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e2e8f0' }} className="shimmer" />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, background: '#e2e8f0', borderRadius: 6, marginBottom: 6, width: '60%' }} className="shimmer" />
                    <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '40%' }} className="shimmer" />
                  </div>
                </div>
                <div style={{ height: 280, background: '#e2e8f0' }} className="shimmer" />
                <div style={{ padding: '10px 14px 12px' }}>
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, marginBottom: 6 }} className="shimmer" />
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '80%' }} className="shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && rawAds.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>No ads found</div>
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

        {/* Ad grid */}
        {filteredAds.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Showing <strong style={{ color: '#111' }}>{filteredAds.length}</strong>{rawAds.length !== filteredAds.length ? ` of ${rawAds.length}` : ''} ads{query ? ` for "${query}"` : ''}</span>
              {activeFilterCount > 0 && <span style={{ background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100 }}>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
              {loading && <span style={{ opacity: 0.6 }}>• Loading…</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filteredAds.map(ad => <AdCard key={ad.id} ad={ad} />)}
            </div>
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <button
                  onClick={() => fetchAds(false, nextCursor || undefined)}
                  disabled={loading}
                  style={{ padding: '12px 32px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Loading…' : 'Load more ads'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
