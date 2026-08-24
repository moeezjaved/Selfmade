/**
 * GET /api/ads-studio/competitors?domain=… — the ads-workspace "My Competitors" feed.
 * DISCOVERS the store's real rivals from the open web (discoverCompetitors: crawl → category → Google →
 * rank), then ENRICHES each with our ad-DNA when we've already crawled that brand (hooks/personas/angles +
 * sample live ads). Rivals we haven't crawled are flagged `spyable` so we can pull their ads on demand.
 * Also merges in the logged-in user's manually-spied brands (source:'spied'). Web discovery needs no login.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveBrandNames } from '@/lib/discovery/brandNames'
import { discoverCompetitors } from '@/lib/ads-studio/competitors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180   // Ad Library search runs on the droplet (Playwright) — allow headroom

const AD_COLS = 'ad_id, page_id, page_name, thumbnail_url, raw_image_urls, body, title, format, days_running, is_active, hook_type, angle, persona'

const topOf = (vals: (string | null | undefined)[], n = 3): string[] => {
  const c = new Map<string, number>()
  for (const v of vals) { const s = (v || '').trim(); if (s) c.set(s, (c.get(s) || 0) + 1) }
  return Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}
const cleanAd = (a: any) => ({
  id: a.ad_id,
  thumb: a.thumbnail_url || (Array.isArray(a.raw_image_urls) ? a.raw_image_urls[0] : null) || null,
  copy: (a.body || a.title || '').slice(0, 220),
  format: a.format || null,
  active: a.is_active ?? true,
})

/** Look up a discovered rival in our ad-DNA corpus. Matches by the rival's own DOMAIN (precise — the ad's
 * destination URL) first, so "Flair" (flavored air) never collides with "Flair Espresso" (coffee); falls back
 * to an EXACT page-name match only when we have no domain (e.g. a user's manually-spied brand). */
async function adDnaFor(admin: any, name: string, domain?: string | null) {
  const nameOk = !!name && name.replace(/[^a-z0-9]/gi, '').length >= 4
  if (!domain && !nameOk) return null
  try {
    let ads: any[] | null = null
    if (domain) {
      const d = domain.replace(/^www\./, '')
      const like = `*${d}*`
      const r = await admin.from('discovery_ads_index').select(AD_COLS)
        .or(`link_url.ilike.${like},landing.ilike.${like},website.ilike.${like}`)
        .eq('has_creative', true).order('performance_score', { ascending: false, nullsFirst: false }).limit(6)
      ads = r.data
    }
    if (!ads?.length && nameOk) {
      const r = await admin.from('discovery_ads_index').select(AD_COLS)
        .ilike('page_name', name).eq('has_creative', true)
        .order('performance_score', { ascending: false, nullsFirst: false }).limit(6)
      ads = r.data
    }
    if (!ads?.length) return null
    const pageId = ads[0].page_id
    const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pageId)
    return {
      pageId,
      adCount: count ?? ads.length,
      ads: ads.map(cleanAd).filter((a: any) => a.thumb),
      dna: { hooks: topOf(ads.map((a: any) => a.hook_type)), angles: topOf(ads.map((a: any) => a.angle)), personas: topOf(ads.map((a: any) => a.persona)) },
    }
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get('domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  try {
    const admin = createAdminClient() as any

    // ── 1. Discover rivals from the open web, then enrich each with our ad-DNA ──
    let discovered: any[] = []
    let seed: any = null
    let configured = true
    if (domain && domain.includes('.')) {
      const res = await discoverCompetitors(domain).catch(() => null)
      if (res) {
        seed = res.seed; configured = res.configured
        discovered = await Promise.all(res.competitors.map(async (c) => {
          // Richest source first: our ad-DNA corpus (hooks/personas), matched by the rival's DOMAIN. Else live ads.
          const dna = await adDnaFor(admin, c.name, c.domain)
          const liveAds = (!dna && c.liveAds?.length)
            ? c.liveAds.map((a) => ({ id: a.adId, thumb: a.images[0] || null, copy: (a.body || a.title || '').slice(0, 220), format: a.videos.length ? 'video' : 'image', active: a.isActive })).filter((a) => a.thumb)
            : []
          const ads = dna?.ads ?? liveAds
          return {
            source: 'discovered', domain: c.domain, name: c.name, reason: c.reason,
            hasAdDna: !!dna, adsSource: dna ? 'corpus' : (liveAds.length ? 'live' : null),
            spyable: ads.length === 0,
            adCount: dna?.adCount ?? c.liveAds?.length ?? 0, ads, dna: dna?.dna ?? null, pageId: dna?.pageId ?? c.pageId ?? null,
          }
        }))
      }
    }

    // ── 2. Merge in the logged-in user's manually-spied brands (existing behavior) ──
    let spied: any[] = []
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (user) {
      const brandId = await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand') || undefined).catch(() => null)
      let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true)
      if (brandId) q = q.or(`brand_id.eq.${brandId},brand_id.is.null`)
      const { data: follows } = await q.limit(30)
      const pageIds: string[] = Array.from(new Set((follows || []).map((f: any) => String(f.page_id)).filter(Boolean)))
      if (pageIds.length) {
        const nameMap = await resolveBrandNames(admin, pageIds).catch(() => new Map<string, string>())
        spied = await Promise.all(pageIds.slice(0, 12).map(async (pageId) => {
          const [{ data: ads }, { count }] = await Promise.all([
            admin.from('discovery_ads_index').select(AD_COLS).eq('page_id', pageId).eq('has_creative', true).order('performance_score', { ascending: false, nullsFirst: false }).limit(6),
            admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pageId),
          ])
          const list = ads || []
          return {
            source: 'spied', pageId, domain: null,
            name: nameMap.get(pageId) || (follows || []).find((f: any) => String(f.page_id) === pageId)?.brand_name || 'Competitor',
            reason: 'You are spying this brand', hasAdDna: list.length > 0, adsSource: 'corpus', spyable: false,
            adCount: count ?? list.length, ads: list.map(cleanAd).filter((a: any) => a.thumb),
            dna: { hooks: topOf(list.map((a: any) => a.hook_type)), angles: topOf(list.map((a: any) => a.angle)), personas: topOf(list.map((a: any) => a.persona)) },
          }
        }))
      }
    }

    // Dedupe spied brands already surfaced by discovery (by lowercased name), discovered first.
    const seenNames = new Set(discovered.map((d) => d.name.toLowerCase()))
    const merged = [...discovered, ...spied.filter((s) => !seenNames.has(String(s.name).toLowerCase()))]
    // Brands with real ad-DNA rise to the top.
    merged.sort((a, b) => (b.ads.length - a.ads.length) || (b.hasAdDna ? 1 : 0) - (a.hasAdDna ? 1 : 0))

    return NextResponse.json({ seed, configured, competitors: merged })
  } catch (e: any) {
    return NextResponse.json({ competitors: [], error: String(e?.message || e).slice(0, 160) })
  }
}
