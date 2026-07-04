/**
 * Admin — coverage for the programmatic /ads + /alternatives SEO pages. For every industry (niche)
 * and format (hook_type), reports the real ad count and whether the page is LIVE (>=6 ads, indexable)
 * or THIN (noindex). Alternatives are static → always live. Powers the /admin/seo dashboard.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'
const MIN = 6
const toSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const ALTERNATIVES = ['Atria', 'Foreplay', 'Motion', 'GetHookd', 'AdCreative.ai', 'Minea', 'BigSpy', 'PiPiADS', 'Dropispy', 'AdSpy', 'PowerAdSpy', 'Meta Ad Library']
const HOOKS = ['Question', 'Before & After', 'Testimonial', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them', 'Social Proof', 'Pain Point']

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const countFor = async (col: string, val: string) => {
    const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true })
      .eq(col, val).eq('has_creative', true).gt('performance_score', 0)
    return count || 0
  }

  // Real niches from the taxonomy.
  const { data: nc } = await admin.from('niche_counts').select('niche').limit(200)
  const niches = Array.from(new Set((nc || []).map((r: any) => r.niche).filter(Boolean))) as string[]

  const industries = (await Promise.all(niches.map(async (n) => {
    const ads = await countFor('niche', n)
    return { label: n, url: `/ads/${toSlug(n)}`, ads, live: ads >= MIN }
  }))).sort((a, b) => b.ads - a.ads)

  const formats = (await Promise.all(HOOKS.map(async (h) => {
    const ads = await countFor('hook_type', h)
    return { label: h, url: `/ads/format/${toSlug(h)}`, ads, live: ads >= MIN }
  }))).sort((a, b) => b.ads - a.ads)

  const alternatives = ALTERNATIVES.map((a) => ({ label: a, url: `/alternatives/${toSlug(a)}`, live: true, ads: null }))

  const liveCount = industries.filter((x) => x.live).length + formats.filter((x) => x.live).length + alternatives.length
  const totalCount = industries.length + formats.length + alternatives.length
  return NextResponse.json({
    min_ads: MIN,
    summary: { total: totalCount, live: liveCount, thin: totalCount - liveCount, alternatives: alternatives.length, industriesLive: industries.filter(x => x.live).length, formatsLive: formats.filter(x => x.live).length },
    industries, formats, alternatives,
  })
}
