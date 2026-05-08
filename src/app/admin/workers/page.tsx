'use client'
import { useEffect, useState, useCallback } from 'react'

interface Worker {
  worker_id: string
  hostname: string | null
  last_active_at: string
  session_started_at: string
  session_processed: number
  session_succeeded: number
  session_failed: number
  last_batch_size: number | null
  last_batch_seconds: number | null
  ads_per_min: number | null
  is_live: boolean
  seconds_since_heartbeat: number
}

interface Summary {
  total_ads: number
  queue_remaining: number
  images_processed: number
  videos_processed: number
  progress_pct: number
  live_worker_count: number
  total_workers_seen: number
  aggregate_ads_per_min: number
  eta_minutes: number | null
}

interface Sample {
  ad_id: string
  page_name: string | null
  thumbnail_url: string | null
  video_url: string | null
  format: string | null
  last_seen: string
}

interface Data {
  summary: Summary
  workers: Worker[]
  recent_samples: Sample[]
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds - h * 3600) / 60)
  return `${h}h ${m}m`
}

function formatNum(n: number): string {
  return n.toLocaleString()
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export default function WorkersPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workers', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 5s for live updates
  useEffect(() => {
    load()
    const t = setInterval(load, 5_000)
    return () => clearInterval(t)
  }, [load])

  if (loading && !data) return <div style={{ padding: 32 }}>Loading…</div>
  if (error && !data) return <div style={{ padding: 32, color: '#c0392b' }}>Error: {error}</div>
  if (!data) return null

  const { summary, workers, recent_samples } = data

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Creative Workers</h1>
          <p style={{ fontSize: 13, color: '#666' }}>
            Self-hosted Playwright workers extracting ad creatives. Auto-refreshes every 5s.
          </p>
        </div>
        <span style={{ fontSize: 12, color: '#999' }}>
          {error ? `⚠️ ${error}` : '● live'}
        </span>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <KPI
          label="Live Workers"
          value={summary.live_worker_count}
          sub={summary.total_workers_seen > summary.live_worker_count
            ? `${summary.total_workers_seen - summary.live_worker_count} offline`
            : 'all online'}
          tone={summary.live_worker_count > 0 ? 'good' : 'warn'}
        />
        <KPI
          label="Queue"
          value={formatNum(summary.queue_remaining)}
          sub={`${summary.progress_pct}% complete`}
        />
        <KPI
          label="Throughput"
          value={`${summary.aggregate_ads_per_min.toFixed(1)}/min`}
          sub={summary.eta_minutes != null ? `ETA ${formatDuration(summary.eta_minutes * 60)}` : '—'}
        />
        <KPI
          label="Images on R2"
          value={formatNum(summary.images_processed)}
          sub={`of ${formatNum(summary.total_ads)} ads`}
        />
        <KPI
          label="Videos on R2"
          value={formatNum(summary.videos_processed)}
          sub="permanent storage"
        />
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 6 }}>
          <span>Overall progress</span>
          <span>{formatNum(summary.total_ads - summary.queue_remaining)} / {formatNum(summary.total_ads)}</span>
        </div>
        <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              width: `${summary.progress_pct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4ade80, #22c55e)',
              transition: 'width 0.4s',
            }}
          />
        </div>
      </div>

      {/* Worker table */}
      <Section title="Workers">
        {workers.length === 0 ? (
          <Empty>
            No workers have checked in yet. Deploy the worker — see <code>worker/DEPLOY.md</code>.
          </Empty>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                <tr>
                  {['Status', 'Worker', 'Host', 'ads/min', 'Session', 'Success', 'Last batch', 'Heartbeat'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: '#666' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => {
                  const successRate = w.session_processed > 0
                    ? Math.round((w.session_succeeded / w.session_processed) * 100)
                    : 0
                  const sessionSec = Math.floor(
                    (Date.now() - new Date(w.session_started_at).getTime()) / 1000,
                  )
                  return (
                    <tr key={w.worker_id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: w.is_live ? '#22c55e' : '#999', marginRight: 6,
                        }} />
                        {w.is_live ? 'live' : 'offline'}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{w.worker_id}</td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{w.hostname || '—'}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{w.ads_per_min ?? '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{formatDuration(sessionSec)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {formatNum(w.session_succeeded)}/{formatNum(w.session_processed)}
                        <span style={{ color: '#999', marginLeft: 6, fontSize: 11 }}>({successRate}%)</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>
                        {w.last_batch_size != null ? `${w.last_batch_size} in ${w.last_batch_seconds}s` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: w.is_live ? '#666' : '#c0392b' }}>
                        {timeAgo(w.last_active_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Recent processed creatives */}
      <Section title={`Recently processed (${recent_samples.length})`}>
        {recent_samples.length === 0 ? (
          <Empty>No creatives stored on R2 yet.</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {recent_samples.map((s) => (
              <div key={s.ad_id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
                {s.thumbnail_url ? (
                  <img
                    src={s.thumbnail_url}
                    alt={s.page_name || s.ad_id}
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }}
                  />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '1/1', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 11 }}>
                    no image
                  </div>
                )}
                <div style={{ padding: '6px 8px', fontSize: 11 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.page_name || '—'}
                  </div>
                  <div style={{ color: '#999', fontSize: 10 }}>
                    {s.format || '—'} · {timeAgo(s.last_seen)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function KPI({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'good' | 'warn' }) {
  const toneColor = tone === 'good' ? '#22c55e' : tone === 'warn' ? '#f59e0b' : '#111'
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: toneColor, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{title}</h2>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px dashed #ccc', borderRadius: 8, padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>
      {children}
    </div>
  )
}
