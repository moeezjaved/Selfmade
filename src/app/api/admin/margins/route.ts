/**
 * GET /api/admin/margins — per-action realized margin: revenue (credits × $0.03)
 * vs the actual model cost logged in each committed tx's metadata.actual_cost_usd.
 * Flags any action whose realized margin dropped below the 50% floor (model price
 * hike → bump the credit cost in /api/admin/credit-pricing).
 */
import { NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const CREDIT_RETAIL_USD = 0.01   // 1 credit = 1¢ (redenomination, migration 095)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Spend transactions only (delta < 0, committed). Paginate the ledger.
  const agg: Record<string, { count: number; credits: number; cost: number }> = {}
  for (let off = 0; off < 100_000; off += 1000) {
    const { data } = await admin
      .from('credit_transactions')
      .select('action_type, delta, metadata')
      .eq('status', 'committed')
      .lt('delta', 0)
      .range(off, off + 999)
    const rows = (data || []) as any[]
    if (!rows.length) break
    for (const r of rows) {
      const a = r.action_type
      if (!agg[a]) agg[a] = { count: 0, credits: 0, cost: 0 }
      agg[a].count++
      agg[a].credits += -r.delta
      agg[a].cost += Number(r.metadata?.actual_cost_usd || 0)
    }
    if (rows.length < 1000) break
  }

  const margins = Object.entries(agg).map(([action, v]) => {
    const revenue = v.credits * CREDIT_RETAIL_USD
    const margin = revenue > 0 ? (revenue - v.cost) / revenue : null
    return {
      action, uses: v.count, credits_spent: v.credits,
      revenue_usd: +revenue.toFixed(2), actual_cost_usd: +v.cost.toFixed(2),
      margin_pct: margin != null ? +(margin * 100).toFixed(1) : null,
      below_floor: margin != null && margin < 0.5,
    }
  }).sort((a, b) => (a.margin_pct ?? 100) - (b.margin_pct ?? 100))

  return NextResponse.json({ credit_retail_usd: CREDIT_RETAIL_USD, margins })
}
