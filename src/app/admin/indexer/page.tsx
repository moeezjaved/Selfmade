'use client'
import { useState, useEffect, useCallback } from 'react'

const COUNTRIES = ['US','GB','CA','AU','IN','DE','FR','AE','PK','NG','SG','NZ']
const CATEGORIES = ['Fashion & Apparel','Beauty & Skincare','Health & Wellness','Fitness & Sports','Food & Beverage','Technology','Finance & Investing','Home & Living','Baby & Kids','Pets','Travel','Education','Business & Marketing','Entertainment','Automotive','General']

interface Term {
  id: string; term: string; category: string; countries: string[]
  term_type: string
  is_active: boolean; priority: number; last_crawled_at: string | null
  crawl_count: number; ads_found: number; created_at: string
}

const TERM_TYPES = [
  { value: 'adcopy', label: '📝 Ad Copy', hint: 'Keyword that appears in ad body text' },
  { value: 'brand',  label: '🏷️ Brand',   hint: 'Brand name — finds all ads from that advertiser' },
  { value: 'category', label: '📂 Category', hint: 'Industry/niche keyword — broad topic crawl' },
]

const TYPE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  adcopy:   { bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff' },
  brand:    { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  category: { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
}
interface LogEntry { term: string; country: string; ads_fetched: number; error?: string; ran_at: string }

const PLATFORM_ICONS: Record<string, string> = { facebook: '📘', instagram: '📸', audience_network: '🌐', messenger: '💬' }

export default function IndexerAdminPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState<string[]>([])
  const [crawlResults, setCrawlResults] = useState<any[]>([])
  const [crawlResultsLoading, setCrawlResultsLoading] = useState(false)
  const [tab, setTab] = useState<'overview'|'terms'|'log'>('overview')
  const [newTerm, setNewTerm] = useState('')
  const [newCategory, setNewCategory] = useState('General')
  const [newCountries, setNewCountries] = useState<string[]>(['US'])
  const [newPriority, setNewPriority] = useState(5)
  const [newTermType, setNewTermType] = useState('adcopy')
  const [termSearch, setTermSearch] = useState('')
  const [runTerm, setRunTerm] = useState('')
  const [runCountry, setRunCountry] = useState('US')
  const [runPageId, setRunPageId] = useState('')

  // Extract page_id from a Facebook Ads Library URL or raw ID
  const parsePageId = (raw: string): string => {
    const trimmed = raw.trim()
    // Full URL: extract view_all_page_id param
    try {
      const u = new URL(trimmed)
      const fromParam = u.searchParams.get('view_all_page_id') || u.searchParams.get('id') || u.searchParams.get('page_id')
      if (fromParam && /^\d+$/.test(fromParam)) return fromParam
    } catch { /* not a URL */ }
    // Raw numeric ID
    if (/^\d+$/.test(trimmed)) return trimmed
    return trimmed
  }
  const [seeding, setSeeding] = useState(false)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/indexer?action=stats')
    const data = await res.json()
    setStats(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const fetchCrawlResults = useCallback(async (since: string) => {
    setCrawlResultsLoading(true)
    try {
      const res = await fetch(`/api/admin/indexer?action=recent_ads&since=${encodeURIComponent(since)}`)
      const data = await res.json()
      setCrawlResults(data.ads || [])
    } catch { /* ignore */ } finally {
      setCrawlResultsLoading(false)
    }
  }, [])

  const runCrawler = async (term?: string, country?: string, pageId?: string) => {
    setRunning(true)
    setCrawlResults([])
    setRunLog(['🚀 Starting crawler...'])
    const runStartedAt = new Date().toISOString()
    try {
      const params = new URLSearchParams({ stream: '1' })
      if (term) params.set('term', term)
      if (country) params.set('country', country)
      if (pageId) params.set('page_id', pageId)
      const res = await fetch(`/api/indexer?${params}`)
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        setRunLog(prev => [...prev, `❌ Error: ${text}`])
        setRunning(false)
        return
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.replace(/^data:\s*/, '').trim()
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.msg) setRunLog(prev => [...prev, String(parsed.msg)])
            if (parsed.type === 'done') {
              fetchStats()
              fetchCrawlResults(runStartedAt)
            }
          } catch {
            if (line) setRunLog(prev => [...prev, line])
          }
        }
      }
    } catch (e: any) {
      setRunLog(prev => [...prev, `❌ ${String(e?.message ?? e)}`])
    }
    setRunning(false)
  }

  const addTerm = async (overrides?: { term?: string; page_id?: string; term_type?: string }) => {
    const t = overrides?.term || newTerm
    if (!t.trim()) return
    await fetch('/api/admin/indexer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_term',
        term: t,
        category: newCategory,
        countries: newCountries,
        priority: newPriority,
        term_type: overrides?.term_type || newTermType,
        page_id: overrides?.page_id || undefined,
      }),
    })
    setNewTerm('')
    fetchStats()
  }

  const saveManualToSchedule = async () => {
    if (!runTerm.trim()) return
    const pid = parsePageId(runPageId)
    await addTerm({ term: runTerm, page_id: pid || undefined, term_type: 'brand' })
    alert(`✅ "${runTerm}" added to scheduled terms${pid ? ` with page_id ${pid}` : ''} — it will crawl automatically every 6 hours`)
  }

  const toggleTerm = async (id: string, is_active: boolean) => {
    await fetch('/api/admin/indexer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_term', id, is_active }),
    })
    fetchStats()
  }

  const deleteTerm = async (id: string) => {
    if (!confirm('Delete this term?')) return
    await fetch('/api/admin/indexer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_term', id }),
    })
    fetchStats()
  }

  const filteredTerms = (stats?.terms || []).filter((t: Term) =>
    t.term.toLowerCase().includes(termSearch.toLowerCase()) || t.category.toLowerCase().includes(termSearch.toLowerCase())
  )

  const seedDefaultTerms = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin/indexer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_terms' }),
      })
      const data = await res.json()
      if (data.added > 0) {
        alert(`✅ Added ${data.added} default terms (10 brand + 10 category + 10 ad copy)`)
      } else {
        alert('ℹ️ All seed terms already exist — nothing to add.')
      }
      fetchStats()
    } catch (e: any) {
      alert('❌ Failed to seed terms: ' + e.message)
    } finally {
      setSeeding(false)
    }
  }

  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }
  const btn = (color = '#141d15', text = '#ff5a2c') => ({ padding: '8px 18px', background: color, color: text, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const)

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, fontSize: 16, color: '#6b7280' }}>Loading indexer stats…</div>

  return (
    <div style={{ maxWidth: 1200 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>🕷️ Ad Indexer</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Crawls Meta Ads Library → builds your own searchable ad database
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fetchStats()} style={btn('#f1f5f9', '#374151')}>🔄 Refresh</button>
          <button onClick={() => runCrawler()} disabled={running} style={btn('#374151', '#fff')}>
            {running ? '⏳ Running…' : '⏱ Run Scheduled Terms'}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Ads Indexed', value: stats?.totalAds?.toLocaleString() || '0', icon: '📦', color: '#141d15' },
          { label: 'With Thumbnails', value: stats?.withThumbnail?.toLocaleString() || '0', icon: '🖼️', color: '#0891b2' },
          { label: 'AI Classified', value: stats?.classified?.toLocaleString() || '0', icon: '🤖', color: '#7c3aed' },
          { label: 'With Embeddings', value: stats?.withEmbedding?.toLocaleString() || '0', icon: '🔢', color: '#1d4ed8' },
          { label: 'Crawl Terms', value: stats?.terms?.length || '0', icon: '🔑', color: '#b45309' },
          { label: 'Last Run', value: stats?.lastRunAt ? new Date(stats.lastRunAt).toLocaleTimeString() : 'Never', icon: '⏰', color: '#059669' },
        ].map(s => (
          <div key={s.label} style={{ ...card }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#f1f5f9', borderRadius: 10, padding: 3, width: 'fit-content' }}>
        {(['overview', 'terms', 'log'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#fff' : 'transparent', tab === t ? '#111' : '#6b7280'), boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', textTransform: 'capitalize' }}>
            {t === 'overview' ? '📊 Overview' : t === 'terms' ? '🔑 Terms' : '📋 Log'}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Manual run */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>⚡ Manual Crawl</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              Enter a <strong>brand name</strong> (e.g. Gymshark) or a <strong>keyword</strong> (e.g. hair growth serum). Crawls all 3 modes simultaneously.
            </div>
            {/* Input row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input value={runTerm} onChange={e => setRunTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !running && runCrawler(runTerm || undefined, runCountry, parsePageId(runPageId) || undefined)}
                placeholder="Brand name or keyword…"
                style={{ flex: 1, minWidth: 160, padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              <input value={runPageId} onChange={e => setRunPageId(e.target.value)}
                placeholder="Paste FB Ads Library URL or page_id"
                title="Go to facebook.com/ads/library → search brand → click Advertisers tab → click the brand → copy the URL and paste here"
                style={{ width: 260, padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              <select value={runCountry} onChange={e => setRunCountry(e.target.value)} style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <button onClick={() => runCrawler(runTerm || undefined, runCountry, parsePageId(runPageId) || undefined)} disabled={running} style={btn()}>
                {running ? '⏳' : '▶ Crawl Now'}
              </button>
              {runTerm && (
                <button onClick={() => saveManualToSchedule()} disabled={running} title="Add to scheduled terms so it crawls automatically every 6 hours" style={btn('#f1f5f9', '#374151')}>
                  + Schedule
                </button>
              )}
            </div>
            {/* Hint */}
            {runPageId && parsePageId(runPageId) ? (
              <div style={{ fontSize: 11, color: '#1d4ed8', marginBottom: 10, padding: '8px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                🏷 Page ID <strong>{parsePageId(runPageId)}</strong> detected — will fetch ALL ads from this brand directly
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                {runTerm ? <>Keyword search for <strong>"{runTerm}"</strong> · </> : null}
                💡 <strong>For brands:</strong> go to{' '}
                <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>Facebook Ads Library</a>
                {' '}→ search brand → click <strong>Advertisers</strong> tab → click the brand → paste the URL above
              </div>
            )}
            {runLog.length > 0 && (
              <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, maxHeight: 260, overflowY: 'auto' }}>
                {runLog.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: l.startsWith('❌') ? '#f87171' : l.startsWith('✅') || l.startsWith('🎉') ? '#4ade80' : l.startsWith('⚠️') ? '#fbbf24' : '#94a3b8', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", marginBottom: 2, wordBreak: 'break-all' }}>{l}</div>
                ))}
              </div>
            )}
          </div>

          {/* Coverage by industry */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📂 Coverage by Category</div>
            {(stats?.industryStats || []).slice(0, 10).map(([cat, count]: [string, number]) => {
              const max = stats.industryStats[0]?.[1] || 1
              return (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#374151', fontWeight: 500 }}>{cat}</span>
                    <span style={{ color: '#6b7280' }}>{count?.toLocaleString()}</span>
                  </div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3 }}>
                    <div style={{ height: '100%', background: '#141d15', borderRadius: 3, width: `${Math.min(100, (count / max) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
            {!stats?.industryStats?.length && <div style={{ fontSize: 13, color: '#9ca3af' }}>No data yet — run the crawler first</div>}
          </div>

          {/* Last run terms */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>🕐 Last Run Terms</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(stats?.termsProcessedLast || []).map((t: string) => (
                <span key={t} style={{ background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 100, border: '1px solid #bbf7d0' }}>{t}</span>
              ))}
              {!stats?.termsProcessedLast?.length && <span style={{ fontSize: 13, color: '#9ca3af' }}>No runs yet</span>}
            </div>
          </div>

          {/* Cron schedule info */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>⏰ Cron Schedule</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              <div>📅 Runs every <strong>6 hours</strong> automatically</div>
              <div>📦 <strong>10 terms</strong> per run × countries</div>
              <div>🔄 Rotates through all {stats?.terms?.length || 0} terms continuously</div>
              <div>⚡ Full cycle: ~{Math.ceil((stats?.terms?.length || 100) / 10) * 6} hours</div>
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, color: '#166534', fontSize: 12, fontWeight: 600 }}>
                Next auto-run: every 6h from deployment
              </div>
            </div>
          </div>
        </div>

        {/* ── Crawl Results Preview ── */}
        {(crawlResultsLoading || crawlResults.length > 0) && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>
                🎯 Crawl Results
              </div>
              {crawlResultsLoading && (
                <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, border: '2px solid #e2e8f0', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Loading ads from this run…
                </div>
              )}
              {!crawlResultsLoading && crawlResults.length > 0 && (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {crawlResults.length} ads indexed in this run
                </div>
              )}
              <a href="/discovery" target="_blank"
                style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: '#141d15', textDecoration: 'none', padding: '5px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7 }}>
                Open Discovery →
              </a>
            </div>

            {crawlResultsLoading && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
                {[...Array(8)].map((_, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <div style={{ height: 160, background: '#f1f5f9' }} />
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ height: 10, background: '#e2e8f0', borderRadius: 5, marginBottom: 6, width: '60%' }} />
                      <div style={{ height: 8, background: '#e2e8f0', borderRadius: 5, width: '80%' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!crawlResultsLoading && crawlResults.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
                {crawlResults.map((ad: any) => {
                  const thumb = ad.thumbnail_url || (ad.page_id ? `https://graph.facebook.com/${ad.page_id}/picture?type=large` : null)
                  const body = (ad.body || ad.title || '').slice(0, 100)
                  const isActive = ad.is_active
                  const initials = (ad.page_name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                  const bgColors = ['#141d15','#1e3a5f','#4a1942','#3a1a1a','#1a3a38']
                  const bgColor = bgColors[(ad.page_name || '').charCodeAt(0) % bgColors.length]
                  return (
                    <a key={ad.ad_id} href={ad.snapshot_url} target="_blank" rel="noopener noreferrer"
                      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', transition: 'box-shadow .15s' }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                    >
                      {/* Thumbnail */}
                      <div style={{ position: 'relative', height: 160, overflow: 'hidden', flexShrink: 0 }}>
                        {/* Always-visible initials base layer */}
                        <div style={{ position: 'absolute', inset: 0, background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 36, fontWeight: 800, color: '#ff5a2c', letterSpacing: -1 }}>{initials}</span>
                        </div>
                        {/* Brand/creative image on top — covers initials when it loads */}
                        {thumb && (
                          <img
                            src={thumb}
                            alt={ad.page_name}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                        {/* Status dot */}
                        <div style={{ position: 'absolute', top: 8, left: 8, width: 8, height: 8, borderRadius: '50%', background: isActive ? '#22c55e' : '#9ca3af', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                        {/* Format badge */}
                        {ad.format && (
                          <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                            {ad.format === 'Video' ? '🎬' : ad.format === 'Carousel' ? '🔁' : '🖼'} {ad.format}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/* Brand */}
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ad.page_name || 'Unknown Brand'}
                        </div>
                        {/* Ad copy */}
                        {body && (
                          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {body}
                          </div>
                        )}
                        {/* Meta row */}
                        <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 100, background: isActive ? '#f0fdf4' : '#f1f5f9', color: isActive ? '#166534' : '#6b7280' }}>
                            {isActive ? '🟢 Active' : '⚫ Ended'}
                          </span>
                          {(ad.platforms || []).slice(0, 2).map((p: string) => (
                            <span key={p} title={p} style={{ fontSize: 13 }}>{PLATFORM_ICONS[p] || '🌐'}</span>
                          ))}
                          {ad.days_running > 0 && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9ca3af' }}>
                              {ad.days_running}d
                            </span>
                          )}
                        </div>
                      </div>
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        )}
        </>
      )}

      {/* TERMS TAB */}
      {tab === 'terms' && (
        <div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>➕ Add New Term</div>

            {/* Type explainer */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {TERM_TYPES.map(t => (
                <button key={t.value} onClick={() => setNewTermType(t.value)} style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                  border: `2px solid ${newTermType === t.value ? TYPE_STYLES[t.value].border : '#e2e8f0'}`,
                  background: newTermType === t.value ? TYPE_STYLES[t.value].bg : '#f8fafc',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: newTermType === t.value ? TYPE_STYLES[t.value].color : '#374151', marginBottom: 2 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{t.hint}</div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
                  {newTermType === 'brand' ? 'BRAND NAME' : newTermType === 'category' ? 'CATEGORY KEYWORD' : 'SEARCH TERM'}
                </div>
                <input
                  value={newTerm}
                  onChange={e => setNewTerm(e.target.value)}
                  placeholder={newTermType === 'brand' ? 'e.g. Nike' : newTermType === 'category' ? 'e.g. fashion' : 'e.g. luxury watches'}
                  onKeyDown={e => e.key === 'Enter' && addTerm()}
                  style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 200 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>CATEGORY</div>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>COUNTRIES</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {COUNTRIES.map(c => (
                    <button key={c} onClick={() => setNewCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                      style={{ padding: '4px 10px', background: newCountries.includes(c) ? '#ef4a1e' : '#f1f5f9', color: newCountries.includes(c) ? '#fff' : '#374151', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>PRIORITY (1-10)</div>
                <input type="number" value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} min={1} max={10} style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 70 }} />
              </div>
              <button onClick={() => addTerm()} style={btn()}>Add Term</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <input value={termSearch} onChange={e => setTermSearch(e.target.value)} placeholder="Search terms…" style={{ padding: '8px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 260 }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>{filteredTerms.length} terms</span>
            <div style={{ marginLeft: 'auto' }}>
              <button onClick={seedDefaultTerms} disabled={seeding} style={{ ...btn('#eff6ff', '#1d4ed8'), border: '1.5px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 6 }}>
                {seeding ? '⏳ Seeding…' : '📥 Seed Default Terms'}
              </button>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, textAlign: 'right' }}>30 terms: 10 brand + 10 category + 10 ad copy</div>
            </div>
          </div>

          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                  {['Term','Type','Category','Countries','Priority','Last Crawled','Crawls','Status','Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTerms.map((t: Term) => {
                  const termType = t.term_type || 'adcopy'
                  const typeStyle = TYPE_STYLES[termType] || TYPE_STYLES.adcopy
                  const typeLabel = TERM_TYPES.find(x => x.value === termType)?.label || '📝 Ad Copy'
                  return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f8fafc' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#111' }}>{t.term}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}`, whiteSpace: 'nowrap' }}>
                        {typeLabel}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{t.category}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {(t.countries || []).map(c => <span key={c} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 4 }}>{c}</span>)}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ width: 24, height: 24, background: '#f0fdf4', color: '#166534', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{t.priority}</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                      {t.last_crawled_at ? new Date(t.last_crawled_at).toLocaleDateString() : <span style={{ color: '#f59e0b', fontWeight: 600 }}>Never</span>}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{t.crawl_count || 0}×</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: t.is_active ? '#f0fdf4' : '#fef2f2', color: t.is_active ? '#166534' : '#dc2626' }}>
                        {t.is_active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => runCrawler(t.term, t.countries?.[0] || 'US')} title="Crawl now" style={{ ...btn('#f1f5f9', '#374151'), padding: '4px 8px', fontSize: 11 }}>▶</button>
                        <button onClick={() => toggleTerm(t.id, !t.is_active)} style={{ ...btn(t.is_active ? '#fef2f2' : '#f0fdf4', t.is_active ? '#dc2626' : '#166534'), padding: '4px 8px', fontSize: 11 }}>{t.is_active ? 'Pause' : 'Resume'}</button>
                        <button onClick={() => deleteTerm(t.id)} style={{ ...btn('#fef2f2', '#dc2626'), padding: '4px 8px', fontSize: 11 }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LOG TAB */}
      {tab === 'log' && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📋 Recent Crawl Log</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                {['Time','Term','Country','Ads Fetched','Status'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(stats?.recentLog || []).map((log: LogEntry, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>{new Date(log.ran_at).toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{log.term}</td>
                  <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 4 }}>{log.country}</span></td>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#166534' }}>{log.ads_fetched}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {log.error
                      ? <span style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: 100 }}>❌ {log.error.slice(0, 50)}</span>
                      : <span style={{ fontSize: 11, color: '#166534', background: '#f0fdf4', padding: '2px 8px', borderRadius: 100 }}>✅ Success</span>
                    }
                  </td>
                </tr>
              ))}
              {!stats?.recentLog?.length && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No crawl history yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
