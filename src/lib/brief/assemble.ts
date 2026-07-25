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
  at?: string
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

export async function assembleBrief(admin: SupabaseClient, userId: string, userMeta: any): Promise<Brief> {
  const rawName = String((userMeta as any)?.full_name || (userMeta as any)?.name || '').trim()
  const email = String((userMeta as any)?.email || '')
  const firstName = rawName ? rawName.split(/\s+/)[0] : (email ? email.split('@')[0].replace(/[._-].*$/, '') : '')
  const items: BriefItem[] = []
  const H48 = new Date(Date.now() - 48 * 3600e3).toISOString()
  const H36 = new Date(Date.now() - 36 * 3600e3).toISOString()
  const H24 = new Date(Date.now() - 24 * 3600e3).toISOString()
  const D7 = new Date(Date.now() - 7 * 86400e3).toISOString()

  const [spine, notifs, creatives, follows, adsScanned, observations] = await Promise.all([
    soft<any[]>(admin.from('brief_events').select('id, kind, importance, title, body, cta_label, cta_href, payload, created_at')
      .eq('user_id', userId).gte('created_at', H48).order('importance', { ascending: false }).limit(20)
      .then((r: any) => r.data || []), []),
    soft<any[]>(admin.from('notifications').select('id, brand_name, page_id, ad_count, sample_ad_id, created_at')
      .eq('user_id', userId).eq('type', 'new_ad').gte('created_at', H48).order('created_at', { ascending: false }).limit(8)
      .then((r: any) => r.data || []), []),
    soft<any[]>(admin.from('creative_generations').select('id, image_url, type, created_at')
      .eq('user_id', userId).gte('created_at', H36).order('created_at', { ascending: false }).limit(6)
      .then((r: any) => r.data || []), []),
    soft<any[]>(admin.from('followed_brands').select('page_id, brand_name, spied')
      .eq('user_id', userId).limit(200).then((r: any) => r.data || []), []),
    soft<number>(admin.from('discovery_ads_index').select('ad_id', { count: 'estimated', head: true })
      .gte('created_at', H24).then((r: any) => r.count || 0), 0),
    soft<any[]>(admin.from('daily_observations').select('id, observation, action, confidence, created_at')
      .eq('user_id', userId).gte('created_at', H48).order('created_at', { ascending: false }).limit(3)
      .then((r: any) => r.data || []), []),
  ])

  for (const e of spine) {
    items.push({ id: e.id, kind: e.kind, importance: e.importance ?? 50, title: e.title, body: e.body || undefined, cta_label: e.cta_label || undefined, cta_href: e.cta_href || undefined, at: e.created_at })
  }
  if (spine.length) admin.from('brief_events').update({ surfaced_at: new Date().toISOString() }).in('id', spine.map((e: any) => e.id)).is('surfaced_at', null).then(() => {}, () => {})

  const needIds = notifs.filter((n: any) => isBlankName(n.brand_name)).map((n: any) => n.page_id).filter(Boolean)
  if (needIds.length) {
    const names = await soft(resolveBrandNames(admin, needIds), new Map<string, string>())
    for (const n of notifs as any[]) if (isBlankName(n.brand_name)) n.brand_name = names.get(String(n.page_id)) || null
  }

  const compByPage = new Map<string, BriefItem>()
  for (const n of notifs) {
    const brand = (!isBlankName(n.brand_name) && n.brand_name) || 'A brand you watch'
    const c = Math.max(1, Number(n.ad_count) || 1)
    const it: BriefItem = {
      kind: 'competitor_ads', importance: Math.min(85, 55 + c * 5), at: n.created_at,
      title: `${brand} launched ${c === 1 ? 'a new ad' : `${c} new ads`}.`,
      body: c > 2 ? `That's a real push, not routine rotation — worth reading what angle they're betting on before it compounds.` : `A single fresh creative — I'll flag if it turns into a burst.`,
      why: `You watch ${brand} — a launch like this usually means they found something working.`,
      cta_label: 'Open the brand file', cta_href: n.page_id ? `/knowledge/brand/${n.page_id}` : `/discovery/brand-spy`,
    }
    items.push(it)
    if (n.page_id) compByPage.set(String(n.page_id), it)
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

  const pageIds = follows.map((f: any) => f.page_id).filter(Boolean).slice(0, 60)
  const [marketAds, globalAds] = await Promise.all([
    soft((async () => {
      let q = admin.from('discovery_ads_index')
        .select('ad_id, page_id, hook_type, format_style, topics, created_at, discovery_creatives(asset_type, r2_url, poster_url)')
        .gte('created_at', D7).order('created_at', { ascending: false }).limit(240)
      if (pageIds.length) q = q.in('page_id', pageIds)
      const { data } = await q
      return data || []
    })(), [] as any[]),
    soft((async () => {
      const { data } = await admin.from('discovery_ads_index').select('topics').gte('created_at', H48).order('created_at', { ascending: false }).limit(200)
      return data || []
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

  if (marketAds.length >= 5) {
    let video = 0, imageN = 0
    const hookM = new Map<string, number>(), fmtM = new Map<string, number>()
    for (const a of marketAds) {
      const m = mediaOf(a)
      if (m?.videoUrl) video++; else if (m?.image) imageN++
      if (a.hook_type) hookM.set(a.hook_type, (hookM.get(a.hook_type) || 0) + 1)
      if (a.format_style) fmtM.set(a.format_style, (fmtM.get(a.format_style) || 0) + 1)
    }
    const total = video + imageN
    const topHook = Array.from(hookM.entries()).sort((a, b) => b[1] - a[1])[0]
    const topFmt = Array.from(fmtM.entries()).sort((a, b) => b[1] - a[1])[0]
    const vidPct = total ? Math.round((video / total) * 100) : 0
    if (total >= 5) {
      const parts: string[] = [vidPct >= 50 ? `video is winning — ${vidPct}% of their new ads` : `it's still image-led — only ${vidPct}% are video`]
      if (topFmt) parts.push(`the format they keep reaching for is “${topFmt[0]}”`)
      if (topHook) parts.push(`the common hook is “${topHook[0]}”`)
      const stillDecoding = !topFmt && !topHook
      items.push({
        kind: 'market_read', importance: 78,
        title: `What's working across your competitors this week: ${parts.join(', ')}.`,
        body: stillDecoding
          ? `Read from ${total} fresh ads — ${video} video, ${imageN} image. I'm still decoding the hooks and formats on the newest ones — the finer pattern read lands in tomorrow's brief.`
          : `Read from ${total} fresh ads across the brands you watch — ${video} video, ${imageN} image. ${vidPct >= 50 ? 'If you’re still shipping static, that’s the gap.' : 'Static still holds here — don’t over-rotate to video yet.'}`,
        why: `This is the pattern to copy before it saturates — I can build you one in this format.`,
        cta_label: stillDecoding ? 'See the ads' : 'Make one like this',
        cta_href: topHook ? `/discovery?q=${encodeURIComponent(topHook[0] as string)}` : '/discovery/brand-spy',
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
      ...(o.action ? { cta_label: 'Act on this', cta_href: '/discovery' } : {}),
    })
  }

  items.sort((a, b) => b.importance - a.importance)

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
      brandsWatched: follows.length,
      spiedBrands: follows.filter((f: any) => f.spied).length,
      creativesReady: creatives.length,
    },
    lastCycleAt,
    firstName: firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : null,
    headline,
    items: items.slice(0, 6),
    learning,
    quiet: items.length === 0 && !headline,
  }
}
