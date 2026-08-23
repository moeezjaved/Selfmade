'use client'
/**
 * The Wins Ledger — the revenue game's scoreboard + permanent record. Every money-moving action shows here,
 * with the honest split: € projected (grey, estimate) vs € banked (green, verified from real orders/Meta).
 * Nothing evaporates on reload — this is the archive.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029', GREY = '#8a938a'

type Win = { id: string; category: string; title: string; detail: string | null; projected_value: number | null; banked_value: number | null; currency: string | null; verified_at: string | null; created_at: string }
type Summary = { windowDays: number; moves: number; projectedTotal: number; bankedTotal: number; currency: string | null; byCategory: Record<string, number>; recent: Win[] }
type Data = { summary: Summary; lifetime: { moves: number; banked: number } }

const CAT_LABEL: Record<string, string> = { catalog: 'Store', content: 'Content', programmatic: 'Pages at scale', ads: 'Ads', geo: 'AI search', seo: 'SEO', site: 'Site' }

function money(n: number, cur?: string | null) {
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur ? cur + ' ' : '$')
  return `${sym}${(n || 0).toLocaleString()}`
}

export default function WinsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/mello/wins'); const j = await r.json(); if (r.ok) setData(j) } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const verify = async () => {
    setVerifying(true); setNote(null)
    try {
      const r = await fetch('/api/mello/wins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'verify' }) })
      const j = await r.json()
      if (r.ok) {
        setNote(j.newlyBanked > 0
          ? `Banked ${money(j.newlyBanked, j.currency)} of real organic revenue against your moves. Organic is up ${money(j.lift, j.currency)} since you started.`
          : j.lift > 0 ? `Organic revenue is up ${money(j.lift, j.currency)} — already banked.` : `No organic lift to bank yet. Publish more pages and it compounds.`)
        await load()
      } else setNote(j.error || 'Could not verify.')
    } catch { setNote('Network error.') }
    setVerifying(false)
  }

  if (loading) return <Shell><div style={{ color: SUB }}>Loading your wins…</div></Shell>
  const s = data?.summary
  const cur = s?.currency

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>Impact ledger</div>
          <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 18px' }}>Every move you've made</h1>
        </div>
        <button onClick={verify} disabled={verifying} style={{ flex: 'none', marginTop: 4, background: '#fff', color: GOOD, border: `1.5px solid rgba(37,96,41,.3)`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: verifying ? 'default' : 'pointer', fontFamily: 'inherit' }}>{verifying ? 'Checking orders…' : 'Bank the revenue →'}</button>
      </div>
      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 16, fontSize: 14, fontWeight: 600, background: '#f2f8ef', color: GOOD, border: '1px solid rgba(37,96,41,.2)' }}>{note}</div>}

      {/* Scoreboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 8 }}>
        <Score label={`Moves · ${s?.windowDays || 30}d`} value={String(s?.moves || 0)} />
        <Score label="Banked (verified)" value={money(s?.bankedTotal || 0, cur)} tone="good" sub="from real orders" />
        <Score label="Projected (estimate)" value={s?.projectedTotal ? money(s.projectedTotal, cur) : '—'} tone="grey" sub="compounds as it lands" />
        <Score label="Lifetime moves" value={String(data?.lifetime.moves || 0)} />
      </div>
      <div style={{ fontSize: 12, color: SUB, margin: '4px 0 22px', lineHeight: 1.5 }}>
        <b style={{ color: GOOD }}>Banked</b> = real money we've verified from your orders. <b style={{ color: GREY }}>Projected</b> = an honest estimate that turns green once it shows up in revenue.
      </div>

      {/* Ledger feed */}
      {s && s.recent.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.recent.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: '12px 15px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: SUB, background: '#f3f6f2', borderRadius: 20, padding: '3px 9px', textTransform: 'uppercase', letterSpacing: '.03em', flex: 'none' }}>{CAT_LABEL[w.category] || w.category}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{w.title}</div>
                {w.detail && <div style={{ fontSize: 12, color: SUB, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.detail}</div>}
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                {w.banked_value != null
                  ? <div style={{ fontSize: 14, fontWeight: 800, color: GOOD }}>+{money(w.banked_value, w.currency || cur)}</div>
                  : w.projected_value != null
                    ? <div style={{ fontSize: 13, fontWeight: 700, color: GREY }}>~{money(w.projected_value, w.currency || cur)} <span style={{ fontSize: 10 }}>est</span></div>
                    : <div style={{ fontSize: 11.5, color: GREY }}>tracking →</div>}
                <div style={{ fontSize: 10.5, color: SUB, marginTop: 1 }}>{new Date(w.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 26, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>No moves yet</div>
          <div style={{ color: SUB, fontSize: 13.5, margin: '8px 0 16px' }}>Fix a catalog gap, publish a page, or approve a move — it lands here and we track the revenue.</div>
          <a href="/mission/journey" style={{ background: LIME, color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>See your next move →</a>
        </div>
      )}
    </Shell>
  )
}

function Score({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'grey' }) {
  const color = tone === 'good' ? GOOD : tone === 'grey' ? GREY : INK
  return (
    <div style={{ border: `1px solid ${tone === 'good' ? 'rgba(37,96,41,.25)' : LINE}`, borderRadius: 14, padding: '14px 16px', background: tone === 'good' ? '#f2f8ef' : '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color }}>{value}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: tone === 'good' ? GOOD : SUB, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
