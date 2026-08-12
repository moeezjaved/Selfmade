'use client'
/**
 * BrandGuardianCard — the defensive card on the Morning Brief. "What your competitors did overnight" (new
 * ads from your spied rivals, from our own crawl) + public conversation (Reddit) about you and shoppers
 * leaving your rivals. Self-fetching, cached, self-hiding when quiet. Advisory only.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const INK = '#141d15', MUTED = '#6b6b6b', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#141d15', LIME = '#ff5a2c'

type Alert = { pageId: string; brand: string; kind: string; newCount: number; activeCount: number; headline: string; detail: string; image?: string | null; href: string }
type Mention = { source: string; title: string; url: string; where: string; kind: 'you' | 'shoppers' }
type SiteAlert = { pageId: string; brand: string; kind: 'price' | 'offer'; headline: string; detail: string; url: string }
type Data = { alerts: Alert[]; mentions: Mention[]; siteAlerts?: SiteAlert[]; crawl?: { lastCheckedAt: string | null; hours: number | null }; generatedAt: string }

export default function BrandGuardianCard({ brandId }: { brandId?: string | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (fresh = false) => {
    setLoading(true)
    const q = new URLSearchParams()
    if (brandId) q.set('brand', brandId)
    if (fresh) q.set('fresh', '1')
    fetch(`/api/guardian${q.toString() ? `?${q}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && !j.error) setData(j) })
      .catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  const [rechecking, setRechecking] = useState(false)
  const recheck = async () => {
    setRechecking(true)
    try {
      const j = await fetch('/api/guardian/recheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandId }) }).then(r => r.json())
      if (j?.ok) toast.success(`Queued a fresh crawl of ${j.queued} competitor${j.queued === 1 ? '' : 's'} — new ads show within a couple of hours.`)
      else toast.error('Could not queue a re-check.')
    } catch { toast.error('Could not queue a re-check.') } finally { setRechecking(false) }
  }

  const staleCrawl = !!(data?.crawl && data.crawl.hours != null && data.crawl.hours >= 24)
  if (!loading && (!data || (data.alerts.length === 0 && data.mentions.length === 0 && (data.siteAlerts || []).length === 0 && !staleCrawl))) return null
  const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

  return (
    <div className="bsx-e" style={{ ...card, marginBottom: 24, overflow: 'hidden', animationDelay: '.42s' }}>
      <div style={{ padding: '16px 22px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: '#9aa79a' }}>🛡️ Brand Guardian · overnight</div>
        {data && <button onClick={() => load(true)} disabled={loading} style={{ background: '#f2f4ef', color: INK, border: 'none', borderRadius: 100, padding: '5px 11px', fontSize: 11.5, fontWeight: 750, fontFamily: 'inherit', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? '…' : '↻'}</button>}
      </div>

      {loading && !data ? <div style={{ padding: '4px 22px 18px', fontSize: 13.5, color: SUB }}>Checking your competitors + the chatter…</div> : (
        <div style={{ padding: '0 22px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* competitor moves */}
          {(data?.alerts || []).map((a, i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {a.image
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={a.image} alt="" style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#eef2ec' }} onError={(e: any) => { e.target.style.display = 'none' }} />
                : <span style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, background: '#f2f4ef', display: 'grid', placeItems: 'center', fontSize: 18 }}>{a.kind === 'scaling' ? '🚀' : '🎬'}</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 750, color: INK, lineHeight: 1.35 }}>{a.headline}</div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginTop: 3 }}>{a.detail}</div>
                <Link href={a.href} style={{ display: 'inline-block', marginTop: 8, background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>See their ads →</Link>
              </div>
            </div>
          ))}

          {/* rival price / offer moves (website watch) */}
          {(data?.siteAlerts || []).map((s, i) => (
            <div key={`s${i}`} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, background: '#fef6e7', display: 'grid', placeItems: 'center', fontSize: 18 }}>{s.kind === 'price' ? '🏷️' : '🎯'}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 750, color: INK, lineHeight: 1.35 }}>{s.headline}</div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginTop: 3 }}>{s.detail}</div>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 750, textDecoration: 'none' }}>See their site ↗</a>
              </div>
            </div>
          ))}

          {/* mentions */}
          {(data?.mentions || []).length > 0 && (
            <div style={{ marginTop: 2 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a7b0a5', marginBottom: 6 }}>People are talking</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(data?.mentions || []).map((m, i) => (
                  <a key={i} href={m.url} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 8, alignItems: 'baseline', textDecoration: 'none', color: INK, fontSize: 12.5, lineHeight: 1.4 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: m.kind === 'shoppers' ? '#2f5bd0' : '#3b6d11', background: m.kind === 'shoppers' ? '#eef4ff' : '#eaf3de', borderRadius: 5, padding: '1px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>{m.kind === 'shoppers' ? 'SHOPPERS' : 'YOU'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title} <span style={{ color: '#a7b0a5' }}>· {m.where} ↗</span></span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {/* Crawl freshness — so a stalled crawler (why new ads aren't noticed) is visible + fixable. */}
          {data?.crawl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
              <span style={{ fontSize: 11.5, color: staleCrawl ? '#b7791f' : '#a7b0a5', fontWeight: staleCrawl ? 700 : 500 }}>
                {data.crawl.hours == null ? 'Competitors not checked yet' : `Competitors last checked ${data.crawl.hours}h ago`}{staleCrawl ? ' — that’s stale' : ''}
              </span>
              <button onClick={recheck} disabled={rechecking} style={{ background: staleCrawl ? FOREST : '#f2f4ef', color: staleCrawl ? LIME : INK, border: 'none', borderRadius: 100, padding: '4px 12px', fontSize: 11.5, fontWeight: 750, fontFamily: 'inherit', cursor: rechecking ? 'default' : 'pointer', opacity: rechecking ? 0.6 : 1 }}>
                {rechecking ? 'Queuing…' : '↻ Re-check now'}
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#a7b0a5' }}>From your spied competitors’ ads + sites + public Reddit/YouTube chatter. Watch-only — no action taken.</div>
        </div>
      )}
    </div>
  )
}
