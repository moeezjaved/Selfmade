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
import { readAdsStudio, mergeAdsStudio, readSection, sectionPayload, isBuilding, buildingPayload } from '@/lib/ads-studio/cache'

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
// Live fbcdn media → permanent R2 cache (never hotlink fbcdn); corpus thumbs are already R2, left as-is.
const mediaUrl = (u?: string | null) => (u ? `/api/ads-studio/media?u=${encodeURIComponent(u)}` : null)

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
  const force = req.nextUrl.searchParams.get('force') === '1'
  try {
    const admin = createAdminClient() as any

    // Resolve the active brand up front — it scopes both the cache and the spied merge below.
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    const brandId = user ? await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand') || undefined).catch(() => null) : null

    // ── 1. DISCOVERED rivals (the expensive open-web pass) — cached per brand/domain so the workspace is
    // instant after the first build. Only the discovered part is cached; spied brands stay live below. ──
    let discovered: any[] = []
    let seed: any = null
    let configured = true
    let discoveryDone = false
    if (brandId && domain && !force) {
      const ads = await readAdsStudio(admin, brandId)
      const cached = readSection<{ discovered: any[]; seed: any; configured: boolean }>(ads, 'competitors', domain)
      if (cached) { discovered = cached.discovered || []; seed = cached.seed; configured = cached.configured; discoveryDone = true }
      else if (isBuilding(ads, 'competitors', domain)) { discoveryDone = true }   // another run in-flight → serve spied-only for now
    }
    if (!discoveryDone && domain && domain.includes('.')) {
      if (brandId) await mergeAdsStudio(admin, brandId, { competitorsBuilding: buildingPayload(domain) }).catch(() => {})
      const res = await discoverCompetitors(domain).catch(() => null)
      if (res) {
        seed = res.seed; configured = res.configured
        discovered = await Promise.all(res.competitors.map(async (c) => {
          // Richest source first: our ad-DNA corpus (hooks/personas), matched by the rival's DOMAIN. Else live ads.
          const dna = await adDnaFor(admin, c.name, c.domain)
          const liveAds = (!dna && c.liveAds?.length)
            ? c.liveAds.map((a) => ({ id: a.adId, thumb: mediaUrl(a.images[0] || a.videoPreviews[0]), copy: (a.body || a.title || '').slice(0, 220), format: a.videos.length ? 'video' : 'image', active: a.isActive })).filter((a) => a.thumb)
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
      if (brandId) await mergeAdsStudio(admin, brandId, { competitors: sectionPayload(domain, { discovered, seed, configured }), competitorsBuilding: null }).catch(() => {})
    }

    // ── 2. Merge in the logged-in user's manually-spied brands (always live — user can spy/unspy) ──
    let spied: any[] = []
    if (user) {
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

    // Collapse duplicate brands into ONE card. The same rival can surface under several Meta page IDs
    // (or via both Google and the Ad Library), which showed a brand like "MuscleMax" as many separate
    // cards. Merge by normalized brand name, combining their live ads (unique by id) and keeping the
    // richest metadata. Discovered entries come first so their card wins the base fields.
    const normName = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const byBrand = new Map<string, any>()
    for (const c of [...discovered, ...spied]) {
      const key = normName(c.name)
      if (!key) continue
      const cur = byBrand.get(key)
      if (!cur) { byBrand.set(key, { ...c, ads: [...(c.ads || [])] }); continue }
      const seenAds = new Set(cur.ads.map((a: any) => a.id))
      for (const a of (c.ads || [])) { if (a?.id && !seenAds.has(a.id)) { cur.ads.push(a); seenAds.add(a.id) } }
      cur.ads = cur.ads.slice(0, 8)
      cur.adCount = Math.max(cur.adCount || 0, c.adCount || 0, cur.ads.length)
      if (!cur.hasAdDna && c.hasAdDna) { cur.hasAdDna = true; cur.dna = c.dna; cur.adsSource = c.adsSource }
      cur.spyable = !!cur.spyable && !!c.spyable
      if (!cur.pageId && c.pageId) cur.pageId = c.pageId
      if (!cur.domain && c.domain) cur.domain = c.domain
    }
    const merged = Array.from(byBrand.values())
    // Brands with real ad-DNA / live ads rise to the top.
    merged.sort((a, b) => (b.ads.length - a.ads.length) || ((b.hasAdDna ? 1 : 0) - (a.hasAdDna ? 1 : 0)))

    return NextResponse.json({ seed, configured, competitors: merged })
  } catch (e: any) {
    return NextResponse.json({ competitors: [], error: String(e?.message || e).slice(0, 160) })
  }
}
