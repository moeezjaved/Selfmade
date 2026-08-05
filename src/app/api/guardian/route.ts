/**
 * GET /api/guardian — Brand Guardian: competitor moves from our own crawl (rivals launching new ads) +
 * public conversation (Reddit) about you and shoppers leaving your rivals. Read-only, advisory. Cached so
 * the brief card doesn't re-scan on every open.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { scanBrandGuardian, type GuardianAlert } from '@/lib/guardian/scan'
import { scanMentions, type Mention } from '@/lib/guardian/social'
import { scanRivalSites, type SiteAlert } from '@/lib/guardian/web'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

type Payload = { alerts: GuardianAlert[]; mentions: Mention[]; siteAlerts: SiteAlert[]; crawl?: { lastCheckedAt: string | null; hours: number | null }; generatedAt: string }
const cache = new Map<string, { at: number; data: Payload }>()
const TTL = 30 * 60 * 1000

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = req.nextUrl.searchParams.get('brand') || undefined
  const key = `${user.id}:${brandId || 'all'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL && req.nextUrl.searchParams.get('fresh') !== '1') return NextResponse.json(hit.data)

  const admin = createAdminClient()
  try {
    const alerts = await scanBrandGuardian(admin, user.id, { brandId })
    // Brand name for reputation search — the picked brand, else the first.
    let brand = ''
    try { const { data } = await admin.from('brands').select('name').eq(brandId ? 'id' : 'user_id', brandId || user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(); brand = data?.name || '' } catch { /* ok */ }
    const rivals = alerts.map(a => a.brand).filter(b => b && b !== 'A competitor').slice(0, 2)
    let mentions: Mention[] = []
    let siteAlerts: SiteAlert[] = []
    try { [mentions, siteAlerts] = await Promise.all([scanMentions(brand, rivals), scanRivalSites(admin, user.id, { brandId })]) } catch { /* best-effort */ }

    // Crawl freshness — when were the spied competitors last re-crawled? A stale value = the droplet
    // crawler stalled, which is why "a competitor launched new ads" wouldn't be noticed.
    let crawl: Payload['crawl'] = { lastCheckedAt: null, hours: null }
    try {
      let fq = admin.from('followed_brands').select('page_id').eq('user_id', user.id).eq('spied', true)
      if (brandId) fq = fq.eq('brand_id', brandId)
      const { data: f } = await fq.limit(50)
      const ids = (f || []).map((x: any) => x.page_id).filter(Boolean)
      if (ids.length) {
        const { data: terms } = await admin.from('discovery_crawl_terms').select('last_crawled_at').in('page_id', ids).order('last_crawled_at', { ascending: false, nullsFirst: false }).limit(1)
        const last = terms?.[0]?.last_crawled_at || null
        crawl = { lastCheckedAt: last, hours: last ? Math.round((Date.now() - Date.parse(last)) / 3600000) : null }
      }
    } catch { /* freshness is best-effort */ }

    const data: Payload = { alerts, mentions, siteAlerts, crawl, generatedAt: new Date().toISOString() }
    cache.set(key, { at: Date.now(), data })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: 'guardian_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
