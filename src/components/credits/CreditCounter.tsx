'use client'
/**
 * Credit UI primitives (spec #2 + #8):
 *  • useCredits()   — shared balance + pricing, refetch on demand or on a global event.
 *  • CreditCounter  — the top/sidebar balance pill (low-balance state + Top-up CTA).
 *  • confirmCredits — pre-action "This uses N credits. You have M." gate.
 *  • refreshCredits() — fire after any paid action so the counter updates.
 *
 * Self-fetching (no provider required) so it drops into any layout. Components that
 * spend credits call refreshCredits() after a successful action.
 */
import { useCallback, useEffect, useState } from 'react'
import { openCredits } from './CreditModal'

const REFRESH_EVENT = 'credits:refresh'
export function refreshCredits() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT))
}

export interface CreditState {
  balance: number
  plan: string
  reset_at: string | null
  trialing: boolean
  trial_ends_at: string | null
  pricing: Record<string, { label: string; credits: number }>
  loading: boolean
  // Subscription lifecycle (owner-resolved) — drives Cancel vs Reactivate in the profile menu.
  subscriptionStatus?: string | null
  canceled?: boolean          // soft-cancel: paid access continues to period end
  isOwner?: boolean           // only the billing owner may cancel/reactivate
}

const BAL_CACHE = 'credits:lastBalance'
// Module-level cache of the last-fetched state. Persists across component re-mounts within a session
// (e.g. switching Discovery → AI Gen re-mounts the sidebar counter). It is NULL on the server and on the
// very first client render — so SSR and first hydration still both render '…' and match (no #425). Only
// AFTER the first live fetch does it hold a value, so subsequent re-mounts show the number with no '…'.
let LAST: CreditState | null = null
export function useCredits(): CreditState & { refetch: () => void } {
  // Seed from the module cache when available (re-mount) → instant number, no '…' flash, no hydration
  // mismatch (null on first-ever render, matching the server). Do NOT read localStorage here — that would
  // desync SSR ('…') from the client (cached number) → React #425/#418/#423 discards the whole tree.
  const [s, setS] = useState<CreditState>(LAST ?? { balance: 0, plan: 'trial', reset_at: null, trialing: false, trial_ends_at: null, pricing: {}, loading: true })
  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/credits/balance')
      if (!r.ok) return
      const d = await r.json()
      const balance = d.balance ?? 0
      if (typeof window !== 'undefined') localStorage.setItem(BAL_CACHE, String(balance))
      const next: CreditState = { balance, plan: d.plan ?? 'trial', reset_at: d.reset_at ?? null, trialing: !!d.trialing, trial_ends_at: d.trial_ends_at ?? null, pricing: d.pricing ?? {}, loading: false, subscriptionStatus: d.subscription_status ?? null, canceled: !!d.canceled, isOwner: d.is_owner !== false }
      LAST = next
      setS(next)
    } catch { setS(p => ({ ...p, loading: false })) }
  }, [])
  useEffect(() => {
    // Post-mount (client-only): if the module cache was empty (first load / full refresh), seed instantly
    // from the localStorage cache so the pill shows a real number while the live refetch lands.
    if (!LAST) {
      const cached = Number(localStorage.getItem(BAL_CACHE))
      if (Number.isFinite(cached) && cached > 0) setS(p => ({ ...p, balance: cached, loading: false }))
    }
    refetch()
    const h = () => refetch()
    window.addEventListener(REFRESH_EVENT, h)
    // Re-sync when the tab regains focus — credits can be spent server-side (e.g. an audit) while the tab
    // is away, and without this the pill would keep showing a stale cached number.
    window.addEventListener('focus', h)
    return () => { window.removeEventListener(REFRESH_EVENT, h); window.removeEventListener('focus', h) }
  }, [refetch])
  return { ...s, refetch }
}

/** Pre-action affordability gate. Returns true if the user can afford it (and proceeds).
 * No more browser-native window.confirm — the credit cost is already shown on every action button, so
 * a second OS dialog was redundant friction (and looked un-branded). If they can't afford it we pop the
 * in-app Buy-credits modal instead and block the action (returns false). */
export function confirmCredits(action: string, credits: number, balance: number): boolean {
  if (typeof window === 'undefined') return false
  if (balance < credits) {
    openCredits('buy', `Not enough credits — ${action} needs ${credits}, you have ${balance.toLocaleString()}. Top up to continue.`)
    return false
  }
  return true
}

export function CreditCounter({ compact = false }: { compact?: boolean }) {
  const { balance, loading, plan, trialing } = useCredits()
  const low = balance < 15  // below the priciest action (image_clone)
  const title = trialing
    ? `Trial · ${balance} credits — your full plan credits unlock when the trial ends, or click to pay now & unlock`
    : `Plan: ${plan} · ${balance} credits`
  return (
    <button type="button"
       onClick={() => openCredits(low ? 'buy' : 'plan')}
       title={title}
       style={{
         display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit',
         padding: compact ? '4px 10px' : '6px 12px', borderRadius: 999,
         background: low ? '#fef2f2' : '#fff',
         border: `1px solid ${low ? '#fecaca' : '#efece2'}`,
         color: low ? '#b91c1c' : '#141d15', fontSize: 12, fontWeight: 700,
       }}>
      <span style={{ fontSize: 13, color: low ? '#b91c1c' : '#ef4a1e' }}>◆</span>
      {/* Only show '…' when we genuinely have no number yet; once a cached/last balance exists, keep
          showing it through refetches so it never flashes back to '…' on refresh / page change. */}
      <span>{loading && !balance ? '…' : balance.toLocaleString()}</span>
      <span style={{ opacity: 0.7, fontWeight: 600 }}>credits</span>
      {low && !loading && <span style={{ marginLeft: 4, fontWeight: 800 }}>· Top&nbsp;up</span>}
    </button>
  )
}
