/**
 * Morning Brief assembly — the single source of truth for the brief payload.
 *
 * Extracted from /api/brief so the /brief PAGE can render it SERVER-SIDE (in the HTML) and the API can
 * still serve it for client refreshes. Server-rendering it means the brief shows even when the client
 * never hydrates (e.g. a browser extension breaks React) — no more "pulling the room together…" hang.
 *
 * Every source is fail-soft AND time-boxed (BUDGET_MS): a slow/broken query drops its item, never
 * stalls the brief. The brief is a rendering layer — it writes no domain data.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export type BriefItem = {
  id?: string
  kind: string
  importance: number
  title: string
  body?: string
  why?: string
  cta_label?: string
  cta_href?: string
  thumbs?: string[]
  media?: { image: string | null; videoUrl: string | null; adId?: string }[]
  /** Which of the user's brands this competitor is watched FOR (migration 117). Absent = account-level. */
  forBrand?: string
  at?: string
  /** Cross-competitor synthesis for the 'market_playbook' card — what's working across ALL watched brands. */
  playbook?: {
    totalAds: number
    brandsCount: number
    videoPct: number
    formats: { label: string; count: number }[]
    hooks: { label: string; count: number }[]
    emotions: { label: string; count: number }[]
    offers: { label: string; count: number }[]
    /** Mello's call on the pattern — the winner, how sure, and whether to run it. */
    judgment?: {
      winner: string
      confidence: 'High' | 'Medium' | 'Low'
      confidenceWhy: string
      verdict: 'Adopt' | 'Test' | 'Watch'
      verdictWhy: string
    }
  }
  /** Real Meta ad-account numbers for the 'meta_ads' card — from the nightly audit (brief_events.payload). */
  metaAudit?: {
    total: number
    spend: number
    avgRoas: number
    currency?: string
    accountName?: string | null
    scale: { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null }[]
    watch: { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null }[]
    pause: { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null }[]
    /** Pre-computed "What Mello would do" cards (nightly) so the brief renders them with no live call. */
    opportunities?: { title: string; why: string; impact: string; level: number; href: string; cta: string; tone: string }[]
  }
}

export type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  /** ISO time of Mello's newest real artifact — drives the "last worked" presence line. */
  lastCycleAt: string | null
  firstName: string | null
  headline: BriefItem | null
  items: BriefItem[]
  learning: BriefItem | null
  quiet: boolean
}

const BUDGET_MS = 6000
const soft = async <T,>(p: PromiseLike<T>, fallback: T, ms = BUDGET_MS): Promise<T> => {
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('brief source timeout')), ms)),
    ])
  } catch { return fallback }
}

export async function assembleBrief(admin: SupabaseClient, userId: string, userMeta: any, opts: { brandId?: string | null } = {}): Promise<Brief> {
  const rawName = String((userMeta as any)?.full_name || (userMeta as any)?.name || '').trim()
  const email = String((userMeta as any)?.email || '')
  const firstName = rawName ? rawName.split(/\s+/)[0] : (email ? email.split('@')[0].replace(/[._-].*$/, '') : '')
  const items: BriefItem[] = []
  const H48 = new Date(Date.now() - 48 * 3600e3).toISOString()
  const H36 = new Date(Date.now() - 36 * 3600e3).toISOString()
  const H24 = new Date(Date.now() - 24 * 3600e3).toISOString()
  const D7 = new Date(Date.now() - 7 * 86400e3).toISOString()
  const D30 = new Date(Date.now() - 30 * 86400e3).toISOString()

  // BRAND SCOPE (switcher). When a brand is selected, restrict the brief to its world: its own
  // competitors, its own creatives, its own spine items. notifications carry no brand_id, so we scope
  // them via the brand's watched page_ids (followed_brands.brand_id, migration 117). An empty set
  // (brand with no competitors yet) → NO_PAGE sentinel so the query returns nothing, not everything.
  const NO_PAGE = '__none__'
  let brandPageIds: string[] | null = null
  if (opts.brandId) {
    const rows = await soft<any[]>(admin.from('followed_brands').select('page_id')
      .eq('user_id', userId).eq('brand_id', opts.brandId).then((r: any) => r.data || []), [])
    brandPageIds = rows.map((r: any) => String(r.page_id)).filter(Boolean)
  }
  const scopePages = brandPageIds && brandPageIds.length ? brandPageIds : (brandPageIds ? [NO_PAGE] : null)

  const [spine, notifs, creatives, follows, adsScanned, observations, freshAds] = await Promise.all([
    soft<any[]>((async () => {
      let q = admin.from('brief_events').select('id, kind, importance, title, body, cta_label, cta_href, payload, created_at')
        .eq('user_id', userId).gte('created_at', H48).order('importance', { ascending: false }).limit(20)
      // brand view: this brand's items + truly account-wide ones (brand_id null).
      if (opts.brandId) q = q.or(`brand_id.eq.${opts.brandId},brand_id.is.null`)
      const { data } = await q; return data || []
    })(), []),
    soft<any[]>((async () => {
      let q = admin.from('notifications').select('id, brand_name, page_id, ad_count, sample_ad_id, created_at')
        .eq('user_id', userId).eq('type', 'new_ad').gte('created_at', H48).order('created_at', { ascending: false }).limit(8)
      if (scopePages) q = q.in('page_id', scopePages)
      const { data } = await q; return data || []
    })(), []),
    soft<any[]>((async () => {
      // Only FINISHED creatives count as "ready" — drafts/processing/review/failed must not inflate
      // the "N creatives ready" count or the headline (bug: a draft video showed as a 3rd "ready").
      let q = admin.from('creative_generations').select('id, image_url, type, created_at, status')
        .eq('user_id', userId).eq('status', 'done').gte('created_at', H36).order('created_at', { ascending: false }).limit(6)
      if (opts.brandId) q = q.eq('brand_id', opts.brandId)
      const { data } = await q; return (data || []).filter((c: any) => c.image_url)
    })(), []),
    soft<any[]>(admin.from('followed_brands').select('page_id, brand_name, spied, brand_id')
      .eq('user_id', userId).limit(200).then((r: any) => r.data || []), []),
    soft<number>((async () => {
      // Brand view: only ads from THIS brand's watched competitors read in 24h (not the whole system).
      if (scopePages) { const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).gte('created_at', H24).in('page_id', scopePages); return count || 0 }
      const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'estimated', head: true }).gte('created_at', H24)
      return count || 0
    })(), 0),
    soft<any[]>((async () => {
      let q = admin.from('daily_observations').select('id, observation, action, confidence, created_at')
        .eq('user_id', userId).gte('created_at', H48).order('created_at', { ascending: false }).limit(3)
      // brand view: ONLY this brand's observations. Unlike the spine, we don't include account-wide
      // nulls here — an observation names a specific rival ("CeraVe launched 9 ads"), so a null one
      // belongs to whichever brand watches that rival, not to a brand watching nobody.
      if (opts.brandId) q = q.eq('brand_id', opts.brandId)
      const { data } = await q; return data || []
    })(), []),
    // New competitor ads first-seen in 48h, read DIRECTLY from the crawl index (brand view only) — so a
    // rival launch shows the moment it's crawled, even if the droplet's notification never fired.
    soft<any[]>((async () => {
      if (!scopePages) return []   // a global first_seen scan is too broad; all-brands relies on notifications
      const { data } = await admin.from('discovery_ads_index')
        .select('page_id, ad_id, first_seen_at').in('page_id', scopePages).gte('first_seen_at', H48)
        .order('first_seen_at', { ascending: false }).limit(60)
      return data || []
    })(), []),
  ])

  // Brief↔chat number parity: refresh the Meta card from the SAME live audit service Mello's chat uses
  // (auditAccount — brand-scoped, 10-min cached, last_30d), so the number the founder reads on the card
  // and the number Mello quotes in chat are IDENTICAL. Fail-soft to the frozen nightly payload if the
  // live read is slow or unavailable (never blocks the brief). Fetched once (at most one Meta card).
  let liveMeta: any = null
  if ((spine as any[]).some((e: any) => e.kind === 'meta_audit')) {
    liveMeta = await soft((async () => {
      const [{ resolveBrandScopedAccount }, { auditAccount }] = await Promise.all([import('@/lib/meta/scope'), import('@/lib/meta/audit')])
      const acct = (await resolveBrandScopedAccount(admin, userId, opts.brandId ?? undefined))?.account_id
      return await auditAccount(admin, userId, acct, 'last_30d')
    })(), null, 4000)
  }

  for (const e of spine) {
    // The Meta audit carries structured numbers in payload → render as the dedicated Facebook Ads card
    // (kind 'meta_ads'), not a generic prose item. Everything else passes through by kind verbatim.
    if (e.kind === 'meta_audit' && e.payload && typeof e.payload === 'object') {
      const p: any = e.payload
      // Prefer the live audit (same source as chat) for the numbers + graded lists; keep opportunities +
      // account selection from the frozen payload (those come only from the nightly opportunities fetch).
      const m: any = (liveMeta && liveMeta.spend != null) ? liveMeta : p
      items.push({
        id: e.id, kind: 'meta_ads', importance: e.importance ?? 96, title: e.title, body: e.body || undefined,
        cta_label: e.cta_label || 'See the full report', cta_href: e.cta_href || '/reports', at: e.created_at,
        metaAudit: {
          total: Number(m.total || 0), spend: Number(m.spend || 0), avgRoas: Number(m.avgRoas || 0),
          currency: typeof m.currency === 'string' ? m.currency : (typeof p.currency === 'string' ? p.currency : 'USD'), accountName: m.accountName || p.accountName || null,
          scale: Array.isArray(m.scale) ? m.scale : [], watch: Array.isArray(m.watch) ? m.watch : [], pause: Array.isArray(m.pause) ? m.pause : [],
          opportunities: Array.isArray(p.opportunities) ? p.opportunities : [],
          ...(p.selected ? { selected: p.selected } : {}),
        } as any,
      })
      continue
    }
    items.push({ id: e.id, kind: e.kind, importance: e.importance ?? 50, title: e.title, body: e.body || undefined, cta_label: e.cta_label || undefined, cta_href: e.cta_href || undefined, at: e.created_at })
  }
  if (spine.length) admin.from('brief_events').update({ surfaced_at: new Date().toISOString() }).in('id', spine.map((e: any) => e.id)).is('surfaced_at', null).then(() => {}, () => {})

  const needIds = notifs.filter((n: any) => isBlankName(n.brand_name)).map((n: any) => n.page_id).filter(Boolean)
  if (needIds.length) {
    const names = await soft(resolveBrandNames(admin, needIds), new Map<string, string>())
    for (const n of notifs as any[]) if (isBlankName(n.brand_name)) n.brand_name = names.get(String(n.page_id)) || null
  }

  // Which of the user's brands each watched competitor belongs to (migration 117): page_id → brand name.
  // Lets the brief label a competitor line "· for Bug Shield" instead of pooling every brand together.
  const forBrandByPage = new Map<string, string>()
  const ownedBrandIds = Array.from(new Set(follows.map((f: any) => f.brand_id).filter(Boolean)))
  if (ownedBrandIds.length) {
    const brandNameById = await soft<Map<string, string>>(
      admin.from('brands').select('id, name').eq('user_id', userId).in('id', ownedBrandIds)
        .then((r: any) => new Map<string, string>((r.data || []).map((b: any) => [String(b.id), String(b.name)]))),
      new Map<string, string>())
    for (const f of follows as any[]) {
      if (!f.brand_id || !f.page_id) continue
      const nm = brandNameById.get(String(f.brand_id))
      if (nm) forBrandByPage.set(String(f.page_id), nm)
    }
  }

  const compByPage = new Map<string, BriefItem>()
  for (const n of notifs) {
    const brand = (!isBlankName(n.brand_name) && n.brand_name) || 'A brand you watch'
    const c = Math.max(1, Number(n.ad_count) || 1)
    const forBrand = n.page_id ? forBrandByPage.get(String(n.page_id)) : undefined
    const it: BriefItem = {
      kind: 'competitor_ads', importance: Math.min(85, 55 + c * 5), at: n.created_at,
      title: `${brand} launched ${c === 1 ? 'a new ad' : `${c} new ads`}.`,
      body: c > 2 ? `That's a real push, not routine rotation — worth reading what angle they're betting on before it compounds.` : `A single fresh creative — I'll flag if it turns into a burst.`,
      why: forBrand ? `You watch ${brand} for ${forBrand} — a launch like this usually means they found something working.` : `You watch ${brand} — a launch like this usually means they found something working.`,
      cta_label: 'Open the brand file', cta_href: n.page_id ? `/knowledge/brand/${n.page_id}` : `/discovery/brand-spy`,
      forBrand,
    }
    items.push(it)
    if (n.page_id) compByPage.set(String(n.page_id), it)
  }

  // Direct from the crawl index: a watched rival's new ads (first-seen 48h) that produced NO notification.
  // Guarantees a launch surfaces the moment it's crawled — the reliable path when the droplet alert lags.
  const freshByPage = new Map<string, any[]>()
  for (const a of (freshAds as any[])) { const pid = String(a.page_id); freshByPage.set(pid, [...(freshByPage.get(pid) || []), a]) }
  for (const [pid, ads] of Array.from(freshByPage.entries())) {
    if (compByPage.has(pid)) continue   // already covered by a notification above
    const brandName = ((follows as any[]).find((f: any) => String(f.page_id) === pid)?.brand_name) || 'A competitor'
    if (isBlankName(brandName)) continue
    const c = ads.length
    const forBrand = forBrandByPage.get(pid)
    const it: BriefItem = {
      kind: 'competitor_ads', importance: Math.min(85, 55 + c * 5), at: ads[0].first_seen_at,
      title: `${brandName} launched ${c === 1 ? 'a new ad' : `${c} new ads`}.`,
      body: c > 2 ? `A burst of fresh creative — worth reading the angle before it compounds.` : `A fresh creative just went live.`,
      why: forBrand ? `You watch ${brandName} for ${forBrand} — a launch usually means they found something working.` : `You watch ${brandName} — a launch usually means they found something working.`,
      cta_label: 'See their ads', cta_href: `/discovery/brand-spy/${pid}`,
      forBrand,
    }
    items.push(it)
    compByPage.set(pid, it)
  }

  let headline: BriefItem | null = null
  if (creatives.length) {
    headline = {
      kind: 'creative_ready', importance: 100, at: creatives[0].created_at,
      title: creatives.length === 1 ? `I finished a new creative for you.` : `I finished ${creatives.length} new creatives — this is the strongest.`,
      body: `Built from what's currently winning in your market. Strong signal — the format and angle match this week's top performers in your niche. Nothing launches without your approval.`,
      why: `Fresh work waiting on your call — approving or killing it today keeps your pipeline moving.`,
      cta_label: 'Review & approve', cta_href: '/creative-studio',
      thumbs: creatives.map((c: any) => c.image_url).filter(Boolean).slice(0, 4),
    }
  }

  // In a brand view, "the brands you watch" means only this brand's competitors.
  const scopedFollows = scopePages ? follows.filter((f: any) => scopePages.includes(String(f.page_id))) : follows
  // Count/scope the playbook to SPIED brands only — the exact set shown in Brand Spy (which filters
  // spied=true). Plain ❤️ follows (spied=false) live under "Following" and must not inflate the
  // "what's working across your N competitors" count (was showing 7 when the user spies 5).
  const pageIds = scopedFollows.filter((f: any) => f.spied).map((f: any) => f.page_id).filter(Boolean).slice(0, 60)
  const [marketAds, globalAds, playbookAds] = await Promise.all([
    soft((async () => {
      let q = admin.from('discovery_ads_index')
        .select('ad_id, page_id, hook_type, format_style, emotion, offer, title, body, caption, topics, created_at, discovery_creatives(asset_type, r2_url, poster_url)')
        .gte('created_at', D7).order('created_at', { ascending: false }).limit(240)
      if (pageIds.length) q = q.in('page_id', pageIds)
      // NO competitors watched (brand view OR account-level): NEVER fall back to the global market —
      // that pulled 240 random ads and fabricated "what's working across your 8 competitors" for a
      // brand-new user who added nobody. Always constrain to nothing so the playbook simply doesn't show.
      else q = q.in('page_id', [NO_PAGE])
      const { data } = await q
      return data || []
    })(), [] as any[]),
    soft((async () => {
      const { data } = await admin.from('discovery_ads_index').select('topics').gte('created_at', H48).order('created_at', { ascending: false }).limit(200)
      return data || []
    })(), [] as any[]),
    // The cross-competitor Playbook synthesizes the MOST RECENT ads for the watched brands — no hard
    // date filter (crawl cadence is lumpy; created_at reflects first-crawl, so a date window can be
    // empty even when we hold plenty of their ads). Newest-first, capped. DNA fields only, no media.
    soft((async () => {
      if (!pageIds.length) return [] as any[]
      // No ORDER BY — sorting hundreds of rows across many page_ids on a huge table can blow the 6s
      // budget. A representative sample (page_id index, capped) is all the DNA aggregation needs.
      // Fair sample: a bounded per-brand fetch so EVERY watched brand contributes (a single .in()
      // with one limit gets swallowed by the highest-volume brands). ~40 ads/brand is plenty for DNA.
      const per = await Promise.all(pageIds.slice(0, 20).map((pid: string) =>
        admin.from('discovery_ads_index')
          .select('ad_id, page_id, hook_type, format_style, emotion, offer, title, body, caption')
          .eq('page_id', pid).limit(40).then((r: any) => r.data || [])
      ))
      return per.flat()
    })(), [] as any[]),
  ])
  const tally = (rows: any[]) => {
    const m = new Map<string, number>()
    for (const a of rows) for (const t of (a.topics || [])) m.set(t, (m.get(t) || 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }
  const mediaOf = (a: any): { image: string | null; videoUrl: string | null; adId?: string } | null => {
    const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
    const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
    if (!cre) return null
    const isVid = cre.asset_type === 'video'
    return { image: isVid ? cre.poster_url : cre.r2_url, videoUrl: isVid ? (cre.r2_url || null) : null, adId: a.ad_id ? String(a.ad_id) : undefined }
  }

  for (const [pid, it] of Array.from(compByPage.entries())) {
    const m = marketAds.filter((a: any) => String(a.page_id) === pid).map(mediaOf).filter(Boolean).slice(0, 3) as any[]
    if (m.length) it.media = m
  }

  const top = tally(marketAds).slice(0, 3).filter(([, n]) => n >= 3)
  if (top.length) {
    const scope = pageIds.length ? 'across the brands you watch' : 'across the market'
    items.push({
      kind: 'trend', importance: 60,
      title: `The angle gaining ground ${scope}: “${top[0][0]}”.`,
      body: `${top[0][1]} fresh ads lean on it this week${top.length > 1 ? `; also rising: ${top.slice(1).map(([t]) => `“${t}”`).join(' and ')}` : ''}.`,
      why: pageIds.length ? `Your competitors are converging on it — early movers get the cheap clicks.` : `When a whole market converges on one angle, testing it early is the discount window.`,
      cta_label: 'Explore these ads', cta_href: `/discovery?q=${encodeURIComponent(top[0][0])}`,
    })
  }

  // Cross-competitor synthesis: combine EVERY watched brand's ads (last 30d) into one "what's working"
  // read — format mix, hooks, emotions, and offers (mined from copy) across the whole competitive set.
  const pbAds = (playbookAds.length >= 5 ? playbookAds : marketAds) as any[]
  if (pbAds.length >= 5) {
    let video = 0, imageN = 0
    const hookM = new Map<string, number>(), fmtM = new Map<string, number>(), emoM = new Map<string, number>()
    const brandSet = new Set<string>()
    // Media split comes from marketAds (they carry the creative join); DNA from the wider pbAds.
    for (const a of marketAds) { const m = mediaOf(a); if (m?.videoUrl) video++; else if (m?.image) imageN++ }
    // Offer/promo posture mined straight from the ads' copy (same signals as the competitor report).
    const OFFER_RES: { label: string; re: RegExp }[] = [
      { label: 'Price point', re: /(?:^|[^\w])\$\s?\d{1,4}(?:\.\d{2})?(?![\d%])/ },
      { label: '% off', re: /\d{1,3}\s?%\s?(?:off|discount|savings?)/i },
      { label: 'Free shipping', re: /free\s+ship\w*/i },
      { label: 'Money-back guarantee', re: /(?:money[- ]back|satisfaction|refund)\s+guarantee|guaranteed?\s+or\s+your\s+money/i },
      { label: 'BOGO / bundle', re: /buy\s+\d\s+get\s+\d|bogo|\bbundle\b|\d\s+for\s+\$?\d/i },
      { label: 'Subscribe & save', re: /subscribe\s+(?:and|&)\s+save/i },
      { label: 'Free trial / sample', re: /free\s+(?:trial|sample|gift)/i },
      { label: 'Limited-time / sale', re: /limited[- ]time|today\s+only|flash\s+sale|ends\s+(?:tonight|today|soon)/i },
    ]
    const offerM = new Map<string, number>()
    for (const a of pbAds) {
      if (a.page_id) brandSet.add(String(a.page_id))
      if (a.hook_type) hookM.set(a.hook_type, (hookM.get(a.hook_type) || 0) + 1)
      if (a.format_style) fmtM.set(a.format_style, (fmtM.get(a.format_style) || 0) + 1)
      for (const e of (Array.isArray(a.emotion) ? a.emotion : [])) if (e) emoM.set(String(e), (emoM.get(String(e)) || 0) + 1)
      const hay = [a.title, a.body, a.caption, a.offer].filter(Boolean).join(' · ')
      if (hay) for (const { label, re } of OFFER_RES) if (re.test(hay)) offerM.set(label, (offerM.get(label) || 0) + 1)
    }
    const withMedia = video + imageN        // only ads whose creative has drained — for the video% only
    const rank = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }))
    const vidPct = withMedia ? Math.round((video / withMedia) * 100) : 0
    const topHook = rank(hookM, 1)[0]
    const topFmt = rank(fmtM, 1)[0]
    const topOffer = rank(offerM, 1)[0]

    // ── JUDGMENT — Mello's call on the pattern: the winner, how sure, whether to run it. ──
    // Confidence = how concentrated the leading hook/format is, weighted by sample size + how many
    // rival brands agree. One brand doing something is a habit; three doing it is a market signal.
    const hookShare = topHook ? topHook.count / pbAds.length : 0
    const fmtShare = topFmt ? topFmt.count / pbAds.length : 0
    const lead = Math.max(hookShare, fmtShare)
    const sampleOk = pbAds.length >= 30
    const multiBrand = brandSet.size >= 2
    const confidence: 'High' | 'Medium' | 'Low' =
      (lead >= 0.4 && sampleOk && multiBrand) ? 'High'
      : (lead >= 0.25 || (lead >= 0.2 && sampleOk)) ? 'Medium'
      : 'Low'
    const verdict: 'Adopt' | 'Test' | 'Watch' = confidence === 'High' ? 'Adopt' : confidence === 'Medium' ? 'Test' : 'Watch'
    const mediaLabel = withMedia >= 3 ? (vidPct >= 50 ? 'Video' : 'Image') : (topFmt?.label || null)
    const winner = [mediaLabel, topHook ? `“${topHook.label}” hook` : null, topOffer ? `${topOffer.label.toLowerCase()} offer` : null]
      .filter(Boolean).join(' + ') || 'the shared pattern'
    const confidenceWhy = `${Math.round(lead * 100)}% of ${pbAds.length} ads${multiBrand ? ` across ${brandSet.size} brands` : ' (one brand)'} share it`
    const verdictWhy = confidence === 'High'
      ? 'Strong agreement across the set — ship this format + hook before it saturates.'
      : confidence === 'Medium'
      ? 'A real signal, not yet a consensus — run one and let the numbers decide.'
      : 'Signal is still thin — keep watching before you commit spend.'
    const judgment = { winner, confidence, confidenceWhy, verdict, verdictWhy }
    // Gate on the AD COUNT (DNA), not media availability — this card is about formats/hooks/emotions/
    // offers, which every crawled ad has even before its creative is drained to R2.
    {
      const headline = withMedia >= 3 ? (vidPct >= 50 ? `video is winning — ${vidPct}% of new ads` : `image-led — only ${vidPct}% video`) : (topFmt ? `they're leaning on “${topFmt.label}”` : 'the pattern across their ads')
      items.push({
        kind: 'market_playbook', importance: 63,
        title: `What's working across your ${brandSet.size} competitor${brandSet.size === 1 ? '' : 's'}: ${headline}${topHook ? `, hook “${topHook.label}”` : ''}.`,
        body: `Combined read of ${pbAds.length} recent ads across every brand you watch — the pattern to copy before it saturates.`,
        why: `Ship in the winning format + hook while it's still cheap. I can build you one.`,
        // "Make one like this" → Studio with the winning formula pre-seeded (angle), so Mello starts
        // MAKING the ad in that format/hook/offer immediately. (It used to drop the founder on the plain
        // Following feed, which read as "why am I on a list?" — the label promises an ad, not a browse.)
        cta_label: 'Make one like this', cta_href: '/studio',
        playbook: {
          totalAds: pbAds.length, brandsCount: brandSet.size, videoPct: vidPct,
          formats: rank(fmtM, 4), hooks: rank(hookM, 4), emotions: rank(emoM, 5), offers: rank(offerM, 5),
          judgment,
        },
      })
    }
  }

  const gTop = tally(globalAds).filter(([t]) => !top.length || t !== top[0][0]).slice(0, 1)
  const learning: BriefItem | null = gTop.length ? {
    kind: 'learning', importance: 30,
    title: `Today's lesson: study “${gTop[0][0]}”.`,
    body: `${gTop[0][1]} of the freshest ads market-wide use this angle right now. Read five of them and you'll see the pattern — then you own it.`,
    cta_label: 'Open the examples', cta_href: `/discovery?q=${encodeURIComponent(gTop[0][0])}`,
  } : null

  for (const o of observations) {
    items.push({
      kind: 'insight', importance: 55, at: o.created_at,
      title: o.observation,
      why: o.action || undefined,
      // "Act on this" hands the insight's action to Mello (prefills the brief composer via ?ask=) so the
      // founder can actually act on it — instead of the old hardcoded /discovery, which dumped every
      // insight on the All Ads page regardless of what it said.
      ...(o.action ? { cta_label: 'Act on this', cta_href: `/brief?ask=${encodeURIComponent(o.action)}` } : {}),
    })
  }

  // AI-authored documents Mello has written (competitor teardowns, niche reports). Surfaced LIVE —
  // not queued as a next-day brief_event — so a report the user just triggered (or the one generated
  // during onboarding) shows the moment they land on the brief. High importance so it reads as the
  // flagship it is. Brand-scoped when a brand is selected. Fail-soft.
  {
    let dq = admin.from('mello_documents')
      .select('id, kind, title, subject, subject_brand_id, model, meta, created_at')
      .eq('user_id', userId).gte('created_at', D7)
      .order('created_at', { ascending: false }).limit(3)
    if (opts.brandId) dq = dq.eq('subject_brand_id', opts.brandId)
    const docs = await soft<any[]>(dq.then((r: any) => r.data || []) as any, [])
    const kindLabel: Record<string, string> = {
      competitor_report: 'Competitor intelligence', niche_report: 'Niche teardown', strategy_memo: 'Strategy memo',
    }
    ;(docs as any[]).forEach((d: any, di: number) => {
      // Show the competitor's real ad thumbnails inline on the brief card (from the report's swipe file).
      const swipe: any[] = Array.isArray((d.meta as any)?.swipe) ? (d.meta as any).swipe : []
      const media = swipe.filter((s) => s?.image || s?.videoUrl).slice(0, 4)
        .map((s) => ({ image: s.image || null, videoUrl: s.videoUrl || null, adId: s.adId ? String(s.adId) : undefined }))
      // The NEWEST report leads the Today column (90 — above competitor-launch alerts at ≤85, below a
      // ready-to-approve creative at 100) so the flagship the user just triggered is impossible to miss.
      // Older reports sit lower (76) so a stack of them doesn't crowd out fresh competitor intel.
      items.push({
        id: `doc-${d.id}`, kind: 'document', importance: di === 0 ? 90 : 76, at: d.created_at,
        title: `${d.subject ? `${d.subject} — ` : ''}${kindLabel[d.kind] || 'Document'}`,
        body: d.title,
        why: 'A full strategy document Mello wrote for you — grounded in real ad data.',
        cta_label: 'Read the full report', cta_href: `/documents/${d.id}`,
        ...(media.length ? { media } : {}),
      })
    })
  }

  items.sort((a, b) => b.importance - a.importance)
  // The cross-competitor Playbook is a full-width card, not a ranked Today item — keep it out of the
  // top-6 competition so it always survives (it would otherwise lose the slice to a low launch alert).
  const playbookItem = items.find((i) => i.kind === 'market_playbook') || null
  // The Facebook Ads audit card (real ROAS/spend) is the founder's money — pull it out too so it always
  // survives the slice, and it goes FIRST (before ranked items): for a connected account it leads the brief.
  const metaItem = items.find((i) => i.kind === 'meta_ads') || null
  const rankedItems = items.filter((i) => i.kind !== 'market_playbook' && i.kind !== 'meta_ads')

  // When Mello last actually did something — the newest real artifact across the spine, the alerts
  // and the creatives. Powers the "last worked 2h ago" presence line: proof of labor, never faked.
  const stamps = [
    ...(spine || []).map((e: any) => e.created_at),
    ...(notifs || []).map((n: any) => n.created_at),
    ...(creatives || []).map((c: any) => c.created_at),
  ].filter(Boolean).sort()
  const lastCycleAt = stamps.length ? stamps[stamps.length - 1] : null

  return {
    summary: {
      adsScanned,
      // "Competitors tracked" = SPIED brands only (matches Brand Spy + "Watching N"); plain ❤️ follows
      // are not competitors being tracked, so they must not inflate the count.
      brandsWatched: scopedFollows.filter((f: any) => f.spied).length,
      spiedBrands: scopedFollows.filter((f: any) => f.spied).length,
      creativesReady: creatives.length,
    },
    lastCycleAt,
    firstName: firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : null,
    headline,
    items: [...(metaItem ? [metaItem] : []), ...rankedItems.slice(0, 6), ...(playbookItem ? [playbookItem] : [])],
    learning,
    quiet: items.length === 0 && !headline,
  }
}
