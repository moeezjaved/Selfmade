'use client'

/**
 * Admin health dashboard.
 *
 * Polls /api/admin/health every 30s. Renders:
 *   - Top alert bar (critical/warning health issues)
 *   - 4-column daemon status row (preview-server, scheduler, worker, last activity)
 *   - Queue overview KPIs
 *   - 24h activity panel (success rate, bandwidth, ads discovered)
 *   - Per-brand table (top 10 active brands by oldest crawl)
 *   - Recent runs table (last 10 crawler runs)
 *
 * No external chart libs — all native React + CSS so it loads fast and has
 * no client-side JS bloat. Refresh button + auto-refresh toggle in header.
 */
import { useEffect, useState, useCallback } from 'react'

interface HealthData {
  timestamp: string
  currently_running: {
    brand: string | null
    page_id: string | null
    started_at: string
    elapsed_seconds: number
  } | null
  next_crawl: {
    brand: string
    page_id: string
    eligible_at: string
    eta_seconds: number
    reason: string
  } | null
  queue: {
    total: number
    thumbed: number
    fast_path_ready: number
    missing: number
    failed: number
    thumbed_pct: number
  }
  activity: {
    runs_1h: number
    runs_24h: number
    success_rate_1h_pct: number | null
    success_rate_24h_pct: number | null
    bandwidth_24h_bytes: number
    bandwidth_24h_mb: number
    ads_discovered_24h: number
    last_run_at: string | null
    last_success_at: string | null
    minutes_since_last_run: number | null
  }
  daemons: {
    preview_server: { status: string; latency_ms: number | null; url: string | null }
    scheduler: { status: string; note: string }
    worker: { status: string; recent_thumbnails_added: number; note: string }
  }
  brands: Array<{
    term: string; page_id: string; last_crawled_at: string | null
    thumbed: number; fastReady: number; missing: number; failed: number
  }>
  recent_runs: Array<{
    brand_name: string; started_at: string; finished_at: string | null
    duration_s: number | null; ads_discovered: number; ads_new: number
    bytes: number; status: string; abort_reason: string | null
  }>
  alerts: Array<{ level: 'critical' | 'warning' | 'info'; message: string }>
}

export default function HealthDashboard() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  // Tick once per second so the next-crawl countdown updates live
  // without re-fetching the API every time.
  const [tickNow, setTickNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/health', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setData(j)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>System Health</h1>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {data ? `Last updated ${new Date(data.timestamp).toLocaleTimeString()}` : 'Loading…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', color: '#666' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            auto-refresh 30s
          </label>
          <button onClick={load} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: loading ? 'wait' : 'pointer', fontSize: 13 }}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fbb', borderRadius: 8, marginBottom: 18, color: '#900' }}>
          Error loading health: {error}
        </div>
      )}

      {!data && !error && <div style={{ padding: 24, color: '#888' }}>Loading…</div>}

      {data && (
        <>
          {/* ───── Alert bar ───── */}
          {data.alerts.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              {data.alerts.map((a, i) => (
                <div key={i} style={{
                  padding: '10px 14px',
                  background: a.level === 'critical' ? '#fee' : '#fef3c7',
                  borderLeft: `4px solid ${a.level === 'critical' ? '#dc2626' : '#d97706'}`,
                  borderRadius: 4,
                  marginBottom: 6,
                  fontSize: 13,
                  color: a.level === 'critical' ? '#7f1d1d' : '#78350f',
                }}>
                  <strong>{a.level.toUpperCase()}:</strong> {a.message}
                </div>
              ))}
            </div>
          )}

          {/* ───── Daemons row ───── */}
          <Section
            title="Daemons"
            hint="The 3 background processes that keep the system running. preview-server powers the admin Preview button. scheduler crawls brands every ~3 min in rotation. worker downloads creative images/videos to R2. All three should be GREEN."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div title="The HTTP server on the droplet that powers the admin Preview button. If this is DOWN, the Preview button stops working but the rest of the system keeps running.">
                <DaemonCard
                  name="preview-server"
                  status={data.daemons.preview_server.status}
                  detail={data.daemons.preview_server.url
                    ? `${data.daemons.preview_server.url} · ${data.daemons.preview_server.latency_ms ?? '?'}ms`
                    : 'DROPLET_PREVIEW_URL not set'}
                />
              </div>
              <div title="The background loop that crawls brands every ~3 min. Picks the oldest-crawled active brand each cycle, with a 45-min minimum gap per brand to avoid Meta throttling.">
                <DaemonCard
                  name="scheduler"
                  status={data.daemons.scheduler.status}
                  detail={data.daemons.scheduler.note}
                />
              </div>
              <div title="The background worker that takes ad URLs the indexer found and downloads the actual images/videos to R2. Status 'up' = thumbnails added in last hour. 'idle' = running but nothing new to process right now.">
                <DaemonCard
                  name="worker"
                  status={data.daemons.worker.status}
                  detail={`+${data.daemons.worker.recent_thumbnails_added} thumbnails in last hour`}
                />
              </div>
            </div>
          </Section>

          {/* ───── Currently running / next crawl ───── */}
          <Section
            title="Crawler schedule"
            hint="What the indexer is doing right now and which brand is up next. Scheduler picks oldest-crawled brand first, with 45-min minimum gap between crawls of the same brand."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <CountdownCard
                title="Currently crawling"
                emptyText="(idle — no crawl running)"
                isCountdown={false}
                running={data.currently_running ? {
                  brand: data.currently_running.brand ?? `page_id ${data.currently_running.page_id ?? '?'}`,
                  started_at: data.currently_running.started_at,
                  tickNow,
                } : null}
              />
              <CountdownCard
                title="Next crawl"
                emptyText="(no eligible brands — add active brands)"
                isCountdown={true}
                next={data.next_crawl ? {
                  brand: data.next_crawl.brand || `page_id ${data.next_crawl.page_id}`,
                  eligible_at: data.next_crawl.eligible_at,
                  reason: data.next_crawl.reason,
                  tickNow,
                } : null}
              />
            </div>
          </Section>

          {/* ───── Queue ───── */}
          <Section
            title="Ad queue"
            hint="Snapshot of every ad ever discovered, broken down by processing state. Total includes ads from all brands ever crawled (even inactive ones)."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              <KPI label="Total" value={data.queue.total.toLocaleString()} hint="Every ad ID in the database across all brands. New ads land here when the indexer crawls a brand." />
              <KPI label="With thumbnails" value={data.queue.thumbed.toLocaleString()} sub={`${data.queue.thumbed_pct}%`} hint="Ads where the worker successfully downloaded a creative to R2. These are visible in your discovery section." />
              <KPI label="Fast-path ready" value={data.queue.fast_path_ready.toLocaleString()} sub="raw URLs populated" tone={data.queue.fast_path_ready > 0 ? 'good' : 'warn'} hint="Ads where the indexer extracted creative URLs directly from Meta's GraphQL response. The worker processes these in ~5s each (vs ~25s for the legacy DOM path). >0 = healthy." />
              <KPI label="Missing" value={data.queue.missing.toLocaleString()} hint="Ads with no thumbnail yet. Worker will eventually process them, fast-path-ready first then legacy." />
              <KPI label="Marked failed" value={data.queue.failed.toLocaleString()} tone={data.queue.failed > 1000 ? 'warn' : 'neutral'} hint="Ads the worker tried 3 times and gave up on (usually because Meta returned a 1087-byte placeholder = ad expired/deleted before we could grab it). Reset by setting creative_extraction_failed_at = NULL in SQL." />
            </div>
          </Section>

          {/* ───── Activity ───── */}
          <Section
            title="Crawler activity (last 24h)"
            hint="What the indexer (scheduler) has done in the last 24 hours. Each 'run' = one crawl of one brand."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <KPI
                label="Runs (24h)"
                value={data.activity.runs_24h}
                sub={data.activity.runs_1h !== null ? `${data.activity.runs_1h} in last hour` : ''}
                hint="Number of brand crawls the scheduler completed. Each cycle picks one brand, runs the indexer, sleeps 3 min, picks next."
              />
              <KPI
                label="Success rate"
                value={data.activity.success_rate_24h_pct !== null ? `${data.activity.success_rate_24h_pct}%` : '—'}
                sub={data.activity.success_rate_1h_pct !== null ? `${data.activity.success_rate_1h_pct}% in last hour` : ''}
                tone={data.activity.success_rate_24h_pct === null ? 'neutral' : data.activity.success_rate_24h_pct >= 70 ? 'good' : 'warn'}
                hint="Percentage of crawls that finished cleanly. <70% = something is wrong (Meta throttling, proxy issues). Investigate via the recent runs table below."
              />
              <KPI
                label="Ads discovered"
                value={data.activity.ads_discovered_24h.toLocaleString()}
                hint="Total ad IDs the indexer pulled from Meta's GraphQL responses in the last 24h. Includes duplicates from earlier runs."
              />
              <KPI
                label="Proxy bandwidth"
                value={`${data.activity.bandwidth_24h_mb} MB`}
                sub="last 24h via IPRoyal"
                hint="Bandwidth consumed through your IPRoyal residential proxy. Indexer ~3-5 MB per crawl, worker ~300 KB per ad. Watch this against your IPRoyal monthly cap."
              />
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
              Last run: {data.activity.last_run_at ? humanAgo(data.activity.last_run_at) : '—'} ago
              {data.activity.last_success_at && data.activity.last_success_at !== data.activity.last_run_at &&
                ` · last success: ${humanAgo(data.activity.last_success_at)} ago`
              }
            </div>
          </Section>

          {/* ───── Brands ───── */}
          <Section
            title="Active brands (oldest crawl first)"
            hint="Your is_active=true brands, sorted by which one was crawled longest ago (the next one the scheduler will pick)."
          >
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRow}>
                  <th style={th} title="Brand name + Facebook page_id">brand</th>
                  <th style={thRight} title="Ads with thumbnails downloaded to R2 (visible in discovery section).">thumbed</th>
                  <th style={thRight} title="Ads where indexer found creative URLs in GraphQL — worker will process at ~5s each.">fast-path</th>
                  <th style={thRight} title="Ads still awaiting worker processing.">missing</th>
                  <th style={thRight} title="Ads worker tried and gave up on (Meta returned placeholders = ad expired).">failed</th>
                  <th style={th} title="When the scheduler last crawled this brand. Min 45 min between crawls.">last crawl</th>
                </tr>
              </thead>
              <tbody>
                {data.brands.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#888' }}>No active brands.</td></tr>}
                {data.brands.map(b => (
                  <tr key={b.page_id} style={tableRow}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{b.term}</div>
                      <div style={{ fontSize: 10, color: '#888', fontFamily: 'ui-monospace, monospace' }}>{b.page_id}</div>
                    </td>
                    <td style={tdRight}>{b.thumbed.toLocaleString()}</td>
                    <td style={{ ...tdRight, color: b.fastReady > 0 ? '#15803d' : '#888' }}>{b.fastReady.toLocaleString()}</td>
                    <td style={tdRight}>{b.missing.toLocaleString()}</td>
                    <td style={{ ...tdRight, color: b.failed > 0 ? '#b91c1c' : '#888' }}>{b.failed.toLocaleString()}</td>
                    <td style={{ ...td, color: '#666', fontSize: 12 }}>{b.last_crawled_at ? `${humanAgo(b.last_crawled_at)} ago` : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* ───── Recent runs ───── */}
          <Section title="Recent crawler runs (last 10)">
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRow}>
                  <th style={th}>brand</th>
                  <th style={thRight}>discovered</th>
                  <th style={thRight}>new</th>
                  <th style={thRight}>bandwidth</th>
                  <th style={thRight}>duration</th>
                  <th style={th}>status</th>
                  <th style={th}>started</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#888' }}>No recent runs.</td></tr>}
                {data.recent_runs.map((r, i) => (
                  <tr key={i} style={tableRow}>
                    <td style={td}>{r.brand_name ?? '—'}</td>
                    <td style={tdRight}>{r.ads_discovered}</td>
                    <td style={{ ...tdRight, color: r.ads_new > 0 ? '#15803d' : '#666' }}>{r.ads_new}</td>
                    <td style={tdRight}>{r.bytes ? `${(r.bytes / 1024).toFixed(1)} KB` : '—'}</td>
                    <td style={tdRight}>{r.duration_s ? `${r.duration_s}s` : '—'}</td>
                    <td style={td}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: r.status === 'success' ? '#dcfce7' : r.status === 'aborted' ? '#fef3c7' : r.status === 'running' ? '#dbeafe' : '#fee',
                        color: r.status === 'success' ? '#166534' : r.status === 'aborted' ? '#92400e' : r.status === 'running' ? '#1e40af' : '#991b1b',
                      }}>{r.status}</span>
                      {r.abort_reason && <div style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>{r.abort_reason}</div>}
                    </td>
                    <td style={{ ...td, color: '#666', fontSize: 12 }}>{humanAgo(r.started_at)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 13, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {title}
        {hint && (
          <span title={hint} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 14, borderRadius: '50%', background: '#e5e7eb', color: '#6b7280',
            fontSize: 10, fontWeight: 700, cursor: 'help', userSelect: 'none',
          }}>?</span>
        )}
      </h2>
      {children}
    </div>
  )
}

function KPI({ label, value, sub, tone = 'neutral', hint }: { label: string; value: string | number; sub?: string; tone?: 'good' | 'warn' | 'neutral'; hint?: string }) {
  const color = tone === 'good' ? '#166534' : tone === 'warn' ? '#92400e' : '#111'
  const bg = tone === 'good' ? '#f0fdf4' : tone === 'warn' ? '#fffbeb' : '#fff'
  return (
    <div title={hint} style={{ background: bg, border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', cursor: hint ? 'help' : 'default' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function CountdownCard({ title, emptyText, isCountdown, running, next }: {
  title: string
  emptyText: string
  isCountdown: boolean
  running?: { brand: string; started_at: string; tickNow: number } | null
  next?: { brand: string; eligible_at: string; reason: string; tickNow: number } | null
}) {
  const isEmpty = !running && !next

  let bigText = emptyText
  let subText = ''
  let bg = '#fff'
  let border = '#e5e7eb'
  let color = '#9ca3af'

  if (running) {
    const elapsed = Math.max(0, Math.round((running.tickNow - new Date(running.started_at).getTime()) / 1000))
    bigText = formatHMS(elapsed)
    subText = `${running.brand} · started ${humanAgo(running.started_at)} ago`
    bg = '#eff6ff'
    border = '#bfdbfe'
    color = '#1e40af'
  } else if (next) {
    const eligibleMs = new Date(next.eligible_at).getTime()
    const remaining = Math.max(0, Math.round((eligibleMs - next.tickNow) / 1000))
    bigText = remaining > 0 ? formatHMS(remaining) : 'now'
    subText = `${next.brand} · ${next.reason}`
    bg = remaining > 0 ? '#fffbeb' : '#f0fdf4'
    border = remaining > 0 ? '#fde68a' : '#bbf7d0'
    color = remaining > 0 ? '#92400e' : '#166534'
  }

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color, lineHeight: 1.1 }}>{bigText}</div>
      {subText && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{subText}</div>}
    </div>
  )
}

function formatHMS(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s.toString().padStart(2, '0')}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function DaemonCard({ name, status, detail }: { name: string; status: string; detail: string }) {
  const colors: Record<string, { bg: string; border: string; dot: string; text: string }> = {
    up: { bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e', text: '#166534' },
    idle: { bg: '#fffbeb', border: '#fde68a', dot: '#d97706', text: '#92400e' },
    down: { bg: '#fee', border: '#fbb', dot: '#dc2626', text: '#7f1d1d' },
    unknown: { bg: '#f3f4f6', border: '#e5e7eb', dot: '#9ca3af', text: '#374151' },
  }
  const c = colors[status] ?? colors.unknown
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.dot }} />
        <strong style={{ fontSize: 14 }}>{name}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: c.text, fontWeight: 600, textTransform: 'uppercase' }}>{status}</span>
      </div>
      <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>{detail}</div>
    </div>
  )
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }
const tableHeaderRow: React.CSSProperties = { background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }
const tableRow: React.CSSProperties = { borderBottom: '1px solid #f3f4f6' }
const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }
const thRight: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: '#111' }
const tdRight: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }

function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}
