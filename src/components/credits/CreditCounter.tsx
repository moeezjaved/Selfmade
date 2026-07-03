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

const REFRESH_EVENT = 'credits:refresh'
export function refreshCredits() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT))
}

export interface CreditState {
  balance: number
  plan: string
  reset_at: string | null
  pricing: Record<string, { label: string; credits: number }>
  loading: boolean
}

const BAL_CACHE = 'credits:lastBalance'
export function useCredits(): CreditState & { refetch: () => void } {
  // IMPORTANT: initialize to a CONSTANT (same on server + client) — do NOT read localStorage in the
  // useState initializer. That runs during SSR render: the server (no window) rendered '…' while the
  // client rendered the cached '90' → React hydration #425/#418/#423 → the whole dashboard tree got
  // discarded ("feed vanishes"). We seed from cache in the post-mount effect below instead, so the
  // server HTML and first client render match. (Trades a 1-tick '…' on the pill for not breaking the page.)
  const [s, setS] = useState<CreditState>({ balance: 0, plan: 'trial', reset_at: null, pricing: {}, loading: true })
  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/credits/balance')
      if (!r.ok) return
      const d = await r.json()
      const balance = d.balance ?? 0
      if (typeof window !== 'undefined') localStorage.setItem(BAL_CACHE, String(balance))
      setS({ balance, plan: d.plan ?? 'trial', reset_at: d.reset_at ?? null, pricing: d.pricing ?? {}, loading: false })
    } catch { setS(p => ({ ...p, loading: false })) }
  }, [])
  useEffect(() => {
    // Post-mount (client-only): seed instantly from the cached balance so the pill shows a real
    // number while the live refetch lands — same UX as before, but without the hydration mismatch.
    const cached = Number(localStorage.getItem(BAL_CACHE))
    if (Number.isFinite(cached)) setS(p => ({ ...p, balance: cached, loading: false }))
    refetch()
    const h = () => refetch()
    window.addEventListener(REFRESH_EVENT, h)
    return () => window.removeEventListener(REFRESH_EVENT, h)
  }, [refetch])
  return { ...s, refetch }
}

/** Pre-action confirm. Returns true if the user proceeds (and can afford it). */
export function confirmCredits(action: string, credits: number, balance: number): boolean {
  if (typeof window === 'undefined') return false
  if (balance < credits) {
    return window.confirm(`Not enough credits — ${action} needs ${credits}, you have ${balance}.\n\nGo to Billing to top up?`)
  }
  return window.confirm(`This ${action} uses ${credits} credits. You have ${balance}.\n\nProceed?`)
}

export function CreditCounter({ compact = false }: { compact?: boolean }) {
  const { balance, loading, plan } = useCredits()
  const low = balance < 15  // below the priciest action (image_clone)
  return (
    <a href="/billing"
       title={`Plan: ${plan} · ${balance} credits`}
       style={{
         display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
         padding: compact ? '4px 10px' : '6px 12px', borderRadius: 999,
         background: low ? '#fef2f2' : 'rgba(223,254,149,0.14)',
         border: `1px solid ${low ? '#fecaca' : 'rgba(223,254,149,0.35)'}`,
         color: low ? '#b91c1c' : '#dffe95', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
       }}>
      <span style={{ fontSize: 13 }}>◆</span>
      <span>{loading ? '…' : balance.toLocaleString()}</span>
      <span style={{ opacity: 0.7, fontWeight: 600 }}>credits</span>
      {low && !loading && <span style={{ marginLeft: 4, fontWeight: 800 }}>· Top&nbsp;up</span>}
    </a>
  )
}
