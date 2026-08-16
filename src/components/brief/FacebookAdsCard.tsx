'use client'
/**
 * FacebookAdsCard — the Morning Brief's money card. Server paints it instantly from the primary
 * account's cached audit; on mount it fetches /api/meta/audit-summary to add TODAY's spend and the
 * account switcher, so the founder can flip between their connected accounts (ROY 1, ROY 4, …) right
 * on the brief and see each one's spend-today, 14-day ROAS, and who to scale/pause — without leaving.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { confirmAction } from '@/components/ConfirmDialog'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', LIME = '#ff5a2c', FOREST = '#141d15', GREEN = '#ef4a1e'

type Camp = { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null; metaCampaignId?: string | null; ctr?: number; impressions?: number; clicks?: number }
type Ad = { adId: string; name: string; campaignName?: string | null; metaCampaignId?: string | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; roas: number; conversions: number; thumbnail_url?: string | null; preview_url?: string | null }
type Summary = {
  accounts?: { accountId: string; name: string; currency: string; isPrimary: boolean; brandId?: string | null }[]
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

export default function FacebookAdsCard({ initial, ctaHref = '/reports', ctaLabel = 'See the full report', onAct, onAccountChange, brandId, brandName }: {
  initial: Summary; ctaHref?: string; ctaLabel?: string; onAct?: () => void
  // Broadcast which account (and its currency) this card is showing, so the rest of the brief
  // ("What Mello would do", etc.) follows the SAME account and every figure agrees. Fired on the
  // user's explicit switch — never on mount — to stay off Meta's rate limit.
  onAccountChange?: (accountId: string, currency: string) => void
  brandId?: string | null; brandName?: string | null   // the selected project/brand — the card scopes to its linked account
}) {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [d, setD] = useState<Summary>(initial)
  const [accounts, setAccounts] = useState<Summary['accounts']>([])
  const [sel, setSel] = useState<string>('')
  const [range, setRange] = useState<string>('last_30d')   // default: 30 days
  const [busy, setBusy] = useState(false)
  // Start in the healing (loading) state: the card ALWAYS pulls live numbers on mount, so we must never
  // paint the stale nightly-stored `initial` figures for even one frame — that first frame was the
  // "wrong numbers, then blink, then correct" the founder saw. Open on "Loading…", settle on the truth.
  const [healing, setHealing] = useState(true)   // self-heal in progress → blank the stale numbers
  const [noAccount, setNoAccount] = useState(false)   // active brand has no linked ad account → show connect, not another brand's numbers

  // LIVE fetch — only on an explicit user action (switch account / change range / refresh). Never auto.
  const load = (accountId?: string, r: string = range) => {
    setBusy(true)
    const qs = new URLSearchParams()
    if (accountId) qs.set('accountId', accountId)
    else if (brandId) qs.set('brand', brandId)   // no explicit account → the selected brand's linked account
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
      .finally(() => { setBusy(false); setHealing(false) })
  }
  // Pin the currently-viewed account as the org's primary (clears every other is_primary), then
  // refresh the list + numbers. Fixes the multiple-primary drift permanently and makes THIS account
  // the default the brief + nightly audit scope to.
  const makePrimary = async () => {
    if (!sel || busy) return
    setBusy(true)
    try {
      await fetch('/api/meta/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: sel }) })
      setAccounts(prev => (prev || []).map(a => ({ ...a, isPrimary: a.accountId === sel })))
      // Re-run the audit for the NEW primary so the STORED brief data (card numbers + "What Mello would
      // do") is rewritten now — the next load is clean, no wrong-account flash, everything one account.
      await fetch('/api/meta/reaudit', { method: 'POST' }).catch(() => {})
    } catch { /* best-effort */ }
    setBusy(false)
    load(sel, range)
  }

  // Link the currently-viewed ad account to a brand/project — so picking that brand on the brief shows
  // THIS account's Facebook numbers. Optimistic; the brand switcher then drives the card.
  const assignBrand = async (bid: string) => {
    if (!sel) return
    setAccounts(prev => (prev || []).map(a => a.accountId === sel ? { ...a, brandId: bid || null } : a))
    await fetch('/api/meta/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: sel, brand_id: bid || null }) }).catch(() => {})
  }

  // On mount we DON'T pull live Graph — we render the nightly-stored audit (`initial`) and only fetch
  // the cheap DB accounts list so the switcher works. Live data (spend today, top ads, fresh grade)
  // loads when the user switches account / changes range / taps refresh. Keeps us off Meta's rate limit.
  useEffect(() => {
    // Brands for the "this account is for [brand]" assignment control.
    fetch('/api/brands', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setBrands((j?.brands || []).map((b: any) => ({ id: String(b.id), name: String(b.name) })))).catch(() => {})
    fetch('/api/meta/accounts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      const list = Array.isArray(j?.accounts) ? j.accounts.map((a: any) => ({ accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, currency: a.currency || 'USD', isPrimary: !!a.is_primary, brandId: a.brand_id || null })) : []
      if (!list.length) {
        // A specific brand with NO linked account must NOT fall back to the server seed (another brand's
        // ROY-1 numbers). Blank it and show a connect prompt. Only the All-brands view keeps the stored paint.
        if (brandId) { setNoAccount(true); setAccounts([]); setSel(''); onAccountChange?.('', 'USD') }
        setHealing(false); return
      }
      setNoAccount(false)
      setAccounts(list)
      // Default to the SELECTED brand's linked account (the project link); else the account the founder
      // was last viewing (so "ROY 1 · for Aura" doesn't snap back to an unlinked primary on reopen —
      // the "the brand dropdown shows empty again" report); else the primary.
      let lastSel = ''
      try { lastSel = localStorage.getItem('sf_fb_acct') || '' } catch { /* ignore */ }
      const p = (brandId && list.find((x: any) => x.brandId === brandId))
        || (!brandId && lastSel && list.find((x: any) => x.accountId === lastSel))
        || list.find((x: any) => x.isPrimary) || list[0]
      setSel(p.accountId)
      // ALWAYS tell the brief which account is resolved as primary, on mount — so "What Mello would do"
      // scopes to the SAME account (a stored ROY-1 card must not show under an Aura-Bura brief). The
      // opportunities card refetches only if its stored cards were for a different account; otherwise no call.
      onAccountChange?.(p.accountId, p.currency)
      // SELF-HEAL a stale nightly: if the stored audit is a DIFFERENT currency than the resolved
      // primary (the €86 ↔ $687k drift, before tonight's re-audit overwrites it), correct the display
      // with one live call so the brief matches /campaigns immediately. Same-currency → no call.
      // `healing` blanks the numbers while we fetch, so the founder never READS the wrong figures
      // (the flash they reported) — they just see a brief loading, then the right ones.
      // Pull the LIVE numbers once on open so the card is right without a manual refresh (correct ROAS,
      // thumbnails, CTR/impr/clicks — the nightly snapshot is stale/partial). auditAccount is cached
      // server-side for 10 min, so repeated opens don't hammer Meta. `healing` blanks the stale figures
      // during the fetch so the founder never reads the wrong number, then it settles on the real ones.
      setHealing(true); load(p.accountId)
    }).catch(() => setHealing(false))   // accounts call failed → clear loading, keep the stored paint
  }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps  — re-resolve the account when the brand switches

  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }

  // One-click Scale, money-gated: the founder confirms the EXACT new daily budget before a cent moves
  // (never auto-spend). +20% on the campaign's current daily budget — the same step the audit suggests.
  const [scaling, setScaling] = useState<string | null>(null)
  const [scaled, setScaled] = useState<Record<string, boolean>>({})
  const scaleCampaign = async (c: Camp) => {
    const id = c.metaCampaignId
    if (!id || c.dailyBudget == null || scaling) return
    // dailyBudget is normalized to MAJOR units server-side (audit). Scale +20% off it.
    const currentMajor = Number(c.dailyBudget) || 0
    const newBudget = Math.max(1, Math.round(currentMajor * 1.2))
    // DUPLICATION scaling: instead of raising the live campaign's budget in place (which can reset the
    // learning phase), we clone it into a new "— Scale" campaign at the higher budget and leave the
    // ORIGINAL untouched. Safer, and the same thing the "What Mello would do" card does (/api/meta/scale).
    if (!(await confirmAction({ title: `Scale “${c.name}” +20%?`, body: `Mello will duplicate it into a new campaign at ${money(newBudget)}/day and leave the original running untouched. This raises spend on Meta.`, confirmLabel: 'Scale it' }))) return
    setScaling(id)
    try {
      // /api/meta/scale finds the campaign's OWN ad account by its id, so it always scales on the right
      // token. It creates a fresh duplicate; the original keeps running.
      const res = await fetch('/api/meta/scale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metaCampaignId: id, newDailyBudget: newBudget }) })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok) { setScaled(s => ({ ...s, [id]: true })); onAct?.() }
      else toast.error(j?.error || 'Could not scale — open Campaigns to do it manually.')
    } catch { toast.error('Could not scale — open Campaigns to do it manually.') }
    finally { setScaling(null) }
  }
  const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

  const Bucket = ({ label, color, dot, rows, suffix, scalable }: { label: string; color: string; dot: string; rows: Camp[]; suffix: (c: Camp) => string; scalable?: boolean }) => (
    rows.length ? (
      <div style={{ flex: scalable ? '1 1 100%' : '1 1 200px', minWidth: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color, marginBottom: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{label} · {rows.length}
        </div>
        {rows.slice(0, 3).map((c, i) => {
          const canScale = scalable && !!c.metaCampaignId && c.dailyBudget != null
          const done = c.metaCampaignId ? scaled[c.metaCampaignId] : false
          const busyRow = c.metaCampaignId ? scaling === c.metaCampaignId : false
          const currentMajor = c.dailyBudget != null ? c.dailyBudget : null   // normalized to major server-side
          const newBudget = currentMajor != null ? Math.max(1, Math.round(currentMajor * 1.2)) : null
          // Scale rows get the full campaign treatment: the thumbnail of its top-spend ad + every stat
          // we show on a normal campaign — not just a lonely ROAS.
          const ad = scalable ? (d.ads || []).filter(a => a.metaCampaignId && c.metaCampaignId && String(a.metaCampaignId) === String(c.metaCampaignId)).sort((a, b) => b.spend - a.spend)[0] : null
          const num = (n?: number) => (n == null ? '—' : Math.round(n).toLocaleString())
          const cpc = (c.clicks && c.clicks > 0) ? c.spend / c.clicks : null
          const Stat = ({ label, value }: { label: string; value: string }) => (
            <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 750, color: INK, whiteSpace: 'nowrap' }}>{value}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#a7b0a5' }}>{label}</span>
            </span>
          )
          return (
            <div key={i} style={{ padding: scalable ? '10px 0' : '5px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
              {scalable ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#eef2ec', display: 'grid', placeItems: 'center' }}>
                      {ad?.thumbnail_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={ad.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} /> : <span style={{ fontSize: 15, opacity: .5 }}>🎬</span>}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 750, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{currentMajor != null ? `${money(currentMajor)}/day` : 'live campaign'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                    <Stat label="Spend" value={money(c.spend)} />
                    <Stat label="ROAS" value={`${c.roas}x`} />
                    <Stat label="CTR" value={c.ctr != null ? `${c.ctr}%` : '—'} />
                    <Stat label="Impr." value={num(c.impressions)} />
                    <Stat label="Clicks" value={num(c.clicks)} />
                    <Stat label="CPC" value={cpc != null ? money(cpc) : '—'} />
                    <Stat label="Conv." value={num(c.conversions)} />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{c.name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>{suffix(c)}</span>
                </div>
              )}
              {canScale && (
                done ? (
                  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 750, color: GREEN }}>✓ Duplicated at {money(newBudget!)}/day — original still running</div>
                ) : (
                  <button onClick={() => scaleCampaign(c)} disabled={busyRow}
                    style={{ marginTop: 8, border: 'none', borderRadius: 100, padding: '7px 16px', fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit', cursor: busyRow ? 'default' : 'pointer', background: '#ef4a1e', color: '#fff', opacity: busyRow ? 0.6 : 1 }}>
                    {busyRow ? 'Scaling…' : `Scale it → ${money(newBudget!)}/day`}
                  </button>
                )
              )}
              {scalable && c.metaCampaignId && c.dailyBudget == null && (
                <Link href="/campaigns" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700, color: GREEN, textDecoration: 'none' }}>Scale in Campaigns →</Link>
              )}
            </div>
          )
        })}
      </div>
    ) : null
  )

  // The active brand has no linked ad account → don't show another brand's numbers; prompt to link one.
  if (noAccount) {
    return (
      <div className="bsx-e" style={{ ...card, marginBottom: 24, overflow: 'hidden', animationDelay: '.34s' }}>
        <div style={{ background: FOREST, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9db29a' }}>Your Facebook Ads</div>
          <div style={{ fontSize: 16, fontWeight: 750, color: '#fff', marginTop: 8 }}>No ad account linked to {brandName || 'this brand'} yet.</div>
          <div style={{ fontSize: 13, color: '#cbd7c6', marginTop: 6, lineHeight: 1.5 }}>Link {brandName || 'this brand'}&rsquo;s Facebook ad account and its real spend, ROAS and moves show up here — nothing from your other brands.</div>
          <Link href="/connect-meta" style={{ display: 'inline-block', marginTop: 14, background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>Connect an ad account →</Link>
        </div>
      </div>
    )
  }

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
                <select value={sel} onChange={(e) => { setSel(e.target.value); try { localStorage.setItem('sf_fb_acct', e.target.value) } catch {} ; load(e.target.value) }} disabled={busy}
                  style={{ background: 'rgba(255,255,255,.08)', color: '#fff', border: '1px solid rgba(255,255,255,.18)', borderRadius: 100, padding: '3px 10px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', maxWidth: 200 }}>
                  {accounts.map(a => <option key={a.accountId} value={a.accountId} style={{ color: '#111' }}>{a.name}{a.isPrimary ? ' ·  primary' : ''}</option>)}
                </select>
              ) : (d.accountName ? <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd7c6', background: 'rgba(255,255,255,.08)', borderRadius: 100, padding: '3px 10px' }}>{d.accountName}</span> : null)}
              {/* Pin the account they actually care about as the DEFAULT everywhere (brief, nightly
                  audit, Reports). Only shown when they're viewing a non-primary account — one tap sets
                  it and clears the stale extra "primary" flags that caused the €86 ↔ $687k confusion. */}
              {accounts && accounts.length > 1 && sel && !accounts.find(a => a.accountId === sel)?.isPrimary && (
                <button onClick={makePrimary} disabled={busy}
                  style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '3px 11px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer' }}>
                  ★ Set as main
                </button>
              )}
              {/* Project link — which brand this ad account is for, so the brand switcher shows it. */}
              {brands.length > 0 && sel && (
                <select value={accounts?.find(a => a.accountId === sel)?.brandId || ''} onChange={(e) => assignBrand(e.target.value)}
                  title="Which brand is this ad account for?"
                  style={{ background: 'rgba(255,255,255,.08)', color: '#cbd7c6', border: '1px solid rgba(255,255,255,.18)', borderRadius: 100, padding: '3px 10px', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', maxWidth: 170 }}>
                  <option value="" style={{ color: '#111' }}>— link to a brand —</option>
                  {brands.map(b => <option key={b.id} value={b.id} style={{ color: '#111' }}>for {b.name}</option>)}
                </select>
              )}
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
            <div style={{ fontSize: 16.5, fontWeight: 750, letterSpacing: '-.015em', color: '#fff', lineHeight: 1.3, marginTop: 8, maxWidth: 460 }}>{healing ? 'Loading your account…' : headline(d).replace(/\.+$/, '')}</div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexShrink: 0, flexWrap: 'wrap', opacity: healing ? 0.45 : 1, transition: 'opacity .2s' }}>
            {/* SPEND TODAY — the live pulse, lime + labeled */}
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: LIME }}>{healing ? '—' : (typeof d.spendToday === 'number' ? money(d.spendToday) : '—')}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spent today</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#fff' }}>{healing ? '—' : money(d.spend)}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>spend · {RANGE_LABEL[range] || '30d'}</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: d.avgRoas >= 1 ? LIME : '#f0a19a' }}>{healing ? '—' : `${d.avgRoas}x`}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>avg ROAS</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#fff' }}>{healing ? '—' : d.total}</div><div style={{ fontSize: 11, color: '#9db29a', fontWeight: 600 }}>campaigns</div></div>
          </div>
        </div>
      </div>
      {/* buckets */}
      <div style={{ padding: '18px 24px', display: 'flex', gap: 26, flexWrap: 'wrap' }}>
        {healing ? (
          <div style={{ fontSize: 14, color: MUTED }}>Loading the right account…</div>
        ) : (<>
        <Bucket label="Scale" color="#2f7d3a" dot={GREEN} rows={d.scale} suffix={(c) => `${money(c.spend)} · ${c.roas}x`} scalable />
        <Bucket label="Watch" color="#9a6a12" dot="#e0a72e" rows={d.watch} suffix={(c) => `${money(c.spend)} · ${c.roas}x`} />
        <Bucket label="Pause" color="#a5342c" dot="#d0453a" rows={d.pause} suffix={(c) => `${money(c.spend)} · ${c.conversions} conv`} />
        {!d.scale.length && !d.watch.length && !d.pause.length && (
          <div style={{ fontSize: 14, color: MUTED }}>Everything’s steady — no campaign needs a move today.</div>
        )}
        </>)}
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
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#141d15' }}>{a.campaignName || a.name}</span>
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
        {/* Carry the account the founder is VIEWING into Reports, so "the full report" is for THIS
            account (PKR/ROY/…), not always the primary. */}
        <Link href={sel ? `${ctaHref}${ctaHref.includes('?') ? '&' : '?'}account=${encodeURIComponent(sel)}` : ctaHref} onClick={onAct} style={{ display: 'inline-block', background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>{ctaLabel} →</Link>
      </div>
    </div>
  )
}
