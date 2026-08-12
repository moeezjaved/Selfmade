/**
 * The proactive signals engine — "the company teaches Selfmade by operating."
 *
 * Nightly, WITHOUT any founder input, this reads what the company already produced and turns raw
 * evidence into Brain conclusions + Brief insights:
 *   · customer_signals   → topic TRENDS  ("shipping questions up 3.1× this week")
 *   · discovery crawl    → competitor LAUNCH SPIKES ("NovaMane launched 17 creatives in 72h")
 *   · campaign_insights  → marketing LEARNINGS ("'UGC founder story' leads the account at 4.1x vs 2.0x")
 *
 * Detectors are PURE + DETERMINISTIC (unit-tested, no LLM → no hallucinated numbers). Conclusions land
 * in the existing layers — brain_context (the auto-expiring "Now" layer Mello reasons over), learnings
 * (durable, department-scoped), brief_events (the 8AM brief) — never a new memory system. Every insight
 * carries its evidence counts so it's traceable back to the raw rows.
 */
import { recordContext, recordLearning } from '@/lib/brain'

// ── pure detectors (unit-tested in scripts/mello-tests.ts) ───────────────────

export type TopicTrend = { topic: string; current: number; prior: number; ratio: number }

/** Week-over-week topic surge in customer conversations. Fires when a topic has ≥5 mentions this week
 *  AND ≥2× the prior week (a brand-new topic with prior=0 counts as ratio=current). */
export function detectTopicTrends(rows: { topic: string; created_at: string }[], now = Date.now()): TopicTrend[] {
  const wk = 7 * 86400000
  const cur: Record<string, number> = {}, pri: Record<string, number> = {}
  for (const r of rows) {
    const t = String(r.topic || '').trim(); if (!t) continue
    const age = now - new Date(r.created_at).getTime()
    if (age < 0) continue
    if (age <= wk) cur[t] = (cur[t] || 0) + 1
    else if (age <= 2 * wk) pri[t] = (pri[t] || 0) + 1
  }
  const out: TopicTrend[] = []
  for (const [topic, current] of Object.entries(cur)) {
    const prior = pri[topic] || 0
    if (current < 5) continue
    const ratio = prior === 0 ? current : current / prior
    if (ratio >= 2) out.push({ topic, current, prior, ratio: +ratio.toFixed(1) })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}

export type LaunchSpike = { pageId: string; current: number; prior: number }

/** A watched competitor suddenly shipping creatives: ≥8 new ads in the last 72h AND ≥2× the prior 72h. */
export function detectLaunchSpikes(rows: { page_id: string; first_seen_at: string }[], now = Date.now()): LaunchSpike[] {
  const win = 72 * 3600000
  const cur: Record<string, number> = {}, pri: Record<string, number> = {}
  for (const r of rows) {
    const age = now - new Date(r.first_seen_at).getTime()
    if (age < 0) continue
    const p = String(r.page_id)
    if (age <= win) cur[p] = (cur[p] || 0) + 1
    else if (age <= 2 * win) pri[p] = (pri[p] || 0) + 1
  }
  const out: LaunchSpike[] = []
  for (const [pageId, current] of Object.entries(cur)) {
    const prior = pri[pageId] || 0
    if (current >= 8 && current >= prior * 2) out.push({ pageId, current, prior })
  }
  return out.sort((a, b) => b.current - a.current)
}

export type CampaignPerf = { name: string; spend: number; value: number }
export type TopPerformer = { name: string; roas: number; avgRoas: number }

/** The account's standout campaign: ≥1.5× the account-average ROAS with real spend behind it. */
export function detectTopPerformer(rows: CampaignPerf[], minSpend = 100): TopPerformer | null {
  const real = rows.filter((r) => r.spend >= minSpend)
  if (real.length < 2) return null
  const totSpend = real.reduce((s, r) => s + r.spend, 0)
  const totValue = real.reduce((s, r) => s + r.value, 0)
  if (totSpend <= 0) return null
  const avg = totValue / totSpend
  if (avg <= 0) return null
  const best = real.map((r) => ({ name: r.name, roas: r.value / r.spend })).sort((a, b) => b.roas - a.roas)[0]
  if (!best || best.roas < avg * 1.5) return null
  return { name: best.name, roas: +best.roas.toFixed(2), avgRoas: +avg.toFixed(2) }
}

// ── orchestrator: evidence → conclusions, per user ───────────────────────────

const soft = async <T,>(p: Promise<T>, f: T): Promise<T> => { try { return await p } catch { return f } }

/** Insert a brief insight once per (user, kind, title, day) — reruns must not double the brief. */
async function insightOnce(admin: any, userId: string, brandId: string | null, title: string, body: string): Promise<boolean> {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
  const { data: dupe } = await soft(admin.from('brief_events').select('id').eq('user_id', userId).eq('kind', 'insight').eq('title', title).gte('created_at', dayStart.toISOString()).limit(1), { data: [] } as any)
  if (dupe && dupe.length) return false
  await soft(admin.from('brief_events').insert({ user_id: userId, brand_id: brandId, kind: 'insight', importance: 72, title, body }), null as any)
  return true
}

export async function runBrainSignals(admin: any, userId: string): Promise<{ trends: number; spikes: number; learnings: number }> {
  const out = { trends: 0, spikes: 0, learnings: 0 }
  const H14D = new Date(Date.now() - 14 * 86400000).toISOString()
  const H6D = new Date(Date.now() - 6 * 86400000).toISOString()

  // Watched competitors (for spikes + naming), grouped by brand.
  const follows = await soft<any[]>(admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', userId).limit(200).then((r: any) => r.data || []), [])
  const nameByPage = new Map<string, string>(follows.map((f: any) => [String(f.page_id), f.brand_name || 'A competitor']))
  const brandByPage = new Map<string, string | null>(follows.map((f: any) => [String(f.page_id), f.brand_id || null]))

  // 1 · CUSTOMER TREND — topic surge across the last two weeks of extracted customer signals.
  const signals = await soft<any[]>(admin.from('customer_signals').select('topic, created_at, brand_id').eq('user_id', userId).gte('created_at', H14D).limit(2000).then((r: any) => r.data || []), [])
  for (const brandId of Array.from(new Set(signals.map((s: any) => s.brand_id || null)))) {
    const trends = detectTopicTrends(signals.filter((s: any) => (s.brand_id || null) === brandId))
    for (const t of trends.slice(0, 2)) {
      const title = `Customers are suddenly talking about ${t.topic.replace(/_/g, ' ')}`
      const body = t.prior === 0
        ? `${t.current} customers raised “${t.topic.replace(/_/g, ' ')}” this week — it wasn't coming up before. Worth a look before it grows.`
        : `“${t.topic.replace(/_/g, ' ')}” came up ${t.current} times this week vs ${t.prior} last week (${t.ratio}×). Worth addressing in your ads or product page.`
      if (await insightOnce(admin, userId, brandId as any, title, body)) {
        out.trends++
        await recordContext(admin, { userId, brandId: brandId as any, kind: 'customer_trend', body: `${t.topic}: ${t.current} mentions this week (${t.ratio}× last week)`, expiresDays: 7, ref: { evidence: 'customer_signals', current: t.current, prior: t.prior } })
      }
    }
  }

  // 2 · COMPETITOR SPIKE — a watched rival shipping creatives unusually fast (from the crawl).
  const pageIds = follows.map((f: any) => String(f.page_id)).filter(Boolean)
  if (pageIds.length) {
    const fresh = await soft<any[]>(admin.from('discovery_ads_index').select('page_id, first_seen_at').in('page_id', pageIds).gte('first_seen_at', H6D).limit(4000).then((r: any) => r.data || []), [])
    for (const s of detectLaunchSpikes(fresh).slice(0, 3)) {
      const who = nameByPage.get(s.pageId) || 'A competitor'
      const title = `${who} is launching fast — ${s.current} new ads in 72h`
      const body = s.prior > 0
        ? `${who} shipped ${s.current} new creatives in the last 72 hours (vs ${s.prior} in the 72h before). They're testing something — want me to pull the batch and find the angle?`
        : `${who} shipped ${s.current} new creatives in the last 72 hours after a quiet stretch. They're testing something — want me to pull the batch and find the angle?`
      if (await insightOnce(admin, userId, brandByPage.get(s.pageId) ?? null, title, body)) {
        out.spikes++
        await recordContext(admin, { userId, brandId: brandByPage.get(s.pageId) ?? null, kind: 'competitor_spike', body: `${who} launched ${s.current} ads in 72h`, expiresDays: 5, ref: { evidence: 'discovery_ads_index', pageId: s.pageId, current: s.current, prior: s.prior } })
      }
    }
  }

  // 3 · MARKETING LEARNING — the standout campaign from SYNCED Meta numbers (deterministic, no LLM).
  // campaign_insights.campaign_id references campaigns.id (UUID), value column is conversion_value.
  const camps = await soft<any[]>(admin.from('campaigns').select('id, name').eq('user_id', userId).limit(500).then((r: any) => r.data || []), [])
  if (camps.length) {
    const nameById = new Map<string, string>(camps.map((c: any) => [String(c.id), c.name || 'campaign']))
    const insights = await soft<any[]>(admin.from('campaign_insights').select('campaign_id, spend, conversion_value').in('campaign_id', camps.map((c: any) => c.id)).gte('date_start', H14D.slice(0, 10)).limit(2000).then((r: any) => r.data || []), [])
    const byCamp: Record<string, CampaignPerf> = {}
    for (const i of insights) {
      const id = String(i.campaign_id)
      if (!nameById.has(id)) continue   // only THIS user's campaigns
      byCamp[id] ||= { name: nameById.get(id)!, spend: 0, value: 0 }
      byCamp[id].spend += Number(i.spend || 0)
      byCamp[id].value += Number(i.conversion_value || 0)
    }
    const top = detectTopPerformer(Object.values(byCamp))
    if (top) {
      // Durable, dedup'd weekly: one "what's working" learning per standout, not one per night.
      const { data: dupe } = await soft(admin.from('learnings').select('id').eq('user_id', userId).eq('department', 'media').ilike('event', `%${top.name.slice(0, 60)}%`).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(1), { data: [] } as any)
      if (!dupe || !dupe.length) {
        await recordLearning(admin, { userId, department: 'media', event: `“${top.name}” is the account's standout`, result: `${top.roas}x ROAS vs ${top.avgRoas}x account average (last 14 days, synced Meta data)`, metric: { roas: top.roas, avgRoas: top.avgRoas }, confidence: 80, source: 'auto' })
        out.learnings++
      }
    }
  }

  return out
}
