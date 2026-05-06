'use client'
import { useState, useEffect, useCallback } from 'react'

const COUNTRIES = ['US','GB','CA','AU','IN','DE','FR','AE','PK','NG','SG','NZ']
const CATEGORIES = ['Fashion & Apparel','Beauty & Skincare','Health & Wellness','Fitness & Sports','Food & Beverage','Technology','Finance & Investing','Home & Living','Baby & Kids','Pets','Travel','Education','Business & Marketing','Entertainment','Automotive','General']

interface Term {
  id: string; term: string; category: string; countries: string[]
  is_active: boolean; priority: number; last_crawled_at: string | null
  crawl_count: number; ads_found: number; created_at: string
}
interface LogEntry { term: string; country: string; ads_fetched: number; error?: string; ran_at: string }

export default function IndexerAdminPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState<string[]>([])
  const [tab, setTab] = useState<'overview'|'terms'|'log'>('overview')
  const [newTerm, setNewTerm] = useState('')
  const [newCategory, setNewCategory] = useState('General')
  const [newCountries, setNewCountries] = useState<string[]>(['US'])
  const [newPriority, setNewPriority] = useState(5)
  const [termSearch, setTermSearch] = useState('')
  const [runTerm, setRunTerm] = useState('')
  const [runCountry, setRunCountry] = useState('US')

  const fetchStats = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/indexer?action=stats')
    const data = await res.json()
    setStats(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const runCrawler = async (term?: string, country?: string) => {
    setRunning(true)
    setRunLog(['🚀 Starting crawler...'])
    try {
      const params = new URLSearchParams({ stream: '1' })
      if (term) params.set('term', term)
      if (country) params.set('country', country)
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
        // Split on double-newline (SSE) or single newline (NDJSON)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.replace(/^data:\s*/, '').trim()
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.msg) setRunLog(prev => [...prev, String(parsed.msg)])
            if (parsed.type === 'done') fetchStats()
          } catch {
            // Show raw line if it's not JSON
            if (line) setRunLog(prev => [...prev, line])
          }
        }
      }
    } catch (e: any) {
      setRunLog(prev => [...prev, `❌ ${String(e?.message ?? e)}`])
    }
    setRunning(false)
  }

  const addTerm = async () => {
    if (!newTerm.trim()) return
    await fetch('/api/admin/indexer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_term', term: newTerm, category: newCategory, countries: newCountries, priority: newPriority }),
    })
    setNewTerm('')
    fetchStats()
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

  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }
  const btn = (color = '#1a3a1a', text = '#dffe95') => ({ padding: '8px 18px', background: color, color: text, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const)

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, fontSize: 16, color: '#6b7280' }}>Loading indexer stats…</div>

  return (
    <div style={{ maxWidth: 1100 }}>

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
          <button onClick={() => runCrawler()} disabled={running} style={btn()}>
            {running ? '⏳ Running…' : '▶ Run Crawler Now'}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Ads Indexed', value: stats?.totalAds?.toLocaleString() || '0', icon: '📦', color: '#1a3a1a' },
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Manual run */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>⚡ Manual Crawl</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={runTerm} onChange={e => setRunTerm(e.target.value)} placeholder="Enter term (e.g. yoga mats)" style={{ flex: 1, padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              <select value={runCountry} onChange={e => setRunCountry(e.target.value)} style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <button onClick={() => runCrawler(runTerm || undefined, runCountry)} disabled={running} style={btn()}>Run</button>
            </div>
            {runLog.length > 0 && (
              <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, maxHeight: 260, overflowY: 'auto' }}>
                {runLog.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: l.startsWith('❌') ? '#f87171' : l.startsWith('✅') || l.startsWith('🎉') ? '#4ade80' : l.startsWith('⚠️') ? '#fbbf24' : '#94a3b8', fontFamily: 'monospace', marginBottom: 2, wordBreak: 'break-all' }}>{l}</div>
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
                    <div style={{ height: '100%', background: '#1a3a1a', borderRadius: 3, width: `${Math.min(100, (count / max) * 100)}%` }} />
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
      )}

      {/* TERMS TAB */}
      {tab === 'terms' && (
        <div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>➕ Add New Term</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>SEARCH TERM</div>
                <input value={newTerm} onChange={e => setNewTerm(e.target.value)} placeholder="e.g. luxury watches" onKeyDown={e => e.key === 'Enter' && addTerm()} style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 200 }} />
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
                      style={{ padding: '4px 10px', background: newCountries.includes(c) ? '#1a3a1a' : '#f1f5f9', color: newCountries.includes(c) ? '#dffe95' : '#374151', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>PRIORITY (1-10)</div>
                <input type="number" value={newPriority} onChange={e => setNewPriority(Number(e.target.value))} min={1} max={10} style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 70 }} />
              </div>
              <button onClick={addTerm} style={btn()}>Add Term</button>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <input value={termSearch} onChange={e => setTermSearch(e.target.value)} placeholder="Search terms…" style={{ padding: '8px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 300 }} />
            <span style={{ marginLeft: 12, fontSize: 12, color: '#6b7280' }}>{filteredTerms.length} terms</span>
          </div>

          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                  {['Term','Category','Countries','Priority','Last Crawled','Crawls','Status','Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTerms.map((t: Term) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f8fafc' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#111' }}>{t.term}</td>
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
                        <button onClick={() => runCrawler(t.term, 'US')} title="Crawl now" style={{ ...btn('#f1f5f9', '#374151'), padding: '4px 8px', fontSize: 11 }}>▶</button>
                        <button onClick={() => toggleTerm(t.id, !t.is_active)} style={{ ...btn(t.is_active ? '#fef2f2' : '#f0fdf4', t.is_active ? '#dc2626' : '#166534'), padding: '4px 8px', fontSize: 11 }}>{t.is_active ? 'Pause' : 'Resume'}</button>
                        <button onClick={() => deleteTerm(t.id)} style={{ ...btn('#fef2f2', '#dc2626'), padding: '4px 8px', fontSize: 11 }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
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
