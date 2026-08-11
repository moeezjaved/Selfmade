/**
 * The Meta audit — the first "skill" of the Company Brain architecture (docs/architecture-company-brain.md).
 *
 * Contract: SYNC the user's slice of the Brain (campaigns + campaign_insights via Graph), GRADE it
 * (the M4 method: graduate / catchy-not-converting / pause), then DEPOSIT the judgment where Mello
 * speaks — a brief_events row (tomorrow's Morning Brief headline) and a one-click mello_tasks
 * suggestion for the single most valuable action (approve = the Start button; execution is
 * capability-gated in tasks/run). Runs on connect (instant read-back) and nightly via cron.
 *
 * Everything here is Brain-first: grading reads the SYNCED tables, not live Graph — Mello reasons
 * from memory; the API is only for refreshing it.
 */
import { M4_CONFIG } from '@/lib/m4/config'
import { decryptToken } from '@/lib/meta/client'
import { cacheGet, cacheSet } from '@/lib/meta/cache'

const V = process.env.META_API_VERSION || 'v20.0'
const G = `https://graph.facebook.com/${V}`

/**
 * Resolve the ONE primary account, DETERMINISTICALLY. The bug this kills: when more than one row is
 * flagged is_primary (data drift from re-connects), `accounts.find(is_primary)` returned different
 * accounts to the nightly audit vs the live refresh — so the brief card flipped between a small EUR
 * account (€86) and a big USD one ($687k) on the same "primary" label. A total sort (is_primary, then
 * most-recently-synced, then account_id) makes every code path pick the SAME account every time.
 */
export function resolvePrimary(accounts: any[]): any {
  return [...accounts].sort((a, b) =>
    (Number(!!b.is_primary) - Number(!!a.is_primary)) ||
    String(b.last_synced_at || '').localeCompare(String(a.last_synced_at || '')) ||
    String(a.account_id || '').localeCompare(String(b.account_id || ''))
  )[0]
}
const sameAcct = (a?: string, b?: string) => String(a || '').replace(/^act_/, '') === String(b || '').replace(/^act_/, '')

type Graded = { campaignId: string; metaCampaignId: string; name: string; grade: 'graduate' | 'catchy' | 'pause' | 'hold'; spend: number; roas: number; ctr: number; conversions: number; impressions: number; clicks: number; dailyBudget: number | null; active?: boolean }
export type AuditResult = {
  total: number; spend: number; avgRoas: number
  scale: Graded[]; watch: Graded[]; pause: Graded[]
}

async function graph(path: string, token: string) {
  const r = await fetch(`${G}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(30000) })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(j.error.message || 'Meta API error')
  return j
}

/** Sync one meta_account's campaigns + last-14d insights into the Brain tables. Idempotent upserts. */
async function syncAccount(admin: any, account: any) {
  const token = decryptToken(account.access_token)
  const actId = `act_${account.account_id}`
  const camps = (await graph(`${actId}/campaigns?fields=id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time&limit=100`, token)).data || []
  for (const c of camps) {
    const { data: saved } = await admin.from('campaigns').upsert({
      user_id: account.user_id, meta_account_id: account.id, meta_campaign_id: c.id,
      name: c.name, objective: c.objective, status: c.status,
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      start_time: c.start_time || null, stop_time: c.stop_time || null,
    }, { onConflict: 'meta_account_id,meta_campaign_id' }).select('id').single()
    if (!saved) continue
    // Last 14 days, one row per campaign (date-ranged upsert keyed on campaign+range).
    try {
      const ins = (await graph(`${c.id}/insights?fields=spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,purchase_roas,reach&date_preset=last_14d`, token)).data?.[0]
      if (ins) {
        const conv = (ins.actions || []).filter((a: any) => /purchase|complete_registration|lead/.test(a.action_type)).reduce((s: number, a: any) => s + Number(a.value || 0), 0)
        const convValue = (ins.action_values || []).filter((a: any) => /purchase/.test(a.action_type)).reduce((s: number, a: any) => s + Number(a.value || 0), 0)
        const spend = Number(ins.spend || 0)
        await admin.from('campaign_insights').upsert({
          campaign_id: saved.id,
          date_start: ins.date_start, date_stop: ins.date_stop,
          spend, impressions: Number(ins.impressions || 0), clicks: Number(ins.clicks || 0),
          ctr: Number(ins.ctr || 0), cpm: Number(ins.cpm || 0), cpc: Number(ins.cpc || 0),
          conversions: Math.round(conv), conversion_value: convValue,
          roas: spend > 0 ? convValue / spend : 0, cpa: conv > 0 ? spend / conv : 0,
          reach: Number(ins.reach || 0),
        }, { onConflict: 'campaign_id,date_start,date_stop' })
      }
    } catch { /* one campaign's insights failing shouldn't kill the sync */ }
  }
  await admin.from('meta_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', account.id)
  return camps.length
}

/** Grade synced campaigns with the M4 method against the account's own averages. */
function grade(campaigns: any[]): AuditResult {
  const withIns = campaigns.filter((c) => c.campaign_insights?.length)
  const latest = (c: any) => c.campaign_insights.slice().sort((a: any, b: any) => (b.date_stop || '').localeCompare(a.date_stop || ''))[0]
  const rows = withIns.map((c) => ({ c, i: latest(c) }))
  const totSpend = rows.reduce((s, r) => s + Number(r.i.spend || 0), 0)
  const avgSpend = rows.length ? totSpend / rows.length : 0
  const totValue = rows.reduce((s, r) => s + Number(r.i.conversion_value || 0), 0)
  const avgRoas = totSpend > 0 ? totValue / totSpend : 0
  const totClicks = rows.reduce((s, r) => s + Number(r.i.clicks || 0), 0)
  const totImpr = rows.reduce((s, r) => s + Number(r.i.impressions || 0), 0)
  const avgCtr = totImpr > 0 ? (totClicks / totImpr) * 100 : 0
  const g = M4_CONFIG.grading
  const isActive = (c: any) => String(c.status || '').toUpperCase() === 'ACTIVE'
  const graded: Graded[] = rows.map(({ c, i }) => {
    const roas = Number(i.roas || 0), spend = Number(i.spend || 0), ctr = Number(i.ctr || 0), conv = Number(i.conversions || 0)
    let tier: Graded['grade'] = 'hold'
    if (avgRoas > 0 && roas >= avgRoas * g.graduate.roas_above_avg_pct && spend >= avgSpend * g.graduate.min_spend_pct && conv >= g.graduate.min_conversions) tier = 'graduate'
    else if ((ctr >= avgCtr * g.catchy_not_converting.ctr_above_avg_multiplier || spend >= avgSpend * g.catchy_not_converting.spend_above_avg_multiplier) && (avgRoas === 0 || roas < avgRoas * g.catchy_not_converting.roas_below_avg_pct)) tier = 'catchy'
    else if (spend < avgSpend * g.pause_poor.spend_below_avg_pct && (avgRoas === 0 || roas < avgRoas * g.pause_poor.roas_below_avg_pct)) tier = 'pause'
    return { campaignId: c.id, metaCampaignId: c.meta_campaign_id, name: c.name, grade: tier, spend, roas, ctr, conversions: conv, impressions: Number(i.impressions || 0), clicks: Number(i.clicks || 0), dailyBudget: c.daily_budget != null ? Number(c.daily_budget) : null, active: isActive(c) }
  })
  // The Scale / Watch / Pause buckets ONLY show currently-DELIVERING campaigns — you can't scale, watch,
  // or pause one that's already off. This kills the "Mello says pause an ad that's already paused" bug.
  const live = graded.filter((x) => x.active)
  return {
    total: rows.length, spend: Math.round(totSpend), avgRoas: +avgRoas.toFixed(2),
    scale: live.filter((x) => x.grade === 'graduate').sort((a, b) => b.roas - a.roas),
    watch: live.filter((x) => x.grade === 'catchy').sort((a, b) => b.spend - a.spend),
    pause: live.filter((x) => x.grade === 'pause').sort((a, b) => b.spend - a.spend),
  }
}

/** The full skill run: sync (optional) → grade → deposit into the Brief + task suggestions. */
export async function runMetaAudit(admin: any, userId: string, opts: { syncFirst?: boolean } = {}): Promise<AuditResult | null> {
  const { data: accounts } = await admin.from('meta_accounts').select('*').eq('user_id', userId).eq('status', 'active')
  if (!accounts?.length) return null

  if (opts.syncFirst !== false) {
    let anyTokenError = false
    for (const a of accounts) {
      try { await syncAccount(admin, a) } catch (e: any) {
        // A dead token must SURFACE, not rot silently: mark + tell the founder in the brief.
        if (/expired|invalid|OAuth/i.test(String(e?.message))) {
          anyTokenError = true
          await admin.from('meta_accounts').update({ status: 'error' }).eq('id', a.id)
        }
      }
    }
    // Keep exactly ONE health card in sync with reality: clear any existing "Meta lost access" card,
    // then re-post only if a token is CURRENTLY dead. Without this the card rotted forever after the
    // account was reconnected (the founder kept seeing "Meta lost access" on a healthy account).
    await admin.from('brief_events').delete().eq('user_id', userId).eq('kind', 'meta_health').then(() => {}, () => {})
    if (anyTokenError) {
      await admin.from('brief_events').insert({
        user_id: userId, kind: 'meta_health', importance: 90,
        title: 'Meta lost access to your ad account.',
        body: 'The token expired or was revoked — reconnect in a minute and I pick right back up.',
        cta_label: 'Reconnect Meta', cta_href: '/connect/meta',
      }).then(() => {}, () => {})
    }
  }

  // SCOPE TO THE PRIMARY ACCOUNT. Summing spend across accounts in different currencies (EUR+HKD+PKR+
  // USD) produced a meaningless mega-number in the brief. The brief card shows ONE account — the
  // primary, same one Reports defaults to — so the figures match and the currency is real.
  const primary = resolvePrimary(accounts)
  const cur = primary?.currency || 'USD'
  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()} ${cur}` } }

  const { data: campaigns } = await admin.from('campaigns')
    .select('id,name,meta_campaign_id,status,daily_budget,campaign_insights(*)')
    .eq('user_id', userId).eq('meta_account_id', primary.id)
  if (!campaigns?.length) return null
  const audit = grade(campaigns)
  if (!audit.total) return null

  // ── Deposit: the Morning Brief headline (one per day, replace today's prior audit). ──
  const today = new Date().toISOString().slice(0, 10)
  const parts: string[] = []
  if (audit.scale.length) parts.push(`${audit.scale.length} ready to scale`)
  if (audit.watch.length) parts.push(`${audit.watch.length} catchy but not converting`)
  if (audit.pause.length) parts.push(`${audit.pause.length} burning budget`)
  const title = `I audited your ${audit.total} campaigns — ${parts.length ? parts.join(', ') : 'all steady'}.`
  const body = `${money(audit.spend)} spend · ${audit.avgRoas}x average ROAS over the last 14 days.` +
    (audit.scale[0] ? ` Best: “${audit.scale[0].name}” at ${audit.scale[0].roas.toFixed(1)}x.` : '') +
    (audit.pause[0] ? ` Worst: “${audit.pause[0].name}” — ${money(audit.pause[0].spend)} for ${audit.pause[0].conversions} conversions.` : '')
  // Structured numbers for the brief's dedicated Facebook Ads card (rendered from payload, not the
  // prose body). Keep it compact — top few per bucket is all the card shows.
  const slim = (x: Graded) => ({ name: x.name, metaCampaignId: x.metaCampaignId, roas: +x.roas.toFixed(2), spend: Math.round(x.spend), conversions: x.conversions, dailyBudget: x.dailyBudget })

  // Compute "What Mello would do" ONCE here (nightly cron / on-connect) and STORE it, so the brief
  // renders the cards with ZERO live Graph calls on load. Best-effort — the card is fine without it.
  let opportunities: any[] = []
  try {
    const { fetchLiveOpportunities } = await import('@/lib/meta/opportunities-fetch')
    opportunities = await fetchLiveOpportunities(decryptToken(primary.access_token), primary.account_id, 'last_30d', cur)
  } catch (e: any) { console.error('[meta audit] opportunities', e?.message) }

  const payload = {
    total: audit.total, spend: audit.spend, avgRoas: audit.avgRoas, currency: cur,
    selected: primary?.account_id || null, accountName: primary?.account_name || null, opportunities,
    scale: audit.scale.slice(0, 3).map(slim),
    watch: audit.watch.slice(0, 3).map(slim),
    pause: audit.pause.slice(0, 3).map(slim),
  }
  await admin.from('brief_events').delete().eq('user_id', userId).eq('kind', 'meta_audit').gte('created_at', `${today}T00:00:00Z`).then(() => {}, () => {})
  await admin.from('brief_events').insert({
    user_id: userId, kind: 'meta_audit', importance: 96, title, body, payload,
    cta_label: 'See the full report', cta_href: '/reports',
  }).then(() => {}, () => {})

  // ── One-click actions: the top pause + the top scale, as approval-gated task suggestions.
  // (kind check extended in migration 126; insert is best-effort until it's applied.) ──
  const week = `${today.slice(0, 4)}-W${Math.ceil(new Date().getDate() / 7)}`
  if (audit.pause[0]) {
    await admin.from('mello_tasks').upsert({
      user_id: userId, kind: 'meta_pause',
      title: `Pause “${audit.pause[0].name}” — it’s burning budget`,
      why: `$${Math.round(audit.pause[0].spend)} spent for ${audit.pause[0].conversions} conversions at ${audit.pause[0].roas.toFixed(1)}x ROAS (account avg ${audit.avgRoas}x). Pausing stops the bleed today.`,
      evidence: { metaCampaignId: audit.pause[0].metaCampaignId, campaignName: audit.pause[0].name, spend: audit.pause[0].spend, roas: audit.pause[0].roas },
      credits: null, status: 'suggested', suggested_key: `meta_pause:${audit.pause[0].metaCampaignId}:${week}`,
    }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
  }
  if (audit.scale[0] && audit.scale[0].dailyBudget) {
    const nb = Math.round(audit.scale[0].dailyBudget * 1.2)
    await admin.from('mello_tasks').upsert({
      user_id: userId, kind: 'meta_scale',
      title: `Scale “${audit.scale[0].name}” +20% — it’s your winner`,
      why: `${audit.scale[0].roas.toFixed(1)}x ROAS vs ${audit.avgRoas}x account average, with real spend behind it. A 20% budget step ($${audit.scale[0].dailyBudget} → $${nb}/day) scales without shocking delivery.`,
      evidence: { metaCampaignId: audit.scale[0].metaCampaignId, campaignName: audit.scale[0].name, currentBudget: audit.scale[0].dailyBudget, newBudget: nb, roas: audit.scale[0].roas },
      credits: null, status: 'suggested', suggested_key: `meta_scale:${audit.scale[0].metaCampaignId}:${week}`,
    }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
  }

  // ── "Target them" (audience) + "Review placements" (placement) as approvable tasks, so they surface
  // in Slack/WhatsApp too. Anchored on the winner: approve → safe duplicate-and-tune (applyTune), the
  // original never touched. Only when there IS a winner to duplicate + a budget to seed the copy with.
  if (audit.scale[0]?.metaCampaignId && audit.scale[0].dailyBudget) {
    const winner = audit.scale[0]
    const budget = Math.max(5, Math.round(winner.dailyBudget as number))
    const audienceOpp = opportunities.find((o: any) => o?.apply?.kind === 'audience')
    const placementOpp = opportunities.find((o: any) => o?.apply?.kind === 'placement')
    if (audienceOpp?.apply) {
      await admin.from('mello_tasks').upsert({
        user_id: userId, kind: 'meta_audience',
        title: `Focus a copy of “${winner.name}” on ${audienceOpp.apply.label}`,
        why: audienceOpp.why,
        evidence: { metaCampaignId: winner.metaCampaignId, campaignName: winner.name, apply: audienceOpp.apply, newBudget: budget },
        credits: null, status: 'suggested', suggested_key: `meta_audience:${winner.metaCampaignId}:${week}`,
      }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
    }
    if (placementOpp?.apply) {
      await admin.from('mello_tasks').upsert({
        user_id: userId, kind: 'meta_placement',
        title: `Focus a copy of “${winner.name}” on ${placementOpp.apply.label}`,
        why: placementOpp.why,
        evidence: { metaCampaignId: winner.metaCampaignId, campaignName: winner.name, apply: placementOpp.apply, newBudget: budget },
        credits: null, status: 'suggested', suggested_key: `meta_placement:${winner.metaCampaignId}:${week}`,
      }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
    }
  }

  return audit
}

/**
 * Fast, read-only audit of ONE account for the brief card's switcher: grades from the already-synced
 * DB (no Graph sync, no writes), lists all connected accounts for the dropdown, and fetches TODAY's
 * account-level spend with a single live Graph call. Returns everything the card needs to switch instantly.
 */
const RANGES = new Set(['last_3d', 'last_7d', 'last_14d', 'last_30d'])
export async function auditAccount(admin: any, userId: string, accountId?: string, rangeIn = 'last_30d') {
  const range = RANGES.has(rangeIn) ? rangeIn : 'last_30d'
  // Cache per (user, account, range) — collapses the redundant re-fetches that were blowing Meta's rate limit.
  const cacheKey = `audit:${userId}:${accountId || 'primary'}:${range}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  // ORG-SCOPED: a founder must be able to audit accounts connected by any org member (matching
  // /api/meta/accounts + the "Meta connected" pill). Keying on .eq('user_id', self) here made Mello
  // answer "no Meta account connected" even though the app showed one connected.
  const { scopedMetaAccounts } = await import('@/lib/meta/scope')
  const accounts = await scopedMetaAccounts(admin, userId)
  if (!accounts?.length) return null
  // Match the requested account tolerantly (act_ prefix drift); otherwise the DETERMINISTIC primary
  // (same resolver the nightly audit uses) — never a silent fall to a random account with a different
  // currency, which is what made the card flip €86 ↔ $687k under one "primary" label.
  const acct = (accountId ? accounts.find((a: any) => sameAcct(a.account_id, accountId)) : null) || resolvePrimary(accounts)

  const token = (() => { try { return decryptToken(acct.access_token) } catch { return '' } })()

  // LIVE current status + budget (not the synced DB, which goes stale — a campaign paused on Meta was
  // still showing as "active" in the brief, so Mello recommended pausing an already-off campaign).
  // effective_status is the source of truth for "is this actually delivering right now".
  const liveById = new Map<string, any>()
  try {
    const cm = await graph(`act_${acct.account_id}/campaigns?fields=id,name,effective_status,status,daily_budget&limit=300`, token)
    for (const c of (cm?.data || [])) liveById.set(String(c.id), c)
  } catch { /* fall back to synced status below */ }
  const { data: dbCamps } = await admin.from('campaigns')
    .select('meta_campaign_id,name,status,daily_budget').eq('user_id', userId).eq('meta_account_id', acct.id)
  const metaById = new Map((dbCamps || []).map((c: any) => [String(c.meta_campaign_id), c]))
  let campaigns: any[] = []
  try {
    const ci = await graph(`act_${acct.account_id}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,actions,action_values&date_preset=${range}&limit=300`, token)
    campaigns = (ci?.data || []).map((r: any) => {
      const rev = Number((r.action_values || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)
      const conv = Math.round(Number((r.actions || []).filter((a: any) => /purchase|complete_registration|lead/.test(a.action_type)).reduce((s: number, a: any) => s + Number(a.value || 0), 0)))
      const spend = Number(r.spend || 0)
      const live: any = liveById.get(String(r.campaign_id))
      const meta: any = metaById.get(String(r.campaign_id)) || {}
      // 'ACTIVE' only when Meta says it's actually delivering; otherwise the live effective_status
      // (CAMPAIGN_PAUSED, PAUSED, etc.). Falls back to synced status only if the live call failed.
      const status = live?.effective_status || meta.status || 'ACTIVE'
      return {
        id: r.campaign_id, meta_campaign_id: r.campaign_id, name: r.campaign_name || live?.name || meta.name || 'Campaign',
        // Meta's live daily_budget is in MINOR units (cents); the synced meta.daily_budget is already
        // major (syncAccount ÷100). Normalize the live one so the whole app treats budgets as MAJOR.
        status, daily_budget: live?.daily_budget != null ? Number(live.daily_budget) / 100 : (meta.daily_budget ?? null),
        campaign_insights: [{ spend, conversion_value: rev, roas: spend > 0 ? rev / spend : 0, ctr: Number(r.ctr || 0), impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0), conversions: conv, date_stop: '9999' }],
      }
    })
  } catch { /* live campaign insights are best-effort → empty audit */ }
  const audit = campaigns.length ? grade(campaigns) : { total: 0, spend: 0, avgRoas: 0, scale: [] as Graded[], watch: [] as Graded[], pause: [] as Graded[] }

  // Today's account-level spend — one quick live call (this is the "Spend today" figure).
  let spendToday = 0
  try {
    const j = await graph(`act_${acct.account_id}/insights?fields=spend&date_preset=today&level=account`, token)
    spendToday = Number(j?.data?.[0]?.spend || 0)
  } catch { /* today's spend is best-effort */ }

  // Top ADS (Polsia-style row): ad-level insights for the last 14d, top by spend, with thumbnails.
  let ads: any[] = []
  try {
    // campaign_name comes free with the insights call (no extra request) — the ad names are all
    // identical ("New Sales ad"), so the campaign is what actually tells them apart.
    const ai = await graph(`act_${acct.account_id}/insights?level=ad&fields=ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions,action_values&date_preset=${range}&limit=100`, token)
    ads = (ai?.data || []).map((r: any) => {
      const rev = Number((r.action_values || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)
      const conv = Number((r.actions || []).filter((a: any) => /purchase|complete_registration|lead/.test(a.action_type)).reduce((s: number, a: any) => s + Number(a.value || 0), 0))
      const spend = Number(r.spend || 0)
      return { adId: r.ad_id, name: r.ad_name || 'Ad', campaignName: r.campaign_name || null, metaCampaignId: r.campaign_id || null, spend: Math.round(spend), impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0), ctr: +Number(r.ctr || 0).toFixed(2), cpc: +Number(r.cpc || 0).toFixed(2), roas: +(spend > 0 ? rev / spend : 0).toFixed(2), conversions: conv, thumbnail_url: null as string | null, preview_url: null as string | null }
    }).sort((a: any, b: any) => b.spend - a.spend).slice(0, 6)
    // Thumbnails for JUST the top 6, in ONE batched read (`?ids=a,b,c`), NOT one call per ad. The
    // per-ad fetch was the rate-limit culprit (error 17); a single batch keeps the visuals cheap.
    try {
      const ids = ads.map((a: any) => a.adId).filter(Boolean)
      if (ids.length) {
        const batch = await graph(`?ids=${ids.join(',')}&fields=creative{thumbnail_url,image_url}`, token)
        for (const a of ads) {
          const cre = batch?.[a.adId]?.creative
          a.thumbnail_url = cre?.thumbnail_url || cre?.image_url || null
        }
      }
    } catch { /* thumbnails best-effort — the 🎬 fallback still renders */ }
  } catch { /* ad-level is best-effort */ }

  const slim = (x: Graded) => ({ name: x.name, metaCampaignId: x.metaCampaignId, roas: +x.roas.toFixed(2), spend: Math.round(x.spend), conversions: x.conversions, dailyBudget: x.dailyBudget })
  const result = {
    accounts: accounts.map((a: any) => ({ accountId: a.account_id, name: a.account_name || `act_${a.account_id}`, currency: a.currency || 'USD', isPrimary: !!a.is_primary })),
    selected: acct.account_id, currency: acct.currency || 'USD', accountName: acct.account_name || null, range,
    total: audit.total, spend: audit.spend, avgRoas: audit.avgRoas, spendToday: Math.round(spendToday),
    counts: { scale: audit.scale.length, watch: audit.watch.length, pause: audit.pause.length },
    scale: audit.scale.slice(0, 3).map(slim), watch: audit.watch.slice(0, 3).map(slim), pause: audit.pause.slice(0, 3).map(slim),
    ads,
  }
  cacheSet(cacheKey, result, 10 * 60 * 1000)   // 10 min — spend-today can lag a few minutes, that's fine
  return result
}
