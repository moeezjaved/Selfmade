/**
 * GET /api/leaderboard?spendThreshold=0
 *
 * Week-over-week creative leaderboard. Compares this week (last 7 days) against the previous 7 days,
 * per creative, and produces:
 *  - Performance-shift buckets: Scaling / Declining / Newly launched / Recently paused (spend-driven,
 *    gated on a spend threshold so low-spend tests don't clutter the shifts).
 *  - A ranked leaderboard (by this-week spend) with rank-movement (new ★ vs held →), weeks on board,
 *    and colored Spend + ROAS week-over-week deltas (ROAS delta is independent of the bucket).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount, resolveBrandScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { cacheGet, cacheSet } from '@/lib/meta/cache'
import { num, emptyRow, accInsight, metricValue, inferFormat, type Row } from '@/lib/reports/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const V = process.env.META_API_VERSION || 'v20.0'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const pct = (cur: number, prev: number): number | null => prev > 0 ? ((cur - prev) / prev) * 100 : null

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const spendThreshold = Number(sp.get('spendThreshold') || 0)
  const admin = createAdminClient()
  // Scope to the ACTIVE BRAND (Aura → ROY 1), like the report/brief — an explicit ?account= wins.
  const lbAcct = sp.get('account')
  let metaAccount: any
  // STRICT brand scope: a brand with no linked account gets the no_account empty state, never another
  // brand's primary (kept the leaderboard on the previous brand after a switch).
  try { metaAccount = lbAcct ? await resolveScopedAccount(admin, user.id, lbAcct.replace(/^act_/, '')) : await resolveBrandScopedAccount(admin, user.id, null, { strict: true }) } catch { metaAccount = null }
  if (!metaAccount?.account_id) return NextResponse.json({ error: 'no_account', shifts: null, leaderboard: [] }, { status: 200 })
  const token = decryptToken(metaAccount.access_token)
  const currency = metaAccount.currency || 'USD'
  const act = `act_${metaAccount.account_id}`

  // Cache like every other Meta surface (reports/audit) — the page refetches on mount + every threshold
  // tweak, which without this hammered Graph and surfaced Meta's raw "Application request limit reached".
  const cacheKey = `leaderboard:${user.id}:${metaAccount.account_id}:${spendThreshold}`
  const lastKey = `leaderboard:last:${user.id}:${metaAccount.account_id}`
  const hit = cacheGet(cacheKey)
  if (hit) return NextResponse.json(hit)

  // This week = last 7 days; previous week = the 7 days before that.
  const now = new Date()
  const curRange = { since: iso(new Date(now.getTime() - 7 * 86400000)), until: iso(now) }
  const prevRange = { since: iso(new Date(now.getTime() - 14 * 86400000)), until: iso(new Date(now.getTime() - 8 * 86400000)) }

  try {
    const insFields = ['ad_id', 'ad_name', 'spend', 'impressions', 'clicks', 'actions', 'action_values'].join(',')
    const fetchWindow = async (r: { since: string; until: string }) => {
      const tr = encodeURIComponent(JSON.stringify(r))
      let url: string | null = `https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${tr}&limit=500&access_token=${token}`
      const out: any[] = []
      for (let p = 0; p < 6 && url; p++) { const j: any = await fetch(url).then(x => x.json()); if (j.error) throw new Error(j.error.message); out.push(...(j.data || [])); url = j.paging?.next || null }
      return out
    }
    const [curIns, prevIns] = await Promise.all([fetchWindow(curRange), fetchWindow(prevRange)])

    // Ad creative meta (thumbnail, name, launch date, status, format).
    const adMeta = new Map<string, any>()
    let adUrl: string | null = `https://graph.facebook.com/${V}/${act}/ads?fields=id,name,created_time,effective_status,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=400&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES","CAMPAIGN_PAUSED","ADSET_PAUSED"]&access_token=${token}`
    for (let p = 0; p < 6 && adUrl; p++) {
      const j: any = await fetch(adUrl).then(x => x.json())
      if (j.error) break
      for (const a of (j.data || [])) {
        const cr = a.creative || {}, spec = cr.object_story_spec, afs = cr.asset_feed_spec
        const thumbnail = cr.thumbnail_url || cr.image_url || spec?.video_data?.image_url || spec?.link_data?.picture
          || spec?.link_data?.child_attachments?.[0]?.picture || afs?.images?.[0]?.url || afs?.videos?.[0]?.thumbnail_url || null
        adMeta.set(a.id, {
          name: a.name, thumbnail, format: inferFormat(cr),
          launchDate: a.created_time ? String(a.created_time).slice(0, 10) : null,
          status: /ARCHIV/.test(a.effective_status) ? 'archived' : /ACTIVE/.test(a.effective_status) ? 'active' : 'paused',
        })
      }
      adUrl = j.paging?.next || null
    }

    // Group both windows by creative key (thumbnail or ad id — one row per creative).
    const keyOf = (adId: string) => { const m = adMeta.get(adId); return (m?.thumbnail || adId) as string }
    const build = (rows: any[]) => {
      const g = new Map<string, Row & { adIds: Set<string> }>()
      for (const insv of rows) {
        const k = keyOf(insv.ad_id), meta = adMeta.get(insv.ad_id) || {}
        let row: any = g.get(k)
        if (!row) { row = { key: k, name: meta.name || insv.ad_name || insv.ad_id, thumbnail: meta.thumbnail || null, format: meta.format || 'other', landingPage: null, launchDate: meta.launchDate || null, status: meta.status || 'paused', adCount: 0, adId: insv.ad_id, adIds: new Set(), ...emptyRow() }; g.set(k, row) }
        row.adIds.add(insv.ad_id)
        accInsight(row, insv)
      }
      return g
    }
    const cur = build(curIns), prev = build(prevIns)

    const weeksOnBoard = (launchDate: string | null): number => {
      if (!launchDate) return 1
      const days = Math.floor((now.getTime() - new Date(launchDate).getTime()) / 86400000)
      return Math.max(1, Math.ceil((days + 1) / 7))
    }
    const card = (k: string, r: any) => {
      const p = prev.get(k)
      const spend = r.spend, roas = metricValue(r, 'roas')
      const pSpend = p?.spend || 0, pRoas = p ? metricValue(p, 'roas') : 0
      return {
        key: k, name: r.name, thumbnail: r.thumbnail, format: r.format, adCount: r.adIds.size,
        status: r.status, launchDate: r.launchDate, weeksOnBoard: weeksOnBoard(r.launchDate),
        spend, roas, spendDelta: pct(spend, pSpend), roasDelta: pct(roas, pRoas), hadPrev: pSpend > 0,
      }
    }

    // Shift buckets — one bucket per creative, priority: paused → newly → scaling/declining.
    const scaling: any[] = [], declining: any[] = [], newly: any[] = [], paused: any[] = []
    for (const [k, r] of Array.from(cur.entries())) {
      const c = card(k, r)
      const launchedRecently = c.launchDate ? (now.getTime() - new Date(c.launchDate).getTime()) / 86400000 <= 14 : false
      const spendUp = c.spendDelta !== null && c.spendDelta >= 10
      const spendDown = c.spendDelta !== null && c.spendDelta <= -10
      if ((c.status === 'paused' || c.status === 'archived') && c.hadPrev) paused.push(c)
      else if (!c.hadPrev && launchedRecently && c.spend > 0) newly.push(c)
      else if (c.status === 'active' && c.spend >= spendThreshold && spendUp) scaling.push(c)
      else if (c.hadPrev && (prev.get(k)?.spend || 0) >= spendThreshold && spendDown) declining.push(c)
    }
    // Creatives that spent last week but not this week, and are now off → also "recently paused".
    for (const [k, p] of Array.from(prev.entries())) {
      if (cur.has(k)) continue
      const meta = adMeta.get((p as any).adId) || {}
      if ((meta.status === 'paused' || meta.status === 'archived') && p.spend > 0) {
        paused.push({ key: k, name: p.name, thumbnail: p.thumbnail, format: (p as any).format, adCount: (p as any).adIds.size, status: meta.status, launchDate: p.launchDate, weeksOnBoard: weeksOnBoard(p.launchDate), spend: 0, roas: 0, spendDelta: null, roasDelta: null, hadPrev: true })
      }
    }
    scaling.sort((a, b) => (b.spendDelta || 0) - (a.spendDelta || 0))
    declining.sort((a, b) => (a.spendDelta || 0) - (b.spendDelta || 0))
    newly.sort((a, b) => b.spend - a.spend)
    paused.sort((a, b) => b.spend - a.spend)

    // Leaderboard — rank by this-week spend; rank-movement vs previous-week spend rank.
    const prevRank = new Map<string, number>()
    Array.from(prev.entries()).filter(([, p]) => p.spend > 0).sort((a, b) => b[1].spend - a[1].spend).forEach(([k], i) => prevRank.set(k, i + 1))
    const leaderboard = Array.from(cur.entries())
      .map(([k, r]) => card(k, r))
      .filter(c => c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .map((c, i) => {
        const rank = i + 1, pr = prevRank.get(c.key)
        // Movement: new (no prior rank), or up/down/held by the change in rank position.
        const movement = pr === undefined ? 'new' : rank < pr ? 'up' : rank > pr ? 'down' : 'held'
        const moved = pr === undefined ? 0 : Math.abs(pr - rank)
        return { ...c, rank, movement, moved }
      })

    const payload = {
      currency, spendThreshold, updatedAt: now.toISOString(),
      shifts: {
        scaling, declining, newly, paused,
        counts: { scaling: scaling.length, declining: declining.length, newly: newly.length, paused: paused.length },
      },
      leaderboard,
    }
    cacheSet(cacheKey, payload, 8 * 60 * 1000)          // fresh window — collapses back-to-back refetches
    cacheSet(lastKey, payload, 6 * 60 * 60 * 1000)      // last-known-good — served if Meta rate-limits us later
    return NextResponse.json(payload)
  } catch (e: any) {
    const msg = String(e?.message || '')
    const rateLimited = /request limit|rate limit|too many|reduce the amount|#17\b|#4\b|#32\b|#613\b/i.test(msg)
    const last = cacheGet(lastKey) as any
    // On a Meta rate-limit, serve the last good board with a soft notice instead of a scary raw error.
    if (rateLimited && last) return NextResponse.json({ ...last, stale: true, notice: 'Meta is rate-limiting us right now — showing your last update. Try again in a few minutes.' })
    if (rateLimited) return NextResponse.json({ error: 'Meta is rate-limiting us right now — try again in a few minutes.', shifts: null, leaderboard: [] }, { status: 200 })
    return NextResponse.json({ error: e?.message || 'Failed to build leaderboard', shifts: null, leaderboard: [] }, { status: 200 })
  }
}
