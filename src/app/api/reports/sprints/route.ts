/**
 * GET /api/reports/sprints?template=<key>&dateRange=last_90d&groupBy=<dim>&metric=roas&increment=weekly
 *
 * The Sprints (time-series) engine. Where /generate returns ONE aggregated row per group over the whole
 * period, Sprints breaks the period into time buckets (weekly/daily/monthly) and returns each group's
 * metric AS A SERIES over time — so you can see momentum: which creatives are scaling, plateauing, or
 * fatiguing. Reuses the exact metric math from the shared engine lib.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { TEMPLATE_BY_KEY, METRICS, type GroupByKey, type MetricKey, type ReportTemplate } from '@/lib/reports/templates'
import { isTagDimension } from '@/lib/reports/tagging'
import { timeRange, num, emptyRow, accInsight, metricValue, inferFormat, type Row } from '@/lib/reports/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const V = process.env.META_API_VERSION || 'v20.0'

// Meta time_increment: number of days per bucket (or "monthly"). Sprints defaults to weekly.
const INCREMENTS: Record<string, string> = { daily: '1', weekly: '7', monthly: 'monthly' }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const tpl: ReportTemplate | undefined = TEMPLATE_BY_KEY[sp.get('template') || 'top_performers']
  if (!tpl) return NextResponse.json({ error: 'Unknown report template' }, { status: 400 })
  const dateRange = sp.get('dateRange') || 'last_90d'
  // AI-tag groupings need the tagging pass; keep Sprints lean and fall back to creative-level.
  let groupBy = (sp.get('groupBy') as GroupByKey) || tpl.groupBy
  if (isTagDimension(groupBy)) groupBy = 'creative'
  const metric = (sp.get('metric') as MetricKey) || tpl.sort
  const increment = INCREMENTS[sp.get('increment') || 'weekly'] || '7'
  const topN = Math.min(24, Math.max(4, Number(sp.get('limit')) || 12))

  const admin = createAdminClient()
  let metaAccount: any
  try { metaAccount = await resolveScopedAccount(admin, user.id) } catch { metaAccount = null }
  if (!metaAccount?.account_id) return NextResponse.json({ error: 'no_account', series: [] }, { status: 200 })
  const token = decryptToken(metaAccount.access_token)
  const currency = metaAccount.currency || 'USD'
  const act = `act_${metaAccount.account_id}`
  const { since, until } = timeRange(dateRange)
  const tr = encodeURIComponent(JSON.stringify({ since, until }))

  try {
    // 1) Time-bucketed ad-level insights. time_increment splits each ad into per-bucket rows carrying
    // date_start. Follow paging a few pages so long ranges with many ads aren't silently truncated.
    const insFields = [
      'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'date_start',
      'spend', 'impressions', 'reach', 'frequency', 'clicks',
      'actions', 'action_values',
      'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
      'video_p75_watched_actions', 'video_p100_watched_actions', 'video_play_actions', 'video_avg_time_watched_actions',
    ].join(',')
    const attrWin = `&action_attribution_windows=${encodeURIComponent(JSON.stringify(['1d_view', '1d_click', '7d_click', '28d_click']))}`
    let url: string | null = `https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${tr}&time_increment=${increment}${attrWin}&limit=500&access_token=${token}`
    const insights: any[] = []
    for (let page = 0; page < 8 && url; page++) {
      const j: any = await fetch(url).then(r => r.json())
      if (j.error) throw new Error(j.error.message)
      insights.push(...(j.data || []))
      url = j.paging?.next || null
      if (insights.length > 12000) break
    }

    // 2) Ad objects — thumbnail + format + name (single cheap pass, no poster re-fetch).
    const adMeta = new Map<string, any>()
    const adRes = await fetch(`https://graph.facebook.com/${V}/${act}/ads?fields=id,name,effective_status,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=500&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES","CAMPAIGN_PAUSED","ADSET_PAUSED"]&access_token=${token}`).then(r => r.json()).catch(() => ({}))
    for (const a of (adRes.data || [])) {
      const cr = a.creative || {}, spec = cr.object_story_spec, afs = cr.asset_feed_spec
      const thumbnail = cr.thumbnail_url || cr.image_url || spec?.video_data?.image_url || spec?.link_data?.picture
        || spec?.link_data?.child_attachments?.[0]?.picture || afs?.images?.[0]?.url || afs?.videos?.[0]?.thumbnail_url || null
      adMeta.set(a.id, { thumbnail, format: inferFormat(cr), landingPage: spec?.link_data?.link || null })
    }

    const keyOf = (ins: any, meta: any): { key: string; name: string } => {
      switch (groupBy) {
        case 'ad': return { key: ins.ad_id, name: ins.ad_name || ins.ad_id }
        case 'adset': return { key: ins.adset_id, name: ins.adset_name || ins.adset_id }
        case 'campaign': return { key: ins.campaign_id, name: ins.campaign_name || ins.campaign_id }
        case 'landing_page': return { key: meta?.landingPage || '—', name: meta?.landingPage || 'No landing page' }
        case 'format': return { key: meta?.format || 'other', name: (meta?.format || 'other').replace(/^\w/, (c: string) => c.toUpperCase()) }
        case 'creative': default: return { key: (meta?.thumbnail || ins.ad_id), name: ins.ad_name || ins.ad_id }
      }
    }
    const mkRow = (key: string, name: string, meta: any): Row =>
      ({ key, name, thumbnail: meta?.thumbnail || null, format: meta?.format || 'other', landingPage: meta?.landingPage || null, launchDate: null, status: 'paused', adCount: 0, adId: '', ...emptyRow() })

    // 3) Accumulate per (group → bucketDate) and a per-bucket all-groups total (for the overall line).
    type G = { key: string; name: string; thumbnail: string | null; format: string; total: Row; buckets: Map<string, Row> }
    const groups = new Map<string, G>()
    const bucketSet = new Set<string>()
    const allByBucket = new Map<string, Row>()
    for (const ins of insights) {
      const meta = adMeta.get(ins.ad_id) || {}
      if (tpl.onlyFormat === 'video' && meta.format !== 'video') continue
      if (tpl.onlyFormat === 'image' && !(meta.format === 'image' || meta.format === 'carousel')) continue
      const date = ins.date_start
      if (!date) continue
      bucketSet.add(date)
      const { key, name } = keyOf(ins, meta)
      let g = groups.get(key)
      if (!g) { g = { key, name, thumbnail: meta.thumbnail || null, format: meta.format || 'other', total: mkRow(key, name, meta), buckets: new Map() }; groups.set(key, g) }
      let b = g.buckets.get(date); if (!b) { b = mkRow(key, name, meta); g.buckets.set(date, b) }
      accInsight(b, ins); accInsight(g.total, ins)
      let ab = allByBucket.get(date); if (!ab) { ab = mkRow('all', 'All', {}); allByBucket.set(date, ab) }
      accInsight(ab, ins)
    }

    const buckets = Array.from(bucketSet).sort()
    const isCost = !(METRICS[metric]?.goodHigh ?? true)

    // Trend = recent-half vs earlier-half average of the metric across buckets. "Good" direction flips
    // for cost metrics (falling CPA is good). We report the signed % change and whether it's improving.
    const trendOf = (pts: { date: string; value: number }[]): { pct: number; good: boolean | null } => {
      const vals = pts.map(p => p.value)
      const nz = vals.filter(v => v > 0)
      if (nz.length < 2) return { pct: 0, good: null }
      const half = Math.floor(vals.length / 2) || 1
      const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
      const earlier = avg(vals.slice(0, half).filter(v => v > 0))
      const recent = avg(vals.slice(-half).filter(v => v > 0))
      if (!earlier) return { pct: recent ? 100 : 0, good: recent > 0 ? !isCost : null }
      const pct = ((recent - earlier) / earlier) * 100
      if (Math.abs(pct) < 8) return { pct, good: null }        // stable band
      return { pct, good: isCost ? pct < 0 : pct > 0 }
    }

    const series = Array.from(groups.values())
      .map(g => {
        const points = buckets.map(d => ({ date: d, value: g.buckets.has(d) ? metricValue(g.buckets.get(d)!, metric) : 0 }))
        const t = trendOf(points)
        return {
          key: g.key, name: g.name, thumbnail: g.thumbnail, format: g.format,
          totalSpend: g.total.spend, metricTotal: metricValue(g.total, metric),
          points, trendPct: t.pct, trendGood: t.good,
        }
      })
      .filter(s => s.totalSpend > 0)
      .sort((a, b) => b.totalSpend - a.totalSpend)

    const truncated = Math.max(0, series.length - topN)
    const overall = buckets.map(d => ({ date: d, value: allByBucket.has(d) ? metricValue(allByBucket.get(d)!, metric) : 0 }))

    return NextResponse.json({
      template: { key: tpl.key, title: tpl.title, emoji: tpl.emoji },
      groupBy, metric, metricLabel: METRICS[metric]?.label || metric, metricFormat: METRICS[metric]?.format || 'number',
      increment: sp.get('increment') || 'weekly', dateRange, currency,
      buckets, overall, series: series.slice(0, topN), truncated, count: series.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build sprint', series: [] }, { status: 200 })
  }
}
