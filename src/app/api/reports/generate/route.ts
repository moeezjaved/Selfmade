/**
 * GET /api/reports/generate?template=<key>&dateRange=last_14d&groupBy=<dim>&sort=<metric>&dir=desc
 * The reporting-suite engine. Pulls ad-level insights from the connected Meta account with the FULL
 * field set (spend/impr/reach/frequency/clicks/ctr/cpc/cpm + every action type + video retention),
 * joins creative previews (thumbnail + format + landing page + launch date), groups by the requested
 * dimension, aggregates, sorts, and returns rows + a Net Results total. All computed live (no cache).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { TEMPLATE_BY_KEY, GROUP_BY, METRICS, type GroupByKey, type MetricKey, type ReportTemplate, type ReportFilter, type FilterOp } from '@/lib/reports/templates'
import { ensureTags, loadTagCache, isTagDimension, type TagInput, type CreativeTags } from '@/lib/reports/tagging'
import { timeRange, num, emptyRow, accInsight, metricValue, inferFormat, type Row } from '@/lib/reports/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // first-time AI tagging (vision over top ads) can take ~10-15s
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const sp = req.nextUrl.searchParams
  const tpl: ReportTemplate | undefined = TEMPLATE_BY_KEY[sp.get('template') || 'top_performers']
  if (!tpl) return NextResponse.json({ error: 'Unknown report template' }, { status: 400 })
  const dateRange = sp.get('dateRange') || 'last_14d'
  const groupBy = (sp.get('groupBy') as GroupByKey) || tpl.groupBy
  // Columns: client can override the template's metric list (add/remove). Falls back to the template's.
  const reqMetrics = (sp.get('metrics') || '').split(',').map(s => s.trim()).filter(Boolean) as MetricKey[]
  const isCustomCol = (m: string) => /^(cc|ccv|cpcc)_/.test(m)
  const cols = (reqMetrics.length ? reqMetrics : tpl.metrics).filter(m => !!METRICS[m] || isCustomCol(m as string))
  const sort = (sp.get('sort') as MetricKey) || tpl.sort
  const dir = (sp.get('dir') as 'asc' | 'desc') || tpl.sortDir
  let filters: ReportFilter[] = []
  try { const f = JSON.parse(sp.get('filters') || '[]'); if (Array.isArray(f)) filters = f } catch {}
  const TAG_FIELDS = ['visual_format', 'messaging_theme', 'hook_tactic', 'headline_tactic', 'intended_audience', 'offer_type', 'seasonality']
  const statusFilter = filters.find(f => f.field === 'status')
  const nameFilters = filters.filter(f => ['ad_name', 'campaign_name', 'adset_name'].includes(f.field))   // pre-group (on insights)
  const metricFilters = filters.filter(f => !!METRICS[f.field as MetricKey])
  const rowTextFilters = filters.filter(f => f.field === 'landing_page')
  const dateFilters = filters.filter(f => f.field === 'launch_date')
  const formatFilters = filters.filter(f => f.field === 'format')
  const tagFilters = filters.filter(f => TAG_FIELDS.includes(f.field))
  const passOp = (a: number, op: FilterOp, b: number) =>
    op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a === b
  const passText = (v: string, op: FilterOp, q: string) => {
    const a = (v || '').toLowerCase(), b = (q || '').toLowerCase()
    return op === 'is' ? a === b : op === 'is_not' ? a !== b : a.includes(b)   // contains
  }

  let metaAccount: any
  try { metaAccount = await resolveScopedAccount(admin, user.id) } catch { metaAccount = null }
  if (!metaAccount?.account_id) return NextResponse.json({ error: 'no_account', rows: [], template: tpl }, { status: 200 })
  const token = decryptToken(metaAccount.access_token)
  const currency = metaAccount.currency || 'USD'
  const act = `act_${metaAccount.account_id}`
  const { since, until } = timeRange(dateRange)
  const tr = encodeURIComponent(JSON.stringify({ since, until }))

  try {
    // 1) Ad-level insights — the full metric field set.
    const insFields = [
      'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
      'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm',
      'actions', 'action_values',
      'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
      'video_p75_watched_actions', 'video_p100_watched_actions', 'video_play_actions', 'video_avg_time_watched_actions',
    ].join(',')
    // Request all four attribution windows so actions/action_values carry per-window keys (1d_view/1d_click/7d_click/28d_click).
    const attrWin = `&action_attribution_windows=${encodeURIComponent(JSON.stringify(['1d_view', '1d_click', '7d_click', '28d_click']))}`
    const insRes = await fetch(`https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${tr}${attrWin}&limit=500&access_token=${token}`)
    const insJson = await insRes.json()
    if (insJson.error) throw new Error(insJson.error.message)
    const insights: any[] = insJson.data || []

    // 2) Ad objects — creative preview, format, landing page, launch date. Matched by ad id.
    const adRes = await fetch(`https://graph.facebook.com/${V}/${act}/ads?fields=id,name,created_time,effective_status,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=500&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES","CAMPAIGN_PAUSED","ADSET_PAUSED"]&access_token=${token}`)
    const adJson = await adRes.json().catch(() => ({}))
    const adMeta = new Map<string, any>()
    for (const a of (adJson.data || [])) {
      const cr = a.creative || {}
      const spec = cr.object_story_spec
      const afs = cr.asset_feed_spec
      // thumbnail_url is often null for video/dynamic creatives — fall back through the other image
      // fields Meta exposes so the report card shows a real frame instead of a placeholder.
      const thumbnail = cr.thumbnail_url || cr.image_url
        || spec?.video_data?.image_url || spec?.link_data?.picture
        || spec?.link_data?.child_attachments?.[0]?.picture
        || afs?.images?.[0]?.url || afs?.videos?.[0]?.thumbnail_url || null
      adMeta.set(a.id, {
        thumbnail,
        videoId: cr.video_id || spec?.video_data?.video_id || afs?.videos?.[0]?.video_id || null,
        format: inferFormat(a.creative),
        landingPage: spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || afs?.link_urls?.[0]?.website_url || null,
        launchDate: a.created_time ? String(a.created_time).slice(0, 10) : null,
        primaryText: spec?.link_data?.message || spec?.video_data?.message || afs?.bodies?.[0]?.text || null,
        headline: spec?.link_data?.name || spec?.video_data?.title || afs?.titles?.[0]?.text || null,
        // Normalize Meta's effective_status to active | paused | archived for the status filter.
        status: /ARCHIV/.test(a.effective_status) ? 'archived' : /ACTIVE/.test(a.effective_status) ? 'active' : 'paused',
      })
    }

    // 2a) Posters — Meta's bulk /ads edge is unreliable about creative images. For any ad missing a
    // thumbnail, re-fetch its creative per-ad (batched ?ids=) which returns thumbnail_url/image_url/
    // video_id more reliably; then batch-fetch the video's higher-res `picture`. So cards show a real
    // frame instead of a placeholder. Bounded to the ads actually in the report.
    const missIds = Array.from(adMeta.entries()).filter(([, m]: any) => !m.thumbnail).map(([id]) => id as string).slice(0, 120)
    for (let i = 0; i < missIds.length; i += 50) {
      const chunk = missIds.slice(i, i + 50)
      const res = await fetch(`https://graph.facebook.com/${V}/?ids=${chunk.join(',')}&fields=creative{thumbnail_url,image_url,video_id}&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      for (const id of chunk) {
        const c = res?.[id]?.creative; if (!c) continue
        const m = adMeta.get(id); if (!m) continue
        m.thumbnail = m.thumbnail || c.thumbnail_url || c.image_url || null
        m.videoId = m.videoId || c.video_id || null
      }
    }
    const vidIds = Array.from(new Set(Array.from(adMeta.values()).filter((m: any) => !m.thumbnail && m.videoId).map((m: any) => m.videoId))).slice(0, 120)
    for (let i = 0; i < vidIds.length; i += 50) {
      const chunk = vidIds.slice(i, i + 50)
      const res = await fetch(`https://graph.facebook.com/${V}/?ids=${chunk.join(',')}&fields=picture&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      for (const m of Array.from(adMeta.values())) if (!m.thumbnail && m.videoId && res?.[m.videoId]?.picture) m.thumbnail = res[m.videoId].picture
    }

    // 2c) Account-specific custom conversions → dynamic columns (count + cost-per). We surface every
    // non-archived custom conversion so the user can add it as a column; per-row values fall to 0 when
    // an ad didn't fire it. Keys: cc_<id> (count), cpcc_<id> (cost/conv). Best-effort; never fatal.
    const customMetrics: { key: string; label: string; format: string; goodHigh: boolean }[] = []
    try {
      const ccRes = await fetch(`https://graph.facebook.com/${V}/${act}/customconversions?fields=id,name,is_archived&limit=200&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      for (const c of (ccRes?.data || [])) {
        if (c.is_archived) continue
        const nm = (c.name || `Custom ${c.id}`).slice(0, 40)
        customMetrics.push({ key: `cc_${c.id}`, label: nm, format: 'number', goodHigh: true })
        customMetrics.push({ key: `cpcc_${c.id}`, label: `Cost / ${nm}`, format: 'currency', goodHigh: false })
      }
    } catch {}

    // 2b) AI creative tags. Grouping by an AI dimension, or the "AI tags" toggle (aiTags=1), RUNS the
    // tagging pass (top-spend ads, cached in R2 → once per creative). Otherwise we still LOAD the cache
    // for free so already-tagged creatives show their pills without spending anything.
    let tagMap: Record<string, CreativeTags> = {}
    let tagRemaining = 0
    const wantTags = isTagDimension(groupBy) || sp.get('aiTags') === '1' || tagFilters.length > 0
    if (wantTags) {
      const spendById = new Map<string, number>()
      for (const ins of insights) spendById.set(ins.ad_id, (spendById.get(ins.ad_id) || 0) + num(ins.spend))
      const tagInputs: TagInput[] = Array.from(spendById.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => {
          const m = adMeta.get(id) || {}
          const ins = insights.find(x => x.ad_id === id)
          return { id, name: ins?.ad_name, primaryText: m.primaryText, headline: m.headline, thumbnail: m.thumbnail, format: m.format }
        })
      const r = await ensureTags(metaAccount.account_id, tagInputs, 30)
      tagMap = r.tags; tagRemaining = r.remaining
    } else {
      tagMap = await loadTagCache(metaAccount.account_id)
    }

    // 3) Build + group rows.
    const groups = new Map<string, Row>()
    const keyOf = (ins: any, meta: any): { key: string; name: string } => {
      if (isTagDimension(groupBy)) {
        const t = tagMap[ins.ad_id]?.[groupBy] || 'Untagged'
        return { key: t, name: t }
      }
      switch (groupBy) {
        case 'ad': return { key: ins.ad_id, name: ins.ad_name || ins.ad_id }
        case 'adset': return { key: ins.adset_id, name: ins.adset_name || ins.adset_id }
        case 'campaign': return { key: ins.campaign_id, name: ins.campaign_name || ins.campaign_id }
        case 'landing_page': return { key: meta?.landingPage || '—', name: meta?.landingPage || 'No landing page' }
        case 'format': return { key: meta?.format || 'other', name: (meta?.format || 'other').replace(/^\w/, (c: string) => c.toUpperCase()) }
        case 'launch_date': return { key: meta?.launchDate || '—', name: meta?.launchDate || 'Unknown' }
        case 'creative': default: return { key: (meta?.thumbnail || ins.ad_id), name: ins.ad_name || ins.ad_id }
      }
    }

    for (const ins of insights) {
      const meta = adMeta.get(ins.ad_id) || {}
      // Format filter (video-only / image-only templates).
      if (tpl.onlyFormat === 'video' && meta.format !== 'video') continue
      if (tpl.onlyFormat === 'image' && !(meta.format === 'image' || meta.format === 'carousel')) continue
      // Ad-status filter (per-ad, applied before grouping).
      if (statusFilter) { const match = (meta.status || 'paused') === statusFilter.value; if (statusFilter.op === 'is_not' ? match : !match) continue }
      // Name filters (ad/campaign/ad set) — applied per-ad before grouping.
      if (nameFilters.length) {
        const val: Record<string, string> = { ad_name: ins.ad_name || '', campaign_name: ins.campaign_name || '', adset_name: ins.adset_name || '' }
        if (!nameFilters.every(f => passText(val[f.field], f.op, String(f.value)))) continue
      }
      const { key, name } = keyOf(ins, meta)
      let row = groups.get(key)
      if (!row) {
        row = { key, name, thumbnail: meta.thumbnail || null, format: meta.format || 'other', landingPage: meta.landingPage || null, launchDate: meta.launchDate || null, status: meta.status || 'paused', adCount: 0, adId: ins.ad_id, ...emptyRow() }
        groups.set(key, row)
      }
      accInsight(row, ins)
    }

    // Comparative: fetch the previous equal-length period and compute per-group prev metrics for deltas.
    let prevByKey: Record<string, Row> | null = null
    if (tpl.key === 'comparative' || sp.get('compare') === '1') {
      const [sy, sm, sd] = since.split('-').map(Number), [uy, um, ud] = until.split('-').map(Number)
      const len = Math.max(1, Math.round((Date.UTC(uy, um - 1, ud) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1)
      const pUntil = new Date(Date.UTC(sy, sm - 1, sd) - 86400000)
      const pSince = new Date(pUntil.getTime() - (len - 1) * 86400000)
      const isoU = (d: Date) => d.toISOString().slice(0, 10)
      const ptr = encodeURIComponent(JSON.stringify({ since: isoU(pSince), until: isoU(pUntil) }))
      const prevRes = await fetch(`https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${ptr}${attrWin}&limit=500&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      const pg = new Map<string, Row>()
      for (const ins of (prevRes?.data || [])) {
        const meta = adMeta.get(ins.ad_id) || {}
        const { key, name } = keyOf(ins, meta)
        let row = pg.get(key)
        if (!row) { row = { key, name, thumbnail: null, format: 'other', landingPage: null, launchDate: null, status: 'paused', adCount: 0, adId: ins.ad_id, ...emptyRow() }; pg.set(key, row) }
        accInsight(row, ins)
      }
      prevByKey = Object.fromEntries(pg)
    }

    // 3b) Global attribution window. Default = Meta's account-configured window (the `value` sums
    // accInsight already collected). If the user picks a specific click+view combo, re-derive the core
    // purchase count + revenue from the per-window keys so ROAS/CPA/AOV recompute against that window.
    const attribution = sp.get('attribution') || ''   // "<click>:<view>" e.g. "7d_click:1d_view"; "" = default
    if (attribution && attribution !== 'default') {
      const [click, viewW] = attribution.split(':')
      const pField: Record<string, keyof Row> = { '1d_click': 'p_1dc', '7d_click': 'p_7dc', '28d_click': 'p_28dc', '1d_view': 'p_1dv' }
      const rField: Record<string, keyof Row> = { '1d_click': 'rev_1dc', '7d_click': 'rev_7dc', '28d_click': 'rev_28dc', '1d_view': 'rev_1dv' }
      const applyAttr = (r: Row) => {
        const cP = click && click !== 'none' ? (r[pField[click]] as number || 0) : 0
        const vP = viewW && viewW !== 'none' ? (r[pField[viewW]] as number || 0) : 0
        const cR = click && click !== 'none' ? (r[rField[click]] as number || 0) : 0
        const vR = viewW && viewW !== 'none' ? (r[rField[viewW]] as number || 0) : 0
        r.conversions = cP + vP; r.revenue = cR + vR
      }
      for (const r of Array.from(groups.values())) applyAttr(r)
      if (prevByKey) for (const k of Object.keys(prevByKey)) applyAttr(prevByKey[k])
    }

    // 4) Shape + sort. "Scalers" = above-median ROAS but below-median spend (ready to scale).
    let rows = Array.from(groups.values())
    if (tpl.key === 'scalers' && rows.length > 3) {
      const spends = rows.map(r => r.spend).sort((a, b) => a - b)
      const medSpend = spends[Math.floor(spends.length / 2)]
      rows = rows.filter(r => metricValue(r, 'roas') >= 1 && r.spend <= medSpend && r.conversions > 0)
    }
    // Filters on grouped rows — Net Results below reflects the filtered set.
    for (const f of metricFilters) rows = rows.filter(r => passOp(metricValue(r, f.field as MetricKey), f.op, Number(f.value)))
    for (const f of rowTextFilters) rows = rows.filter(r => passText(r.landingPage || '', f.op, String(f.value)))
    for (const f of formatFilters) rows = rows.filter(r => f.op === 'is_not' ? r.format !== f.value : r.format === f.value)
    for (const f of dateFilters) rows = rows.filter(r => { if (!r.launchDate) return false; return f.op === 'before' ? r.launchDate < String(f.value) : r.launchDate > String(f.value) })
    for (const f of tagFilters) rows = rows.filter(r => { const t = tagMap[r.adId]?.[f.field as keyof CreativeTags]; return f.op === 'is_not' ? t !== f.value : t === f.value })
    // Proprietary 0–100 composite scores — percentile-rank each row's funnel-stage rate within THIS
    // report (transparent, self-contained: no external benchmark). Hook/Watch gauge video attention and
    // rank among video rows only; Click/Convert rank across all spending rows. Overall = weighted blend.
    const scored = rows.filter(r => r.spend > 0)
    const percentiler = (getVal: (r: Row) => number, pool: Row[]) => {
      const vals = pool.map(getVal).filter(v => v > 0).sort((a, b) => a - b)
      return (r: Row) => {
        const v = getVal(r)
        if (v <= 0 || vals.length === 0) return 0
        let c = 0; for (const x of vals) { if (x <= v) c++; else break }
        return Math.round((c / vals.length) * 100)
      }
    }
    const vids = scored.filter(r => r.format === 'video')
    const hookP = percentiler(r => r.impressions ? r.video_3s / r.impressions : 0, vids)
    const watchP = percentiler(r => r.impressions ? r.thruplay / r.impressions : 0, vids)
    const clickP = percentiler(r => r.impressions ? r.link_click / r.impressions : 0, scored)
    const convP = percentiler(r => r.link_click ? r.conversions / r.link_click : 0, scored)
    const scoreByKey = new Map<string, Record<string, number>>()
    for (const r of scored) {
      const hook = r.format === 'video' ? hookP(r) : 0
      const watch = r.format === 'video' ? watchP(r) : 0
      const click = clickP(r), convert = convP(r)
      const overall = r.format === 'video'
        ? Math.round(0.25 * hook + 0.20 * watch + 0.25 * click + 0.30 * convert)
        : Math.round(0.45 * click + 0.55 * convert)
      scoreByKey.set(r.key, { hook_score: hook, watch_score: watch, click_score: click, convert_score: convert, overall_score: overall })
    }

    // Pills make sense on creative-level rows (each row = one creative/ad). For aggregate groupings a
    // single creative's tags would misrepresent the group, so only attach there.
    const attachTags = groupBy === 'creative' || groupBy === 'ad'
    const shaped = rows.map(r => {
      const m: Record<string, number> = {}
      for (const k of cols) m[k] = metricValue(r, k)
      m[sort] = metricValue(r, sort)
      // Overlay composite scores (percentile ranks can't be computed per-row inside metricValue).
      const sc = scoreByKey.get(r.key)
      if (sc) { for (const k of cols) if (k in sc) m[k] = sc[k]; if (sort in sc) m[sort] = sc[sort] }
      // Comparative: previous-period value + % delta per column. Scores are cohort-relative (no
      // stable prev-period meaning), so we skip deltas for them.
      let delta: Record<string, number> | undefined
      if (prevByKey) {
        const pr = prevByKey[r.key]
        delta = {}
        for (const k of cols) { if (sc && k in sc) continue; const cur = m[k], prev = pr ? metricValue(pr, k) : 0; delta[k] = prev ? ((cur - prev) / prev) * 100 : (cur ? 100 : 0) }
      }
      return {
        key: r.key, name: r.name, thumbnail: r.thumbnail, format: r.format, adId: r.adId,
        landingPage: r.landingPage, launchDate: r.launchDate, status: r.status, adCount: r.adCount, metrics: m, delta,
        tags: attachTags ? (tagMap[r.adId] || null) : null,
      }
    }).filter(r => r.metrics.spend > 0)
    shaped.sort((a, b) => dir === 'desc' ? (b.metrics[sort] || 0) - (a.metrics[sort] || 0) : (a.metrics[sort] || 0) - (b.metrics[sort] || 0))

    // 5) Net Results — column totals (sums for volume metrics, averages for rate metrics).
    const net: Record<string, number> = {}
    for (const k of cols) {
      const f = METRICS[k]?.format || (String(k).startsWith('cpcc_') ? 'currency' : 'number')
      if (f === 'percent' || f === 'ratio' || f === 'seconds' || f === 'score' || k === 'cpm' || k === 'cpc' || k === 'cpa' || String(k).startsWith('cpcc_')) {
        const vals = shaped.map(r => r.metrics[k]).filter(v => v > 0)
        net[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
      } else {
        net[k] = shaped.reduce((s, r) => s + (r.metrics[k] || 0), 0)
      }
    }

    return NextResponse.json({
      template: { key: tpl.key, title: tpl.title, emoji: tpl.emoji, description: tpl.description },
      groupBy, groupByOptions: GROUP_BY, sort, dir, dateRange, currency,
      metrics: tpl.metrics, rows: shaped, netResults: net, count: shaped.length,
      tagRemaining, aiGrouped: isTagDimension(groupBy), customMetrics,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build report', rows: [] }, { status: 200 })
  }
}
