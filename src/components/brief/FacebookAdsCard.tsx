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
type Ad = { adId: string; name: string; campaignName?: string | null; metaCampaignId?: string | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; roas: number; conversions: number; thumbnail_url?: string | null; preview_url?: string | null }
type Summary = {
  accounts?: { accountId: string; name: string; currency: string; isPrimary: boolean }[]
  selected?: string; currency?: string; accountName?: string | null; range?: string
  total: number; spend: number; avgRoas: number; spendToday?: number
  counts?: { scale: number; watch: number; pause: number }
  scale: Camp[]; watch: Camp[]; pause: Camp[]; ads?: Ad[]
}

const RANGE_LABEL: Record<string, string> = { last_3d: '3d', last_7d: '7d', last_14d: '14d', last_30d: '30d' }

const headline = (d: Summary) => {
  const c = d.counts || { scale: d.scale.length, watch: d.watch.length, pause: d.pause.length }
  const parts: string[] = []
  if (c.scale) parts.push(`${c.scale} ready to scale`)
  if (c.watch) parts.push(`${c.watch} catchy but not converting`)
  if (c.pause) parts.push(`${c.pause} burning budget`)
  return `I audited your ${d.total} campaign${d.total === 1 ? '' : 's'} — ${parts.length ? parts.join(', ') : 'all steady'}.`
}

export default function FacebookAdsCard({ initial, ctaHref = '/reports', ctaLabel = 'See the full report', onAct, onAccountChange }: {
  initial: Summary; ctaHref?: string; ctaLabel?: string; onAct?: () => void
  // Broadcast which account (and its currency) this card is showing, so the rest of the brief
  // ("What Mello would do", etc.) follows the SAME account and every figure agrees. Fired on the
  // user's explicit switch — never on mount — to stay off Meta's rate limit.
  onAccountChange?: (accountId: string, currency: string) => void
}) {
  const [d, setD] = useState<Summary>(initial)
  const [accounts, setAccounts] = useState<Summary['accounts']>([])
  const [sel, setSel] = useState<string>('')
  const [range, setRange] = useState<string>('last_30d')   // default: 30 days
  const [busy, setBusy] = useState(false)

  // LIVE fetch — only on an explicit user action (switch account / change range / refresh). Never auto.
  const load = (accountId?: string, r: string = range) => {
    setBusy(true)
    const qs = new URLSearchParams()
    if (accountId) qs.set('accountId', accountId)
    qs.set('range', r)
    fetch(`/api/meta/audit-summary?${qs.toString()}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(j => {
        if (!j || j.error) return
        if (Array.isArray(j.accounts)) setAccounts(j.accounts)
        if (j.selected) setSel(j.selected)
        if (j.range) setRange(j.range)
        if (typeof j.total === 'number') setD(j)
        // Tell the brief which account we're now showing so the other cards match the currency.
        if (j.selected) onAccountChange?.(j.selected, j.currency || 'USD')
      })
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  // On mount we DON'T pull live Graph — we render the nightly-stored audit (`initial`) and only fetch
  // the cheap DB accounts list so the switcher works. Live data (spend today, top ads, fresh grade)
  // loads when the user switches account / changes range / taps refresh. Keeps us off Meta's rate limit.
  useEffect(() => {
    fetch('/api/meta/accounts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      const list = Array.isArray(j?.accounts) ? j.accounts.map((a: any) => ({ accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, currency: a.currency || 'USD', isPrimary: !!a.is_primary })) : []
      if (list.length) { setAccounts(list); const p = list.find((x: any) => x.isPrimary) || list[0]; setSel(p.accountId) }
    }).catch(() => {})
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

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
              {/* day-range picker — default 30d */}
              <span style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 100, padding: 2 }}>
                {['last_3d', 'last_7d', 'last_14d', 'last_30d'].map(r => (
                  <button key={r} onClick={() => { setRange(r); load(sel || undefined, r) }} disabled={busy}
                    style={{ border: 'none', borderRadius: 100, padding: '3px 9px', fontSize: 11.5, fontWeight: 750, fontFamily: 'inherit', cursor: 'pointer', background: range === r ? LIME : 'transparent', color: range === r ? FOREST : '#cbd7c6' }}>
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </span>
              <button onClick={() => load(sel || undefined, range)} disabled={busy} title="Refresh live from Meta"
                style={{ background: 'rgba(255,255,255,.08)', color: '#cbd7c6', border: '1px solid rgba(255,255,255,.14)', borderRadius: 100, padding: '3px 10px', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'refreshing…' : '↻ refresh'}
              </button>
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 750, letterSpacing: '-.015em', color: '#fff', lineHeight: 1.3, marginTop: 8, maxWidth: 460 }}>{headline(d).replace(/\.+$/, '')}</div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* SPEND TODAY — the live pulse, lime + labeled */}
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: LIME }}>{typeof d.spendToday === 'number' ? money(d.spendToday) : '—'}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spent today</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#fff' }}>{money(d.spend)}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spend · {RANGE_LABEL[range] || '30d'}</div></div>
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

      {/* Top ads — Polsia-style compact table: thumbnail · spend · impressions · clicks · CTR · CPC */}
      {d.ads && d.ads.length > 0 && (
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '14px 24px 4px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa79a', marginBottom: 8 }}>Top ads · {RANGE_LABEL[range] || '30d'}</div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 520 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 74px 78px 62px 56px 66px', gap: 8, padding: '0 0 6px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#a7b0a5' }}>
                <span>Ad</span><span style={{ textAlign: 'right' }}>Spend</span><span style={{ textAlign: 'right' }}>Impr.</span><span style={{ textAlign: 'right' }}>Clicks</span><span style={{ textAlign: 'right' }}>CTR</span><span style={{ textAlign: 'right' }}>CPC</span>
              </div>
              {d.ads.map((a, i) => (
                // Row → the campaign it belongs to (the Ads cockpit), where they can manage it with
                // Mello. Bigger thumbnail + campaign name under the ad name so it's readable at a glance.
                <Link key={a.adId || i} href="/campaigns"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 74px 78px 62px 56px 66px', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${LINE}`, textDecoration: 'none', color: INK }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#eef2ec', display: 'grid', placeItems: 'center' }}>
                      {a.thumbnail_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} /> : <span style={{ fontSize: 14, opacity: .5 }}>🎬</span>}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#17251c' }}>{a.campaignName || a.name}</span>
                      {a.campaignName && <span style={{ display: 'block', fontSize: 11, color: '#9aa79a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(a.spend)}</span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{a.impressions.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{a.clicks.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{a.ctr.toFixed(2)}%</span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{money(a.cpc)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '16px 24px 18px' }}>
        <Link href={ctaHref} onClick={onAct} style={{ display: 'inline-block', background: FOREST, color: LIME, borderRadius: 100, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>{ctaLabel} →</Link>
      </div>
    </div>
  )
}
