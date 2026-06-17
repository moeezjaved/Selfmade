'use client'
import { useEffect, useState } from 'react'

// Common ad-market countries for the quick-add picker (code → name).
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands',
  MX: 'Mexico', BR: 'Brazil', IN: 'India', SE: 'Sweden', PL: 'Poland',
  JP: 'Japan', SG: 'Singapore', AE: 'UAE', ZA: 'South Africa', IE: 'Ireland',
  NZ: 'New Zealand', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria',
  DK: 'Denmark', NO: 'Norway', FI: 'Finland', PT: 'Portugal', AR: 'Argentina',
}
const flag = (cc: string) =>
  cc.length === 2 ? String.fromCodePoint(...cc.toUpperCase().split('').map(c => 0x1f1a5 + c.charCodeAt(0))) : '🏳️'

export default function CountriesAdmin() {
  const [countries, setCountries] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState('')

  const load = () =>
    fetch('/api/admin/countries').then(r => r.json()).then(d => {
      setCountries(d.countries || []); setEnabled(!!d.enabled); setLoading(false)
    })
  useEffect(() => { load() }, [])

  async function save(next: { countries?: string[]; enabled?: boolean }) {
    setSaving(true)
    try {
      const r = await fetch('/api/admin/countries', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'save failed')
      setCountries(d.countries || []); setEnabled(!!d.enabled)
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const add = (cc: string) => {
    const c = cc.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(c) || countries.includes(c)) return
    save({ countries: [...countries, c] }); setCode('')
  }
  const remove = (cc: string) => save({ countries: countries.filter(c => c !== cc) })

  if (loading) return <div style={{ color: '#aaa', fontSize: 14 }}>Loading…</div>

  const suggestions = Object.keys(COUNTRY_NAMES).filter(c => !countries.includes(c))

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>🌍 Countries</h1>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px' }}>
        Countries to crawl ads from. The Discovery country filter uses this list.
      </p>

      {/* Crawl toggle */}
      <div style={{ background: enabled ? '#f0fdf4' : '#fff7ed', border: `1px solid ${enabled ? '#bbf7d0' : '#fed7aa'}`, borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
            Multi-country crawling: {enabled ? 'ON' : 'OFF'}
          </div>
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
            {enabled
              ? 'Each brand is re-crawled once per country to tag where its ads run. Uses more proxy data.'
              : 'OFF — brands crawl all-countries (no per-ad country yet). Turning ON re-crawls every brand per country and increases data usage.'}
          </div>
        </div>
        <button disabled={saving} onClick={() => {
          if (!enabled && !confirm(`Turn ON multi-country crawling for ${countries.length} countries?\n\nThis re-crawls every brand once per country and increases your proxy data usage.`)) return
          save({ enabled: !enabled })
        }}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', background: enabled ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
          {enabled ? 'Turn OFF' : 'Turn ON'}
        </button>
      </div>

      {/* Current list */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 12 }}>
          Crawl list ({countries.length})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {countries.map(cc => (
            <span key={cc} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', borderRadius: 100, padding: '6px 10px 6px 12px', fontSize: 13, fontWeight: 600, color: '#111' }}>
              <span>{flag(cc)} {cc}</span>
              <span style={{ color: '#94a3b8', fontSize: 11 }}>{COUNTRY_NAMES[cc] || ''}</span>
              <button disabled={saving} onClick={() => remove(cc)} title="Remove"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 15, lineHeight: 1, padding: '0 0 0 2px' }}>×</button>
            </span>
          ))}
          {countries.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13 }}>No countries yet — add some below.</span>}
        </div>

        {/* Add by code */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="2-letter code (e.g. JP)" maxLength={2}
            onKeyDown={e => { if (e.key === 'Enter') add(code) }}
            style={{ width: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, textTransform: 'uppercase' }} />
          <button disabled={saving} onClick={() => add(code)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
        </div>
      </div>

      {/* Quick add */}
      {suggestions.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 12 }}>Quick add</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {suggestions.map(cc => (
              <button key={cc} disabled={saving} onClick={() => add(cc)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 100, padding: '6px 12px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <span>{flag(cc)}</span> {cc} <span style={{ color: '#9ca3af', fontSize: 11 }}>{COUNTRY_NAMES[cc]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
