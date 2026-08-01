'use client'
/**
 * FacebookAdsCard — the Morning Brief's money card. Server paints it instantly from the primary
 * account's cached audit; on mount it fetches /api/meta/audit-summary to add TODAY's spend and the
 * account switcher, so the founder can flip between their connected accounts (ROY 1, ROY 4, …) right
 * on the brief and see each one's spend-today, 14-day ROAS, and who to scale/pause — without leaving.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Camp = { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null }
type Summary = {
  accounts?: { accountId: string; name: string; currency: string; isPrimary: boolean }[]
  selected?: string; currency?: string; accountName?: string | null
  total: number; spend: number; avgRoas: number; spendToday?: number
  counts?: { scale: number; watch: number; pause: number }
  scale: Camp[]; watch: Camp[]; pause: Camp[]
}

const headline = (d: Summary) => {
  const c = d.counts || { scale: d.scale.length, watch: d.watch.length, pause: d.pause.length }
  const parts: string[] = []
  if (c.scale) parts.push(`${c.scale} ready to scale`)
  if (c.watch) parts.push(`${c.watch} catchy but not converting`)
  if (c.pause) parts.push(`${c.pause} burning budget`)
  return `I audited your ${d.total} campaign${d.total === 1 ? '' : 's'} — ${parts.length ? parts.join(', ') : 'all steady'}.`
}

export default function FacebookAdsCard({ initial, ctaHref = '/reports', ctaLabel = 'See the full report', onAct }: {
  initial: Summary; ctaHref?: string; ctaLabel?: string; onAct?: () => void
}) {
  const [d, setD] = useState<Summary>(initial)
  const [accounts, setAccounts] = useState<Summary['accounts']>([])
  const [sel, setSel] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const load = (accountId?: string) => {
    setBusy(true)
    fetch(`/api/meta/audit-summary${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j || j.error) return
        if (Array.isArray(j.accounts)) setAccounts(j.accounts)
        if (j.selected) setSel(j.selected)
        if (typeof j.total === 'number') setD(j)
      })
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }
  const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

  const Bucket = ({ label, color, dot, rows, suffix }: { label: string; color: string; dot: string; rows: Camp[]; suffix: (c: Camp) => string }) => (
    rows.length ? (
      <div style={{ flex: '1 1 200px', minWidth: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color, marginBottom: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{label} · {rows.length}
        </div>
        {rows.slice(0, 3).map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
            <span style={{ fontSize: 13, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{c.name}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>{suffix(c)}</span>
          </div>
        ))}
      </div>
    ) : null
  )

  return (
    <div className="bsx-e" style={{ ...card, marginBottom: 24, overflow: 'hidden', animationDelay: '.34s' }}>
      {/* dark header — spend today + the numbers, with the account switcher */}
      <div style={{ background: FOREST, padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9db29a' }}>Your Facebook Ads</span>
              {/* account switcher */}
              {accounts && accounts.length > 1 ? (
                <select value={sel} onChange={(e) => { setSel(e.target.value); load(e.target.value) }} disabled={busy}
                  style={{ background: 'rgba(255,255,255,.08)', color: '#fff', border: '1px solid rgba(255,255,255,.18)', borderRadius: 100, padding: '3px 10px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', maxWidth: 200 }}>
                  {accounts.map(a => <option key={a.accountId} value={a.accountId} style={{ color: '#111' }}>{a.name}{a.isPrimary ? ' ·  primary' : ''}</option>)}
                </select>
              ) : (d.accountName ? <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd7c6', background: 'rgba(255,255,255,.08)', borderRadius: 100, padding: '3px 10px' }}>{d.accountName}</span> : null)}
              {busy && <span style={{ fontSize: 11, color: '#9db29a' }}>updating…</span>}
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 750, letterSpacing: '-.015em', color: '#fff', lineHeight: 1.3, marginTop: 8, maxWidth: 460 }}>{headline(d).replace(/\.+$/, '')}</div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* SPEND TODAY — the live pulse, lime + labeled */}
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: LIME }}>{money(d.spendToday || 0)}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spent today</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#fff' }}>{money(d.spend)}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spend · 14d</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: d.avgRoas >= 1 ? LIME : '#f0a19a' }}>{d.avgRoas}x</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>avg ROAS</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#fff' }}>{d.total}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>campaigns</div></div>
          </div>
        </div>
      </div>
      {/* buckets */}
      <div style={{ padding: '18px 24px', display: 'flex', gap: 26, flexWrap: 'wrap' }}>
        <Bucket label="Scale" color="#2f7d3a" dot={GREEN} rows={d.scale} suffix={(c) => `${c.roas}x`} />
        <Bucket label="Watch" color="#9a6a12" dot="#e0a72e" rows={d.watch} suffix={(c) => `${money(c.spend)} · ${c.roas}x`} />
        <Bucket label="Pause" color="#a5342c" dot="#d0453a" rows={d.pause} suffix={(c) => `${money(c.spend)} · ${c.conversions} conv`} />
        {!d.scale.length && !d.watch.length && !d.pause.length && (
          <div style={{ fontSize: 14, color: MUTED }}>Everything’s steady — no campaign needs a move today.</div>
        )}
      </div>
      <div style={{ padding: '0 24px 18px' }}>
        <Link href={ctaHref} onClick={onAct} style={{ display: 'inline-block', background: FOREST, color: LIME, borderRadius: 100, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>{ctaLabel} →</Link>
      </div>
    </div>
  )
}
