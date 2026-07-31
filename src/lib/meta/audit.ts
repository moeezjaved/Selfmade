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

const V = process.env.META_API_VERSION || 'v20.0'
const G = `https://graph.facebook.com/${V}`

type Graded = { campaignId: string; metaCampaignId: string; name: string; grade: 'graduate' | 'catchy' | 'pause' | 'hold'; spend: number; roas: number; ctr: number; conversions: number; dailyBudget: number | null }
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
  const graded: Graded[] = rows.map(({ c, i }) => {
    const roas = Number(i.roas || 0), spend = Number(i.spend || 0), ctr = Number(i.ctr || 0), conv = Number(i.conversions || 0)
    let tier: Graded['grade'] = 'hold'
    if (avgRoas > 0 && roas >= avgRoas * g.graduate.roas_above_avg_pct && spend >= avgSpend * g.graduate.min_spend_pct && conv >= g.graduate.min_conversions) tier = 'graduate'
    else if ((ctr >= avgCtr * g.catchy_not_converting.ctr_above_avg_multiplier || spend >= avgSpend * g.catchy_not_converting.spend_above_avg_multiplier) && (avgRoas === 0 || roas < avgRoas * g.catchy_not_converting.roas_below_avg_pct)) tier = 'catchy'
    else if (spend < avgSpend * g.pause_poor.spend_below_avg_pct && (avgRoas === 0 || roas < avgRoas * g.pause_poor.roas_below_avg_pct) && String(c.status).toUpperCase() === 'ACTIVE') tier = 'pause'
    return { campaignId: c.id, metaCampaignId: c.meta_campaign_id, name: c.name, grade: tier, spend, roas, ctr, conversions: conv, dailyBudget: c.daily_budget != null ? Number(c.daily_budget) : null }
  })
  return {
    total: rows.length, spend: Math.round(totSpend), avgRoas: +avgRoas.toFixed(2),
    scale: graded.filter((x) => x.grade === 'graduate').sort((a, b) => b.roas - a.roas),
    watch: graded.filter((x) => x.grade === 'catchy').sort((a, b) => b.spend - a.spend),
    pause: graded.filter((x) => x.grade === 'pause').sort((a, b) => b.spend - a.spend),
  }
}

/** The full skill run: sync (optional) → grade → deposit into the Brief + task suggestions. */
export async function runMetaAudit(admin: any, userId: string, opts: { syncFirst?: boolean } = {}): Promise<AuditResult | null> {
  const { data: accounts } = await admin.from('meta_accounts').select('*').eq('user_id', userId).eq('status', 'active')
  if (!accounts?.length) return null

  if (opts.syncFirst !== false) {
    for (const a of accounts) {
      try { await syncAccount(admin, a) } catch (e: any) {
        // A dead token must SURFACE, not rot silently: mark + tell the founder in the brief.
        if (/expired|invalid|OAuth/i.test(String(e?.message))) {
          await admin.from('meta_accounts').update({ status: 'error' }).eq('id', a.id)
          await admin.from('brief_events').insert({
            user_id: userId, kind: 'meta_health', importance: 90,
            title: 'Meta lost access to your ad account.',
            body: 'The token expired or was revoked — reconnect in a minute and I pick right back up.',
            cta_label: 'Reconnect Meta', cta_href: '/connect/meta',
          }).then(() => {}, () => {})
        }
      }
    }
  }

  const { data: campaigns } = await admin.from('campaigns')
    .select('id,name,meta_campaign_id,status,daily_budget,campaign_insights(*)')
    .eq('user_id', userId)
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
  const body = `$${audit.spend.toLocaleString()} spend · ${audit.avgRoas}x average ROAS over the last 14 days.` +
    (audit.scale[0] ? ` Best: “${audit.scale[0].name}” at ${audit.scale[0].roas.toFixed(1)}x.` : '') +
    (audit.pause[0] ? ` Worst: “${audit.pause[0].name}” — $${Math.round(audit.pause[0].spend)} for ${audit.pause[0].conversions} conversions.` : '')
  // Structured numbers for the brief's dedicated Facebook Ads card (rendered from payload, not the
  // prose body). Keep it compact — top few per bucket is all the card shows.
  const slim = (x: Graded) => ({ name: x.name, roas: +x.roas.toFixed(2), spend: Math.round(x.spend), conversions: x.conversions, dailyBudget: x.dailyBudget })
  const payload = {
    total: audit.total, spend: audit.spend, avgRoas: audit.avgRoas,
    scale: audit.scale.slice(0, 3).map(slim),
    watch: audit.watch.slice(0, 3).map(slim),
    pause: audit.pause.slice(0, 3).map(slim),
  }
  await admin.from('brief_events').delete().eq('user_id', userId).eq('kind', 'meta_audit').gte('created_at', `${today}T00:00:00Z`).then(() => {}, () => {})
  await admin.from('brief_events').insert({
    user_id: userId, kind: 'meta_audit', importance: 96, title, body, payload,
    cta_label: 'See the full audit', cta_href: '/m4',
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

  return audit
}
