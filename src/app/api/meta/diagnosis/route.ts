/**
 * GET /api/meta/diagnosis
 * Reads the connected Meta account's already-synced totals (via auditAccount) and runs the deterministic
 * media-buyer DIAGNOSIS (src/lib/meta/diagnose.ts) — per-metric good/bad + the single biggest lever.
 * Read-only, no writes. Never 500s the page: on any error it returns { connected:false }.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { auditAccount } from '@/lib/meta/audit'
import { diagnose, biggestLever, type AccountMetrics } from '@/lib/meta/diagnose'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const admin = createAdminClient()
    const totals: any = await auditAccount(admin, user.id)
    if (!totals) return NextResponse.json({ connected: false })

    // Map auditAccount's real totals → AccountMetrics. NOTE: auditAccount's `ctr` is a PERCENTAGE number
    // (1.2 = 1.2%), so divide by 100 to get the fraction diagnose() expects. reach isn't in the totals,
    // so frequency stays null (diagnose shows 'unknown') — a later expansion.
    const metrics: AccountMetrics = {
      spend: totals.spend,
      currency: totals.currency || 'USD',
      cpm: totals.cpm ?? null,
      ctr: totals.ctr != null ? totals.ctr / 100 : null,
      cvr: (totals.clicks > 0 && totals.purchases != null) ? totals.purchases / totals.clicks : null,
      aov: (totals.purchases > 0 && totals.revenue != null) ? totals.revenue / totals.purchases : null,
      roas: totals.avgRoas ?? null,
      frequency: null,
      activeCreatives: Array.isArray(totals.ads) ? totals.ads.length : null,
    }

    const diagnoses = diagnose(metrics)
    const lever = biggestLever(metrics, diagnoses)
    return NextResponse.json({ connected: true, spend: metrics.spend, currency: metrics.currency, lever, diagnoses })
  } catch {
    return NextResponse.json({ connected: false, error: 'diagnosis_failed' }, { status: 200 })
  }
}
