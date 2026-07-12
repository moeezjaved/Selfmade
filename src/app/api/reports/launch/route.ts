/**
 * GET /api/reports/launch?launchRange=last_30d&perfRange=maximum&goalRoas=1&goalSpend=139000&groupBy=creative
 *
 * The Launch-tracking (Sprints) engine — Motion's "New Launches". Tracks ads by their LAUNCH date
 * (created_time) within a launch window, measures each over a SEPARATE performance window (default
 * lifetime), scores them against a Goal (ROAS + spend thresholds), and buckets them into launch-week
 * cohorts. Returns a funnel: Launched → Scaled (hit spend goal) → Winners (scaled AND hit ROAS goal).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { TEMPLATE_BY_KEY, METRICS, type GroupByKey, type MetricKey, type ReportTemplate } from '@/lib/reports/templates'
import { timeRange, num, emptyRow, accInsight, metricValue, inferFormat, type Row } from '@/lib/reports/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const V = process.env.META_API_VERSION || 'v20.0'

// Monday-of-week for a YYYY-MM-DD date, returned as a {start,end,label} cohort key.
function weekOf(dateStr: string): { key: string; label: string } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = (dt.getUTCDay() + 6) % 7   // 0 = Monday
  const start = new Date(dt.getTime() - dow * 86400000)
  const end = new Date(start.getTime() + 6 * 86400000)
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  const label = start.getUTCMonth() === end.getUTCMonth()
    ? `${MO[start.getUTCMonth()]} ${start.getUTCDate()} – ${end.getUTCDate()}`
    : `${MO[start.getUTCMonth()]} ${start.getUTCDate()} – ${MO[end.getUTCMonth()]} ${end.getUTCDate()}`
  return { key: iso(start), label }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const tpl: ReportTemplate | undefined = TEMPLATE_BY_KEY[sp.get('template') || 'new_launches']
  const launchRange = sp.get('launchRange') || 'last_30d'
  const perfRange = sp.get('perfRange') || 'maximum'   // 'maximum' = lifetime, else a date preset
  const groupBy = (sp.get('groupBy') as GroupByKey) || 'creative'
  const goalRoas = Number(sp.get('goalRoas') || 1)
  const goalSpend = Number(sp.get('goalSpend') || 0)
  const reqMetrics = (sp.get('metrics') || '').split(',').map(s => s.trim()).filter(Boolean) as MetricKey[]
  const isCustomCol = (m: string) => /^(cc|ccv|cpcc)_/.test(m)
  const extraCols = reqMetrics.filter(m => (!!METRICS[m] || isCustomCol(m)) && !['roas', 'spend'].includes(m))

  const admin = createAdminClient()
  let metaAccount: any
  try { metaAccount = await resolveScopedAccount(admin, user.id) } catch { metaAccount = null }
  if (!metaAccount?.account_id) return NextResponse.json({ error: 'no_account', cohorts: [] }, { status: 200 })
  const token = decryptToken(metaAccount.access_token)
  const currency = metaAccount.currency || 'USD'
  const act = `act_${metaAccount.account_id}`
  const { since: lSince, until: lUntil } = timeRange(launchRange)

  try {
    // 1) Ads launched in the launch window (created_time), with creative preview.
    const adMeta = new Map<string, any>()
    let adUrl: string | null = `https://graph.facebook.com/${V}/${act}/ads?fields=id,name,created_time,effective_status,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=400&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES","CAMPAIGN_PAUSED","ADSET_PAUSED"]&access_token=${token}`
    for (let page = 0; page < 6 && adUrl; page++) {
      const j: any = await fetch(adUrl).then(r => r.json())
      if (j.error) throw new Error(j.error.message)
      for (const a of (j.data || [])) {
        const launchDate = a.created_time ? String(a.created_time).slice(0, 10) : null
        if (!launchDate || launchDate < lSince || launchDate > lUntil) continue   // launched-in-window only
        const cr = a.creative || {}, spec = cr.object_story_spec, afs = cr.asset_feed_spec
        const thumbnail = cr.thumbnail_url || cr.image_url || spec?.video_data?.image_url || spec?.link_data?.picture
          || spec?.link_data?.child_attachments?.[0]?.picture || afs?.images?.[0]?.url || afs?.videos?.[0]?.thumbnail_url || null
        adMeta.set(a.id, {
          name: a.name, launchDate, thumbnail, videoId: cr.video_id || null, format: inferFormat(cr),
          status: /ARCHIV/.test(a.effective_status) ? 'archived' : /ACTIVE/.test(a.effective_status) ? 'active' : 'paused',
        })
      }
      adUrl = j.paging?.next || null
    }
    if (!adMeta.size) return NextResponse.json({ template: tplMeta(tpl), cohorts: [], funnel: { launched: 0, scaled: 0, winners: 0 }, goal: { roas: goalRoas, spend: goalSpend }, currency, launchRange, perfRange, count: 0 })

    // 2) Performance for those ads over the perf window (lifetime by default).
    const insFields = ['ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'actions', 'action_values',
      'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions', 'video_play_actions', 'video_avg_time_watched_actions'].join(',')
    const attrWin = `&action_attribution_windows=${encodeURIComponent(JSON.stringify(['1d_view', '1d_click', '7d_click', '28d_click']))}`
    const window = perfRange === 'maximum'
      ? `&date_preset=maximum`
      : `&time_range=${encodeURIComponent(JSON.stringify(timeRange(perfRange)))}`
    let insUrl: string | null = `https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}${window}${attrWin}&limit=500&access_token=${token}`
    const insByAd = new Map<string, any>()
    for (let page = 0; page < 8 && insUrl; page++) {
      const j: any = await fetch(insUrl).then(r => r.json())
      if (j.error) throw new Error(j.error.message)
      for (const ins of (j.data || [])) if (adMeta.has(ins.ad_id)) insByAd.set(ins.ad_id, ins)
      insUrl = j.paging?.next || null
    }

    // 3) Build one Row per launched ad, accumulating its performance.
    const rows: (Row & { achievements: string[] })[] = []
    for (const [adId, meta] of Array.from(adMeta.entries())) {
      const row: any = { key: adId, name: meta.name || adId, thumbnail: meta.thumbnail, format: meta.format, landingPage: null, launchDate: meta.launchDate, status: meta.status, adCount: 0, adId, ...emptyRow() }
      const ins = insByAd.get(adId)
      if (ins) accInsight(row, ins)
      const spend = row.spend, roas = metricValue(row, 'roas')
      const scaled = goalSpend > 0 ? spend >= goalSpend : spend > 0
      const winner = scaled && roas >= goalRoas
      row.achievements = [scaled && 'Scaled', winner && 'Winner'].filter(Boolean) as string[]
      rows.push(row)
    }

    // 4) Funnel + launch-week cohorts.
    const launched = rows.length
    const scaledCount = rows.filter(r => (r as any).achievements.includes('Scaled')).length
    const winnersCount = rows.filter(r => (r as any).achievements.includes('Winner')).length

    const cohortMap = new Map<string, { key: string; label: string; rows: any[] }>()
    for (const r of rows) {
      const w = weekOf(r.launchDate || lSince)
      let c = cohortMap.get(w.key); if (!c) { c = { key: w.key, label: w.label, rows: [] }; cohortMap.set(w.key, c) }
      c.rows.push(shapeRow(r, extraCols, currency))
    }
    const cohorts = Array.from(cohortMap.values())
      .sort((a, b) => b.key.localeCompare(a.key))   // newest cohort first
      .map(c => ({ ...c, rows: c.rows.sort((a, b) => b.spend - a.spend) }))

    return NextResponse.json({
      template: tplMeta(tpl), currency, launchRange, perfRange, groupBy,
      goal: { roas: goalRoas, spend: goalSpend },
      funnel: { launched, scaled: scaledCount, winners: winnersCount },
      cohorts, count: launched, extraCols,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build launch report', cohorts: [] }, { status: 200 })
  }
}

function tplMeta(tpl?: ReportTemplate) {
  return { key: tpl?.key || 'new_launches', title: tpl?.title || 'New Launches', emoji: tpl?.emoji || '🚀' }
}

// Shape a launch Row into the client payload: identity + spend/roas + achievements + any extra metrics.
function shapeRow(r: any, extraCols: MetricKey[], currency: string) {
  const metrics: Record<string, number> = { spend: r.spend, roas: metricValue(r, 'roas') }
  for (const m of extraCols) metrics[m] = metricValue(r, m)
  return { key: r.key, name: r.name, thumbnail: r.thumbnail, format: r.format, adId: r.adId, status: r.status, launchDate: r.launchDate, achievements: r.achievements, spend: r.spend, metrics }
}
