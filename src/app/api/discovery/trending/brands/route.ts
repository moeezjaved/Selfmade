/**
 * Brands to Watch — brands with the most top-performing ads right now, scoped by industry.
 * Aggregated in-app from the top-performer pool (no group-by RPC / no DDL).
 * GET ?niche= → ranked brands with a representative thumbnail + ad count.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const niche = (req.nextUrl.searchParams.get('niche') || '').trim()

  let q = admin.from('discovery_ads_index')
    .select('page_id, page_name, performance_score, is_active, discovery_creatives(asset_type,position,r2_url,poster_url)')
    .eq('has_creative', true).gt('performance_score', 0)
    .order('performance_score', { ascending: false }).limit(600)
  if (niche) q = q.eq('niche', niche)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Agg = { pageId: string; pageName: string; count: number; sumScore: number; active: number; image: string | null }
  const map = new Map<string, Agg>()
  for (const r of (data || []) as any[]) {
    if (!r.page_id) continue
    let a = map.get(r.page_id)
    if (!a) {
      const cres = (r.discovery_creatives || []).slice().sort((x: any, y: any) => (x.position || 0) - (y.position || 0))
      const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
      a = { pageId: r.page_id, pageName: r.page_name || 'Brand', count: 0, sumScore: 0, active: 0, image: cre ? (cre.asset_type === 'video' ? cre.poster_url : cre.r2_url) : null }
      map.set(r.page_id, a)
    }
    a.count++; a.sumScore += Number(r.performance_score) || 0; if (r.is_active) a.active++
  }
  // Rank: brands with many high-performing ads (count-led, avg-score tiebreak).
  const brands = Array.from(map.values())
    .map((b) => ({ pageId: b.pageId, pageName: b.pageName, adCount: b.count, activeCount: b.active, avgScore: b.count ? b.sumScore / b.count : 0, image: b.image }))
    .sort((a, b) => (b.adCount - a.adCount) || (b.avgScore - a.avgScore))
    .slice(0, 14)

  return NextResponse.json({ brands, niche: niche || null })
}
