/**
 * Popular Visual Formats — which ad formats the top performers use right now, scoped by industry.
 * Uses E's classified `format_style`. Counts within the top-performer pool (so it reads as "formats
 * winning ads use," which is the useful signal), with a few sample thumbnails per format.
 * GET ?niche= → ranked formats with counts + samples.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const niche = (req.nextUrl.searchParams.get('niche') || '').trim()

  let q = admin.from('discovery_ads_index')
    .select('format_style, performance_score, discovery_creatives(asset_type,position,r2_url,poster_url)')
    .eq('has_creative', true).not('format_style', 'is', null).gt('performance_score', 0)
    .order('performance_score', { ascending: false }).limit(1000)
  if (niche) q = q.eq('niche', niche)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Agg = { format: string; count: number; samples: string[] }
  const map = new Map<string, Agg>()
  for (const r of (data || []) as any[]) {
    const f = (r.format_style || '').trim()
    if (!f) continue
    let a = map.get(f)
    if (!a) { a = { format: f, count: 0, samples: [] }; map.set(f, a) }
    a.count++
    if (a.samples.length < 3) {
      const cres = (r.discovery_creatives || []).slice().sort((x: any, y: any) => (x.position || 0) - (y.position || 0))
      const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
      const img = cre ? (cre.asset_type === 'video' ? cre.poster_url : cre.r2_url) : null
      if (img) a.samples.push(img)
    }
  }
  const formats = Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10)
  return NextResponse.json({ formats, niche: niche || null })
}
