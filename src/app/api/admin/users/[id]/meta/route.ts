import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { auditAccount } from '@/lib/meta/audit'

/**
 * GET /api/admin/users/:id/meta — admin view of ONE user's connected Meta ad accounts and how their
 * ads are performing. Reuses the same audit engine the founder sees (auditAccount), so the numbers
 * match their own brief. Read-only, admin-gated, cached (auditAccount caches 10min per account).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = params.id
  const admin = createAdminClient()

  const { data: accounts } = await admin.from('meta_accounts')
    .select('account_id, account_name, currency, is_primary, status, last_synced_at')
    .eq('user_id', userId).order('is_primary', { ascending: false })

  if (!accounts?.length) return NextResponse.json({ connected: false, accounts: [] })

  // Grade every ACTIVE account (last 30d) — one audit each, cached. Dead/disconnected accounts are
  // listed but not graded (no token to call with).
  const active = accounts.filter((a: any) => a.status === 'active')
  const audits = await Promise.all(active.map(async (a: any) => {
    try {
      const r = await auditAccount(admin, userId, a.account_id, 'last_30d')
      if (!r) return null
      return {
        accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, currency: r.currency,
        isPrimary: !!a.is_primary, spend: r.spend, avgRoas: r.avgRoas, spendToday: r.spendToday,
        campaigns: r.total, counts: r.counts,
        topAds: (r.ads || []).slice(0, 5).map((ad: any) => ({ name: ad.name, campaignName: ad.campaignName, spend: ad.spend, roas: ad.roas, ctr: ad.ctr, impressions: ad.impressions, clicks: ad.clicks })),
        scale: r.scale, watch: r.watch, pause: r.pause,
      }
    } catch (e: any) { return { accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, error: e?.message || 'audit failed' } }
  }))

  return NextResponse.json({
    connected: true,
    accounts: accounts.map((a: any) => ({ accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, currency: a.currency, isPrimary: !!a.is_primary, status: a.status, lastSynced: a.last_synced_at })),
    performance: audits.filter(Boolean),
  })
}
