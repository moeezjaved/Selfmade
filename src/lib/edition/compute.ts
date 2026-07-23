/**
 * THE EDITION · compute — "the market wrote it; Mello curated it."
 * Assembles today's edition from data the pipeline already maintains
 * (discovery_ads_index + discovery_creatives + brand_directory). No LLM calls, no
 * fabricated numbers: every line is a count or a delta the reader could verify by
 * opening the linked query in the /discovery library.
 *
 * THE MUSEUM: every surfaced object also carries a media[] array so Discover can be
 * hung as an exhibit — the ads ARE the interface. Media is the same creatives join
 * the knowledge pages already use; attaching it adds a handful of bounded queries
 * that run at most once per ISR window.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { COLLECTIONS, hookHref, formatHref } from '@/lib/knowledge/taxonomy'

// Edition № — days since the first edition. Deterministic, no table needed.
const EPOCH_UTC = Date.UTC(2025, 6, 1) // 2025-07-01
export const editionNumber = (d = new Date()) => Math.max(1, Math.floor((d.getTime() - EPOCH_UTC) / 86400000))

export type Media = { img: string; video?: string }
export type Mover = {
  kind: 'HOOK' | 'FORMAT' | 'BRAND'
  name: string
  href: string
  dir: 'up' | 'down'
  why: string
  prev: number
  now: number
  pid?: string
  media: Media[]
}
export type CollectionVol = { name: string; sub: string; href: string; covers: string[] }
export type Edition = {
  no: number
  dateLabel: string
  adsRead: number
  brandsTouched: number
  windowLabel: string
  movers: Mover[]
  lead: Mover | null
  leadBody: string
  collections: CollectionVol[]
  question: { title: string; sub: string; media: Media[] } | null
  contents: { changed: number; collections: number; questions: number }
}

const tally = (rows: any[], key: string) => {
  const m = new Map<string, number>()
  for (const r of rows) { const v = r?.[key]; if (v) m.set(String(v), (m.get(String(v)) || 0) + 1) }
  return m
}
const mediaItem = (a: any): Media | null => {
  const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
  const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
  if (!cre) return null
  const isVid = cre.asset_type === 'video'
  const img = isVid ? cre.poster_url : cre.r2_url
  if (!img) return null
  return isVid ? { img, video: cre.r2_url || undefined } : { img }
}
const coverImg = (a: any): string | null => mediaItem(a)?.img || null
const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export async function computeEdition(): Promise<Edition> {
  const admin = createAdminClient() as any
  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  const D1 = iso(24 * 3600e3), D2 = iso(48 * 3600e3), D7 = iso(7 * 86400e3), D14 = iso(14 * 86400e3), D30 = iso(30 * 86400e3)

  // One bounded fetch covers the arithmetic: 14 days of newly-indexed ads, minimal columns.
  const { data: rows14 } = await admin
    .from('discovery_ads_index')
    .select('ad_id, page_id, page_name, hook_type, format_style, niche, created_at')
    .gte('created_at', D14)
    .order('created_at', { ascending: false })
    .limit(20000)
  const all: any[] = rows14 || []

  const within = (a: any, since: string) => String(a.created_at) >= since
  const rows1 = all.filter((a) => within(a, D1))
  const rows2 = all.filter((a) => within(a, D2))
  const thisWeek = all.filter((a) => within(a, D7))
  const priorWeek = all.filter((a) => !within(a, D7))

  // Honest "read overnight" window: quiet nights widen the claim and SAY so.
  let readRows = rows1, windowLabel = 'overnight'
  if (rows1.length < 40 && rows2.length >= 40) { readRows = rows2; windowLabel = 'in the last two days' }
  else if (rows1.length < 40) { readRows = thisWeek; windowLabel = 'this week' }
  const adsRead = readRows.length
  const brandsTouched = new Set(readRows.map((a) => a.page_id).filter(Boolean)).size

  // ── What changed: hook + format deltas, this week vs the week before ──
  const movers: Mover[] = []
  const pushDeltas = (kind: 'HOOK' | 'FORMAT', key: string, href: (v: string) => string) => {
    const a = tally(thisWeek, key), b = tally(priorWeek, key)
    const names = new Set([...Array.from(a.keys()), ...Array.from(b.keys())])
    for (const name of Array.from(names)) {
      const prev = b.get(name) || 0, cur = a.get(name) || 0
      if (prev + cur < 12) continue
      const delta = cur - prev
      if (Math.abs(delta) < Math.max(4, prev * 0.25)) continue
      movers.push({
        kind, name, href: href(name), dir: delta > 0 ? 'up' : 'down',
        prev, now: cur, media: [],
        why: delta > 0 ? `${prev} last week → ${cur} this week` : `${prev} last week → ${cur} this week — cooling off`,
      })
    }
  }
  pushDeltas('HOOK', 'hook_type', hookHref)
  pushDeltas('FORMAT', 'format_style', formatHref)
  movers.sort((x, y) => Math.abs(y.now - y.prev) - Math.abs(x.now - x.prev))

  // Brand movers: who launched the most in 48h (the "someone's making a move" line)
  const brandTally = Array.from(tally(rows2, 'page_id').entries()).sort((x, y) => y[1] - x[1]).slice(0, 3)
  if (brandTally.length) {
    const ids = brandTally.map(([id]) => id)
    const { data: dirs } = await admin.from('brand_directory').select('page_id, name').in('page_id', ids)
    const nameOf = new Map<string, string>((dirs || []).map((d: any) => [String(d.page_id), d.name]))
    for (const [pid, n] of brandTally) {
      if (n < 3) continue
      let nm = nameOf.get(String(pid))
      if (isBlankName(nm)) nm = rows2.find((r) => String(r.page_id) === String(pid) && !isBlankName(r.page_name))?.page_name
      if (isBlankName(nm)) continue
      movers.push({ kind: 'BRAND', name: String(nm), href: `/knowledge/brand/${pid}`, dir: 'up', prev: 0, now: n, pid: String(pid), media: [], why: `launched ${n} new ads in 48 hours` })
    }
  }

  const conceptMovers = movers.filter((m) => m.kind !== 'BRAND')
  const lead = conceptMovers[0] || movers[0] || null
  const leadBody = lead
    ? lead.kind === 'BRAND'
      ? `${lead.name} ${lead.why} — the fastest launcher on record this week. The ads above are the move, not a chart of it.`
      : lead.dir === 'up'
        ? `${lead.now} new ads this week against ${lead.prev} the week before. These are the creatives driving it — when a ${lead.kind === 'HOOK' ? 'hook' : 'format'} accelerates like this, the brands using it are seeing something.`
        : `Down from ${lead.prev} new ads to ${lead.now} week-over-week. These are the last holdouts — early fatigue, and the brands that leaned on it will rotate next.`
    : ''

  // ── MEDIA: hang every surfaced object with its real creatives ──
  const sel = 'ad_id, discovery_creatives(asset_type, r2_url, poster_url)'
  const mediaFor = async (kind: string, name: string, pid: string | undefined, limit: number): Promise<Media[]> => {
    try {
      let q = admin.from('discovery_ads_index').select(sel)
      if (kind === 'BRAND') q = q.eq('page_id', pid)
      else if (kind === 'HOOK') q = q.eq('hook_type', name).gte('created_at', D14)
      else if (kind === 'FORMAT') q = q.eq('format_style', name).gte('created_at', D14)
      const { data } = await q.order('performance_score', { ascending: false, nullsFirst: false }).limit(limit + 8)
      return (data || []).map(mediaItem).filter(Boolean).slice(0, limit) as Media[]
    } catch { return [] }
  }

  // lead gets a full wall; concept movers get a strip; brand movers get a swarm.
  const mediaJobs: Promise<void>[] = []
  if (lead) mediaJobs.push(mediaFor(lead.kind, lead.name, lead.pid, 12).then((m) => { lead.media = m }))
  for (const m of movers) {
    if (m === lead) continue
    const limit = m.kind === 'BRAND' ? Math.min(Math.max(m.now, 12), 72) : 6
    mediaJobs.push(mediaFor(m.kind, m.name, m.pid, limit).then((r) => { m.media = r }))
  }

  // ── Worth exploring: live auto-collections with real covers ──
  const coverSel = 'ad_id, discovery_creatives(asset_type, r2_url, poster_url)'
  const coverQueries = [
    admin.from('discovery_ads_index').select(coverSel).gte('days_running', 60).order('performance_score', { ascending: false, nullsFirst: false }).limit(8),
    admin.from('discovery_ads_index').select(coverSel).eq('format_style', 'UGC').gte('created_at', D30).order('performance_score', { ascending: false, nullsFirst: false }).limit(8),
    admin.from('discovery_ads_index').select(coverSel).in('hook_type', ['Testimonial', 'Social Proof']).order('performance_score', { ascending: false, nullsFirst: false }).limit(8),
  ]

  // ── One open question, illustrated as a diptych of the two contenders ──
  const topHooks = Array.from(tally(thisWeek, 'hook_type').entries()).sort((x, y) => y[1] - x[1])
  const topNiche = Array.from(tally(thisWeek, 'niche').entries()).sort((x, y) => y[1] - x[1])[0]
  let question: Edition['question'] = null
  const qMediaJobs: Promise<Media | null>[] = []
  if (topHooks.length >= 2) {
    question = {
      title: `Why is ${topHooks[0][0]} out-launching ${topHooks[1][0]}${topNiche ? ` in ${topNiche[0]}` : ''}?`,
      sub: `${topHooks[0][1]} vs ${topHooks[1][1]} new ads this week · ask Mello what it means for your brand`,
      media: [],
    }
    qMediaJobs.push(mediaFor('HOOK', topHooks[0][0], undefined, 1).then((m) => m[0] || null))
    qMediaJobs.push(mediaFor('HOOK', topHooks[1][0], undefined, 1).then((m) => m[0] || null))
  }

  const [, coverRes, qMedia] = await Promise.all([
    Promise.all(mediaJobs),
    Promise.all(coverQueries.map((q: any) => q.then((r: any) => r.data || []).catch(() => []))),
    Promise.all(qMediaJobs),
  ])
  if (question) question.media = qMedia.filter(Boolean) as Media[]

  const collections: CollectionVol[] = []
  COLLECTIONS.forEach((c, i) => {
    const covers = (coverRes[i] || []).map(coverImg).filter(Boolean).slice(0, 5) as string[]
    if (covers.length >= 3) collections.push({ name: c.name, sub: c.sub, href: c.href, covers })
  })

  const shown = Math.min(5, movers.length)
  return {
    no: editionNumber(),
    dateLabel: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    adsRead, brandsTouched, windowLabel,
    movers: movers.slice(0, 6), lead, leadBody,
    collections,
    question: question && question.media.length >= 2 ? question : (question ? { ...question, media: [] } : null),
    contents: { changed: shown, collections: collections.length, questions: question ? 1 : 0 },
  }
}
