/**
 * GET /api/brain/timeline — the Company Timeline: an append-only feed of what the company learned,
 * decided and discovered (brain_timeline), plus this week's top customer-signal patterns aggregated on
 * read. Powers the Overview tab so the Brain feels like it has a history — the way a real employee does.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  // Scope the timeline + "what customers are talking about" to the ACTIVE brand (both have brand_id).
  const brandId = (await resolveActiveBrandId(admin, user.id).catch(() => null)) || null

  const [tlRes, sigRes] = await Promise.all([
    admin.from('brain_timeline').select('actor, department, event, created_at, brand_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(80),
    admin.from('customer_signals').select('topic, sentiment, brand_id').eq('user_id', user.id).gte('created_at', since).limit(600),
  ])

  // Timeline: this brand's + account-wide entries. Customer signals: strict per-brand (a signal belongs
  // to the brand whose customer said it — Aura's flavors/delivery no longer show under Hair ResQ).
  const timeline = ((tlRes.data || []) as any[]).filter(t => !brandId || !t.brand_id || t.brand_id === brandId).slice(0, 40)

  // Aggregate customer signals by topic for a "what customers are talking about" strip.
  const agg: Record<string, { n: number; neg: number }> = {}
  for (const s of (sigRes.data || []) as any[]) {
    if (brandId && s.brand_id !== brandId) continue
    const k = String(s.topic || 'other'); agg[k] ||= { n: 0, neg: 0 }; agg[k].n++; if (s.sentiment === 'neg') agg[k].neg++
  }
  const patterns = Object.entries(agg).sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([topic, v]) => ({ topic, count: v.n, negative: v.neg }))

  return NextResponse.json({ timeline, patterns, hasHistory: timeline.length > 0 || patterns.length > 0 })
}
