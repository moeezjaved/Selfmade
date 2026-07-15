/**
 * Public, no-auth shared report snapshot (/r/<token>). Reads the frozen JSON from R2 and renders it
 * read-only — this is what a client/partner sees from a "Share once" link or a partner invite email.
 * Branded, with a soft CTA to sign up. Snapshots are frozen at share time (data won't update).
 */
import { r2PublicUrl } from '@/lib/r2'
import { METRICS, type MetricKey } from '@/lib/reports/templates'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getSnapshot(token: string): Promise<any | null> {
  if (!/^[a-z0-9]{6,40}$/i.test(token)) return null
  const url = r2PublicUrl(`shared-reports/${token}.json`)
  if (!url) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const snap = await getSnapshot(params.token)
  return { title: snap ? `${snap.name} · Shared report` : 'Shared report', robots: { index: false, follow: false } }
}

function fmt(v: number, key: MetricKey, currency: string): string {
  const m = METRICS[key]; const n = Number(v) || 0
  if (!m) return String(n)
  switch (m.format) {
    case 'currency': return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
    case 'percent': return n.toFixed(2) + '%'
    case 'ratio': return n.toFixed(2) + 'x'
    case 'seconds': return n.toFixed(1) + 's'
    default: return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
  }
}

const cdn = (u?: string | null, w = 96) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? (u || '') : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=75&output=webp`

export default async function SharedReportPage({ params }: { params: { token: string } }) {
  const snap = await getSnapshot(params.token)

  if (!snap) {
    return (
      <div style={{ minHeight: '100vh', background: '#eef5eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#3a5a3a' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1a3a1a' }}>This shared report isn’t available</div>
          <div style={{ fontSize: 14, marginTop: 6 }}>The link may have expired or been removed.</div>
          <a href="https://tryselfmade.ai" style={{ display: 'inline-block', marginTop: 18, background: '#1a3a1a', color: '#dffe95', padding: '10px 20px', borderRadius: 100, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>Go to Selfmade</a>
        </div>
      </div>
    )
  }

  const metrics: MetricKey[] = snap.metrics || []
  const rows: any[] = snap.rows || []
  const net = snap.netResults || {}
  const currency = snap.currency || 'USD'

  return (
    <div style={{ minHeight: '100vh', background: '#eef5eb', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif' }}>
      {/* Top bar */}
      <div style={{ background: '#1a3a1a', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="https://tryselfmade.ai" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: '#dffe95', color: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, fontStyle: 'italic', fontFamily: 'Georgia,serif' }}>S</span>
          <span style={{ color: '#dffe95', fontWeight: 800, fontSize: 15 }}>Selfmade</span>
        </a>
        <a href="https://tryselfmade.ai" style={{ color: '#1a3a1a', background: '#dffe95', padding: '7px 15px', borderRadius: 100, textDecoration: 'none', fontWeight: 700, fontSize: 12.5 }}>Try Selfmade free</a>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: 6, fontSize: 12, color: '#7a9a7a', fontWeight: 600 }}>Shared by {snap.sharedBy}</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#1a3a1a', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{snap.emoji || '📊'}</span>{snap.name}
        </div>
        {snap.description && <div style={{ fontSize: 14, color: '#7a9a7a', marginTop: 4 }}>{snap.description}</div>}

        {snap.note && (
          <div style={{ marginTop: 16, background: '#fff', border: '1px solid #d8e6d4', borderRadius: 12, padding: '14px 18px', color: '#2a3a2a', fontSize: 14.5, lineHeight: 1.6 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#5a7a5a', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Note</span>
            “{snap.note}”
          </div>
        )}

        {/* Table — scrolls horizontally when there are many metric columns. The scrollbar is forced
            visible (macOS hides overlay scrollbars, which made the last column look cut off). */}
        <div style={{ position: 'relative', marginTop: 20, background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          <div className="snap-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: '#f6faf4', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#7a9a7a', minWidth: 220 }}>Creative</th>
                  {metrics.map(m => (
                    <th key={m} style={{ padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#7a9a7a', whiteSpace: 'nowrap' }}>{METRICS[m]?.label || m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '11px 14px', textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: '#b5c5b5', width: 16 }}>{i + 1}</span>
                        <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#f0f7ee', border: '1px solid rgba(0,0,0,0.06)' }}>
                          {r.thumbnail
                            ? <img src={cdn(r.thumbnail, 96)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{r.format === 'video' ? '🎬' : r.format === 'carousel' ? '🎠' : '🖼️'}</div>}
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1a3a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.name}</div>
                      </div>
                    </td>
                    {metrics.map(m => (
                      <td key={m} style={{ padding: '11px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: m === 'roas' ? (r.metrics?.[m] >= 2 ? '#2d7a2d' : r.metrics?.[m] >= 1 ? '#b8860b' : '#c0392b') : '#2a3a2a', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {fmt(r.metrics?.[m] ?? 0, m, currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#1a3a1a', color: '#dffe95' }}>
                  <td style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 900 }}>Net results</td>
                  {metrics.map(m => (
                    <td key={m} style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(net[m] || 0, m, currency)}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer CTA */}
        <div style={{ marginTop: 26, textAlign: 'center', color: '#7a9a7a', fontSize: 13 }}>
          Made with <a href="https://tryselfmade.ai" style={{ color: '#2d7a2d', fontWeight: 700, textDecoration: 'none' }}>Selfmade</a> — spy, remake, launch &amp; track winning ads.
        </div>
      </div>

      <style>{`
        .snap-scroll { scrollbar-width: thin; scrollbar-color: #b9cdb4 transparent; }
        .snap-scroll::-webkit-scrollbar { height: 10px; }
        .snap-scroll::-webkit-scrollbar-thumb { background: #b9cdb4; border-radius: 8px; }
        .snap-scroll::-webkit-scrollbar-thumb:hover { background: #9fbf98; }
        .snap-scroll::-webkit-scrollbar-track { background: #f2f7f0; }
      `}</style>
    </div>
  )
}
