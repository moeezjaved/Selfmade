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
import { discoverCompetitors, WRONG_INDUSTRY, type DiscoveryResult } from '@/lib/ads-studio/competitors'
import { fetchLiveAdsByPage, type LiveAd } from '@/lib/ads-studio/adlibrary'
import { isAppDomain } from '@/lib/domain-guard'
import { readAdsStudio, mergeAdsStudio, readSection, sectionPayload, isBuilding, buildingPayload } from '@/lib/ads-studio/cache'
import { waitUntil } from '@vercel/functions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180   // Ad Library search runs on the droplet (Playwright) — allow headroom

const AD_COLS = 'ad_id, page_id, page_name, thumbnail_url, raw_image_urls, body, title, format, days_running, is_active, hook_type, angle, persona'

const topOf = (vals: (string | null | undefined)[], n = 3): string[] => {
  const c = new Map<string, number>()
  for (const v of vals) { const s = (v || '').trim(); if (s) c.set(s, (c.get(s) || 0) + 1) }
  return Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}
// A Dynamic Product Ad (catalog feed) — Meta auto-generates it from the store's product catalog, so the
// "creative" is just a plain product photo and the copy is an unfilled template token like {{product.brand}}
// or {{product.name}}. These are NOT real creative ads (they're the competitor's CATALOG products), so we
// drop them from the inspiration row — the founder wants designed ads to remake, not product shots.
const isCatalogAd = (...text: (string | null | undefined)[]) => text.some((t) => /\{\{\s*[\w.]+\s*\}\}/.test(t || ''))
const cleanAd = (a: any) => ({
  id: a.ad_id,
  thumb: a.thumbnail_url || (Array.isArray(a.raw_image_urls) ? a.raw_image_urls[0] : null) || null,
  copy: (a.body || a.title || '').slice(0, 220),
  format: a.format || null,
  active: a.is_active ?? true,
})
// Live fbcdn media → permanent R2 cache (never hotlink fbcdn); corpus thumbs are already R2, left as-is.
const mediaUrl = (u?: string | null) => (u ? `/api/ads-studio/media?u=${encodeURIComponent(u)}` : null)
// A live Ad Library ad → a competitor card ad (one thumb per ad). Catalog/DPA ads are filtered out.
const liveToCards = (live: LiveAd[]) => live
  .filter((a) => !isCatalogAd(a.body, a.title))
  .map((a) => ({
    id: a.adId, thumb: mediaUrl(a.images[0] || a.videoPreviews[0]),
    copy: (a.body || a.title || '').slice(0, 220), format: a.videos.length ? 'video' : 'image', active: a.isActive,
  })).filter((a) => a.thumb)
// The competitor row shows IMAGE ads — float images to the front so they survive the display cap; videos tail.
const imagesFirst = <T extends { format?: string | null }>(ads: T[]): T[] =>
  [...ads].sort((a, b) => (a.format === 'image' ? 0 : 1) - (b.format === 'image' ? 0 : 1))
// Signature of the ACTUAL image behind a thumb, so we dedup by creative — Meta serves the same image under
// many ad IDs. For a proxied live thumb (/media?u=<fbcdn>) we key on the inner fbcdn image path; corpus
// thumbs are stable R2 URLs. Falls back to the whole string. This is what removes visual duplicates.
const imgSig = (thumb?: string | null): string => {
  if (!thumb) return ''
  try {
    const m = thumb.match(/[?&]u=([^&]+)/)
    const raw = m ? decodeURIComponent(m[1]) : thumb
    const u = new URL(raw, 'https://x')
    return (u.pathname.split('/').filter(Boolean).pop() || raw).toLowerCase()
  } catch { return thumb }
}
// Dedup a competitor's ads by IMAGE (not ad id), images first. No arbitrary trim — show every unique creative
// we have for them, bounded only by this generous safety cap.
const uniqueByImage = (ads: any[]): any[] => {
  const seen = new Set<string>()
  const seenCopy = new Set<string>()
  const out: any[] = []
  for (const a of imagesFirst(ads || [])) {
    const s = imgSig(a?.thumb) || a?.id
    if (!s || seen.has(s)) continue
    // Meta serves the SAME creative under different CDN URLs (so imgSig misses them) — the classic
    // "same ad shown 3×". Collapse by exact ad copy too: if we've already shown a card with this exact
    // (substantial) copy, it's the same creative repeated. Short/empty copies are never deduped this way.
    const csig = String(a?.copy || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (csig.length > 25 && seenCopy.has(csig)) continue
    seen.add(s); if (csig.length > 25) seenCopy.add(csig); out.push(a)
  }
  return out.slice(0, AD_CARD_CAP)
}
const AD_CARD_CAP = 1000   // keep essentially ALL of a competitor's unique creatives (dedup handles repeats)
const DISCOVERY_COOLDOWN_MS = 30 * 60 * 1000   // don't re-run open-web discovery more than every 30 min per brand
const SPIED_TTL_MS = 30 * 60 * 1000            // re-pull a spied brand's live ads at most every 30 min (deep scrape is slow)
const SPIED_REFRESH_MAX = 4                    // deep-pull at most this many spied brands per background run (droplet budget)

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
        .eq('has_creative', true).order('performance_score', { ascending: false, nullsFirst: false }).limit(12)
      ads = r.data
    }
    if (!ads?.length && nameOk) {
      const r = await admin.from('discovery_ads_index').select(AD_COLS)
        .ilike('page_name', name).eq('has_creative', true)
        .order('performance_score', { ascending: false, nullsFirst: false }).limit(12)
      ads = r.data
    }
    if (!ads?.length) return null
    const pageId = ads[0].page_id
    const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pageId)
    return {
      pageId,
      adCount: count ?? ads.length,
      ads: ads.map(cleanAd).filter((a: any) => a.thumb && !isCatalogAd(a.copy)),
      dna: { hooks: topOf(ads.map((a: any) => a.hook_type)), angles: topOf(ads.map((a: any) => a.angle)), personas: topOf(ads.map((a: any) => a.persona)) },
    }
  } catch { return null }
}

/** Enrich each discovered rival with our ad-DNA (corpus) or its live ads. Shared by the inline (anon) path
 * and the background job so both produce identical cards. */
const MAX_DEEP_PULLS = 4        // rivals deep-pulled per background run (bounded for the shared droplet; union accumulates the rest across runs)
const DEEP_PULL_LIMIT = 500     // ads scrolled per rival — their FULL live Ad Library page (droplet scroll cap)
async function enrichDiscovered(admin: any, res: DiscoveryResult) {
  // Pass 1: corpus DNA for everyone + any ads already attached during discovery (cheap).
  const base = await Promise.all(res.competitors.map(async (c) => {
    const dna = await adDnaFor(admin, c.name, c.domain)
    const liveAds: any[] = c.liveAds?.length ? liveToCards(c.liveAds) : []
    return { c, dna, liveAds }
  }))
  // Pass 2: DEEP-PULL each rival that has a Meta page — scroll their FULL live Ad Library page (up to
  // DEEP_PULL_LIMIT), NOT the 4 the name/keyword search returned. Bounded per run (MAX_DEEP_PULLS) and
  // time-boxed so the shared droplet finishes inside the 180s budget; the sticky-union cache accumulates
  // the rest across runs, so over a few refreshes we hold every rival's whole set of live creatives.
  const targets = base.filter((b) => b.c.pageId).slice(0, MAX_DEEP_PULLS)
  // Each rival updates its own liveAds as its deep pull resolves. We race the WHOLE batch against one
  // overall deadline so the run ALWAYS returns in time to write the cache — rivals whose pull finished get
  // their full set; the rest keep their shallow ads and deepen on a later run (durable union accumulates).
  const deepPulls = Promise.all(targets.map(async (b) => {
    const raw: LiveAd[] = await Promise.race([
      fetchLiveAdsByPage(String(b.c.pageId), DEEP_PULL_LIMIT).catch(() => [] as LiveAd[]),
      new Promise<LiveAd[]>((r) => setTimeout(() => r([]), 50_000)),   // per-rival cap
    ])
    const deep = liveToCards(raw)
    if (deep.length >= b.liveAds.length) b.liveAds = deep
    // Durably save this rival's IMAGE ads → R2 + the shared discovery library (permanent; powers Discover).
    // Purely additive background side-effect — the cards above are unchanged. Best-effort.
    if (raw.length && b.c.pageId) {
      waitUntil(import('@/lib/discovery/persist').then(({ persistPulledAds }) =>
        persistPulledAds(admin, String(b.c.pageId), b.c.name, raw, { imagesOnly: true })).then(() => {}, () => {}))
    }
  }))
  await Promise.race([deepPulls, new Promise<void>((r) => setTimeout(r, 60_000))])   // OVERALL cap → always leaves budget to write
  return base.map(({ c, dna, liveAds }) => {
    // Prefer the deep LIVE pull (the rival's actual current ads, ALL of them); fall back to our corpus DNA.
    const ads = imagesFirst(liveAds.length ? liveAds : (dna?.ads ?? []))
    return {
      source: 'discovered', domain: c.domain, name: c.name, reason: c.reason,
      hasAdDna: !!dna, adsSource: liveAds.length ? 'live' : (dna ? 'corpus' : null),
      spyable: ads.length === 0,
      adCount: ads.length, ads, dna: dna?.dna ?? null, pageId: dna?.pageId ?? c.pageId ?? null,
    }
  })
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

    // DIAGNOSTIC: ?debug=1 runs discovery INLINE and returns a per-stage breakdown (crawl → seed queries →
    // SERP candidates → LLM rank → Ad Library → final) so we can see exactly where a brand drops to zero
    // rivals. Logged-in only; no caching, no side effects.
    if (req.nextUrl.searchParams.get('debug') === '1' && user && domain) {
      const res: any = await discoverCompetitors(domain, { debug: true }).catch((e: any) => ({ error: String(e?.message || e).slice(0, 200) }))
      return NextResponse.json({ debug: res?.debug || null, competitorsFound: (res?.competitors || []).length, error: res?.error || null })
    }

    // The brand's warm ads-studio cache — reused by both the discovered pass (section 1) and the spied
    // ad-pull cache (section 2), so neither blocks the workspace load on a slow droplet scrape.
    const studioCache = brandId ? await readAdsStudio(admin, brandId) : {}

    // ── 1. DISCOVERED rivals (the expensive open-web pass) — cached per brand/domain so the workspace is
    // instant after the first build. ──
    let discovered: any[] = []
    let seed: any = null
    let configured = true
    let discoveryDone = false
    let discovering = false
    if (brandId && domain && !force) {
      const cached = readSection<{ discovered: any[]; seed: any; configured: boolean; ranAt?: number }>(studioCache, 'competitors', domain)
      // Serve a cache that FOUND rivals, OR one that RAN RECENTLY even if it found none. The old code
      // treated every empty result as a miss and re-ran discovery on EVERY load — which hammered the one
      // shared droplet so no background run ever finished (permanent "discovering"). A recent run (within
      // the cooldown) is respected so the droplet can actually complete a scan; after that it retries.
      const recent = cached?.ranAt && (Date.now() - cached.ranAt < DISCOVERY_COOLDOWN_MS)
      if (cached && ((cached.discovered || []).length || recent)) { discovered = cached.discovered || []; seed = cached.seed; configured = cached.configured; discoveryDone = true }
      else if (isBuilding(studioCache, 'competitors', domain)) { discoveryDone = true; discovering = true }   // a background run is in-flight → serve spied-only, client polls
    }
    if (!discoveryDone && domain && domain.includes('.') && !isAppDomain(domain)) {
      if (brandId) {
        // Run the expensive discovery in the BACKGROUND (waitUntil) so it ALWAYS finishes and caches, even if
        // the user navigates away mid-scan. That aborted-request-never-caches path was the "re-scans the store
        // every single visit" bug. Return the spied brands NOW with discovering:true; the client polls for the
        // cached result and never sits through the full scan again.
        discovering = true
        await mergeAdsStudio(admin, brandId, { competitorsBuilding: buildingPayload(domain) }).catch(() => {})
        waitUntil((async () => {
          // The Meta Ad Library scrape runs on ONE shared droplet and is FLAKY — the same brand returns a
          // different handful of rivals each run. DURABLE ACCUMULATION: a rival, once found with ads, is NEVER
          // dropped because a later run missed it; each run only ADDS new rivals and UNIONs more ads onto the
          // ones we already have. The list only ever grows toward the complete set.
          let fresh: any[] = []; let seedOut: any = null; let configuredOut = true
          try {
            const res = await discoverCompetitors(domain).catch(() => null)
            if (res) { fresh = await enrichDiscovered(admin, res); seedOut = res.seed; configuredOut = res.configured }
          } catch { /* scrape failed → we still keep everything we had (below) */ }
          // Re-read the cache AFTER the long scrape (not a stale pre-scrape snapshot) so a slow run merges
          // against the freshest state instead of clobbering a run that finished while this one was scraping.
          const latest = brandId ? await readAdsStudio(admin, brandId).catch(() => ({})) : {}
          const prev = readSection<{ discovered: any[]; seed: any; configured: boolean }>(latest, 'competitors', domain, 1000 * 60 * 60 * 24 * 30)
          const prevDisc: any[] = Array.isArray(prev?.discovered) ? prev!.discovered : []
          const keyOf = (c: any) => String(c?.pageId || c?.domain || c?.name || '').toLowerCase()
          const byKey = new Map<string, any>()
          for (const c of prevDisc) { const k = keyOf(c); if (k) byKey.set(k, c) }   // start from EVERYTHING we already had
          for (const c of fresh) {
            const k = keyOf(c); if (!k) continue
            const cur = byKey.get(k)
            if (!cur) { byKey.set(k, c); continue }                                    // a newly-found rival → add
            const mergedAds = uniqueByImage([...(c?.ads || []), ...(cur?.ads || [])])  // known rival → union its ads
            byKey.set(k, { ...cur, ...c, ads: mergedAds, adCount: mergedAds.length, spyable: mergedAds.length === 0 })
          }
          const chosen = Array.from(byKey.values()).sort((a, b) => (b?.ads?.length || 0) - (a?.ads?.length || 0)).slice(0, 40)
          // Only stamp `ranAt` (which arms the 30-min cooldown) when we ACTUALLY have rivals. An empty result
          // gets ranAt:0 so the cooldown never locks a blank cache — the next load retries until a run lands
          // rivals. Prevents the "stuck at 0 for 30 min" trap from one flaky run.
          const ranAt = chosen.length ? Date.now() : 0
          const payload = { discovered: chosen, seed: seedOut || prev?.seed || null, configured: configuredOut, ranAt }
          await mergeAdsStudio(admin, brandId, { competitors: sectionPayload(domain, payload), competitorsBuilding: null }).catch(() => {})
        })())
      } else {
        // No brand to cache against (anon) → run inline so they still get a result this request.
        const res = await discoverCompetitors(domain).catch(() => null)
        if (res) { seed = res.seed; configured = res.configured; discovered = await enrichDiscovered(admin, res) }
      }
    }

    // ── 2. The user's manually-spied brands. The BRAND LIST is live (spy/unspy is instant); their AD-PULL
    // is CACHED. A deep Meta scrape now walks the FULL library (~20-30s/brand), so it must NOT run inline
    // on every workspace load. Serve the last cached deep pull instantly; refresh it in the background when
    // stale. First-ever load falls back to whatever's in our corpus while the background pull fills in. ──
    let spied: any[] = []
    let spiedBuilding = false
    if (user) {
      let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true)
      if (brandId) q = q.eq('brand_id', brandId)   // STRICT per active brand (else unrelated spies leak in)
      const { data: follows } = await q.limit(30)
      const pageIds: string[] = Array.from(new Set<string>((follows || []).map((f: any) => String(f.page_id)).filter(Boolean))).slice(0, 12)
      if (pageIds.length) {
        const nameMap = await resolveBrandNames(admin, pageIds).catch(() => new Map<string, string>())
        const nameFor = (pid: string) => nameMap.get(pid) || (follows || []).find((f: any) => String(f.page_id) === pid)?.brand_name || 'Competitor'
        const corpusFor = async (pid: string) => {
          const [{ data: cAds }, { count }] = await Promise.all([
            admin.from('discovery_ads_index').select(AD_COLS).eq('page_id', pid).eq('has_creative', true).order('performance_score', { ascending: false, nullsFirst: false }).limit(AD_CARD_CAP),
            admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pid),
          ])
          return { list: cAds || [], count: count ?? (cAds?.length || 0) }
        }
        // Long maxAge on the read so we always show the LAST cached deep pull; `ranAt` inside decides refresh.
        const cachedSpied = brandId ? readSection<{ byPage: Record<string, any>; ranAt: number }>(studioCache, 'spiedAds', domain || 'spied', 1000 * 60 * 60 * 24 * 14) : null
        const byPage = cachedSpied?.byPage || {}
        spied = await Promise.all(pageIds.map(async (pageId) => {
          const cc = byPage[pageId]
          if (cc && Array.isArray(cc.ads) && cc.ads.length) {   // cached deep pull → instant, full
            return { source: 'spied', pageId, domain: null, name: nameFor(pageId), reason: 'You are spying this brand', hasAdDna: cc.hasAdDna ?? false, adsSource: cc.adsSource || 'live', spyable: false, adCount: cc.adCount ?? cc.ads.length, ads: cc.ads, dna: cc.dna || { hooks: [], angles: [], personas: [] } }
          }
          const { list, count } = await corpusFor(pageId)   // never-pulled brand → corpus placeholder
          const cardAds = imagesFirst(list.map(cleanAd).filter((a: any) => a.thumb && !isCatalogAd(a.copy)))
          return { source: 'spied', pageId, domain: null, name: nameFor(pageId), reason: 'You are spying this brand', hasAdDna: list.length > 0, adsSource: 'corpus' as const, spyable: false, adCount: count, ads: cardAds, dna: { hooks: topOf(list.map((a: any) => a.hook_type)), angles: topOf(list.map((a: any) => a.angle)), personas: topOf(list.map((a: any) => a.persona)) } }
        }))
        // Refresh in the BACKGROUND when the cache is stale/missing or any spied brand hasn't been pulled yet.
        const stale = !cachedSpied || (Date.now() - (cachedSpied.ranAt || 0) > SPIED_TTL_MS) || pageIds.some((p) => !byPage[p]?.ads?.length)
        if (brandId && stale && !isBuilding(studioCache, 'spiedAds', domain || 'spied')) {
          spiedBuilding = true
          await mergeAdsStudio(admin, brandId, { spiedAdsBuilding: buildingPayload(domain || 'spied') }).catch(() => {})
          waitUntil((async () => {
            const next: Record<string, any> = { ...byPage }   // keep other brands' cached pulls
            // Prioritise brands we have NOTHING cached for, then the rest, capped for the droplet budget.
            const order = [...pageIds.filter((p) => !byPage[p]?.ads?.length), ...pageIds.filter((p) => byPage[p]?.ads?.length)].slice(0, SPIED_REFRESH_MAX)
            await Promise.all(order.map(async (pid) => {
              try {
                const { list, count } = await corpusFor(pid)
                let cardAds = list.map(cleanAd).filter((a: any) => a.thumb && !isCatalogAd(a.copy))
                let adCount = count
                let adsSource: 'corpus' | 'live' = 'corpus'
                const live = liveToCards(await fetchLiveAdsByPage(pid, 250).catch(() => []))   // deep pull
                if (live.length) {
                  const seen = new Set(cardAds.map((a: any) => a.id))
                  for (const a of live) if (a.id && !seen.has(a.id)) { cardAds.push(a); seen.add(a.id) }
                  if (!list.length) adsSource = 'live'
                  adCount = Math.max(adCount, cardAds.length)
                }
                next[pid] = { name: nameFor(pid), ads: uniqueByImage(cardAds), adCount, adsSource, hasAdDna: list.length > 0, dna: { hooks: topOf(list.map((a: any) => a.hook_type)), angles: topOf(list.map((a: any) => a.angle)), personas: topOf(list.map((a: any) => a.persona)) } }
              } catch { /* skip this brand this round */ }
            }))
            await mergeAdsStudio(admin, brandId, { spiedAds: sectionPayload(domain || 'spied', { byPage: next, ranAt: Date.now() }), spiedAdsBuilding: null }).catch(() => {})
          })())
        }
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
      cur.adCount = Math.max(cur.adCount || 0, c.adCount || 0, cur.ads.length)
      if (!cur.hasAdDna && c.hasAdDna) { cur.hasAdDna = true; cur.dna = c.dna; cur.adsSource = c.adsSource }
      cur.spyable = !!cur.spyable && !!c.spyable
      if (!cur.pageId && c.pageId) cur.pageId = c.pageId
      if (!cur.domain && c.domain) cur.domain = c.domain
    }
    let merged = Array.from(byBrand.values())
    // Drop same-name wrong-industry collisions (e.g. "Medora Hotels & Resorts" for cosmetics brand "Medora")
    // at serve-time too, so an already-cached bad match clears without waiting for a re-scan.
    merged = merged.filter((c: any) => !(WRONG_INDUSTRY.test(c?.name || '') && c?.source !== 'spied'))
    // Dedup each card by the actual IMAGE (not ad id) so no repeats, images first, AND drop any catalog/DPA
    // product ads (serve-time filter, so already-cached results are cleaned without waiting for a re-scan).
    // Check EVERY text field, not just `copy` — legacy cached ads stored the DPA token under body/title/text,
    // so a copy-only check let "{{product.brand}}" cards leak. Also drop cards with no usable image.
    for (const c of merged) c.ads = uniqueByImage((c.ads || []).filter((a: any) => a?.thumb && !isCatalogAd(a?.copy, a?.body, a?.title, a?.text, a?.name)))
    merged.forEach((c: any) => { c.adCount = c.ads.length })
    // Brands with real ad-DNA / live ads rise to the top.
    merged.sort((a, b) => (b.ads.length - a.ads.length) || ((b.hasAdDna ? 1 : 0) - (a.hasAdDna ? 1 : 0)))

    return NextResponse.json({ seed, configured, competitors: merged, discovering, refreshing: spiedBuilding })
  } catch (e: any) {
    return NextResponse.json({ competitors: [], error: String(e?.message || e).slice(0, 160) })
  }
}
