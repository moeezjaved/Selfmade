/**
 * The Strategist — Mello's "best-founder brain" for generating the next high-impact tasks.
 *
 * This is the intelligent successor to the deterministic tasks.ts. Where tasks.ts fires fixed templates
 * (competitor burst → research; best ad → creative), the Strategist COMPOSES everything Selfmade already
 * knows about the account and reasons like a top DTC growth operator:
 *
 *   loadMelloContext()      → plan, Meta connection, watched competitors (the account state)
 *   winnerDna() + dnaDiff() → the proven winning DNA in the niche + the moves the brand is missing
 *   live company signals     → what's actually running (active campaigns, creatives, competitors, inbox)
 *   recall()                 → the brain: CEO preferences + past learnings (what worked / what to avoid)
 *
 * From that it detects the BUSINESS STAGE and produces a small ranked set of tasks tuned to the stage —
 * a pre-launch brand needs first traffic + a converting offer; a scaling brand needs conversion, AOV and
 * retention, not more ads. Grounded rule (same as the DNA engine): it may only speak from the data we
 * hand it — never invent a competitor, number, or gap.
 *
 * ADDITIVE + SAFE: new module + new endpoint. It only ever WRITES suggested tasks (status 'suggested');
 * it never executes anything or touches billing/Meta. runTask (existing) still gates real actions.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { loadMelloContext } from '@/lib/mello/context'
import { recall } from '@/lib/brain'
import { winnerDna, ownDna, dnaDiff } from '@/lib/dna/engine'

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

export type Lever = 'traffic' | 'conversion' | 'aov' | 'retention' | 'efficiency' | 'brand'
export type BusinessStage = 'setup' | 'first-cycle' | 'running' | 'scaling'

export type StrategistTask = {
  title: string
  lever: Lever
  dept: string           // department key (media/creative/research/customer/reports/…)
  why: string            // grounded, specific, plain English
  steps: string[]        // the brief — how it gets done
  hypothesis: string     // the revenue/outcome bet
  impact: string         // "+$4,200/mo", "+$310/wk", "protects scale" — honest, may be qualitative
  runnable: boolean      // can Mello execute it now, or does it need a connection first
  suggested_key: string  // dedupe key
}

export type StrategistPlan = {
  stage: BusinessStage
  headline: string       // the founder-level read: "You don't have a traffic problem — you have a conversion problem."
  tasks: StrategistTask[]
  grounding: string[]    // provenance of what the plan was built from
}

// ── stage detection — from real signals, honest and cheap ──
function detectStage(sig: { metaConnected: boolean; competitors: number; activeCampaigns: number; ownAds: number }): BusinessStage {
  if (sig.activeCampaigns >= 3) return 'scaling'
  if (sig.activeCampaigns >= 1) return 'running'
  if (sig.metaConnected || sig.competitors > 0 || sig.ownAds > 0) return 'first-cycle'
  return 'setup'
}

const STAGE_FOCUS: Record<BusinessStage, string> = {
  setup: 'The brand is barely live. Priority: get the account connected and the FIRST proven ads running — traffic and a believable offer. Do NOT propose advanced retention/AOV plays yet.',
  'first-cycle': 'Ads exist but little is live. Priority: launch the strongest few ads, kill obvious waste, and remove the single biggest conversion blocker. One clear win beats ten ideas.',
  running: 'Ads are live and spending. Priority: find the real bottleneck across the WHOLE funnel — usually conversion or AOV, not more spend. Pull the highest-leverage lever first.',
  scaling: 'The brand is scaling. Priority: efficiency, order value, retention and new-channel/geo expansion. Protect what works; compound it. Diminishing returns on raw ad spend.',
}

export async function generateStrategistPlan(
  admin: SupabaseClient,
  opts: { userId: string; brandId?: string | null; persist?: boolean; limit?: number },
): Promise<StrategistPlan> {
  const limit = Math.min(6, Math.max(2, opts.limit ?? 5))
  const ctx = await loadMelloContext(admin, opts.userId, opts.brandId ?? null)
  const brandId = ctx.brandId

  // Live signals — small, honest counts for stage + grounding.
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString()
  const cnt = async (fn: () => any): Promise<number> => { try { const { count } = await fn(); return count || 0 } catch { return 0 } }
  const [activeCampaigns, creativesWk, openChats] = await Promise.all([
    cnt(() => { let q = (admin as any).from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', opts.userId).eq('status', 'ACTIVE'); return q }),
    cnt(() => { let q = (admin as any).from('creative_generations').select('id', { count: 'exact', head: true }).eq('user_id', opts.userId).gte('created_at', weekAgo); if (brandId) q = q.eq('brand_id', brandId); return q }),
    cnt(() => { let q = (admin as any).from('customer_threads').select('id', { count: 'exact', head: true }).eq('user_id', opts.userId).eq('status', 'open'); if (brandId) q = q.eq('brand_id', brandId); return q }),
  ])

  // Competitor winning DNA + the gaps the brand is missing (grounded market truth).
  const compPageIds = ctx.competitors.map(c => c.pageId).filter((p): p is string => !!p)
  let winners: Awaited<ReturnType<typeof winnerDna>> | null = null
  let gaps: ReturnType<typeof dnaDiff> = []
  let ownFound = false, ownAds = 0
  if (compPageIds.length) {
    try {
      winners = await winnerDna(compPageIds, null, ctx.brandName)
      const own = await ownDna(null)   // own-ad grounding resolves once the brand's own page is linked; competitor DNA already grounds the plan
      ownFound = own.found; ownAds = own.totalAds
      gaps = dnaDiff(own, winners)
    } catch { /* DNA optional — plan still grounds on context + signals + brain */ }
  }

  // The brain — what the founder prefers + what we've already learned works/fails.
  let prefs: Record<string, any> = {}, learnings: any[] = []
  try { const r = await recall(admin, { userId: opts.userId, department: 'media', brandId, limit: 8 }); prefs = r.prefs || {}; learnings = r.learnings || [] } catch { /* brain optional */ }

  const stage = detectStage({ metaConnected: ctx.integrations.meta.connected, competitors: ctx.competitors.length, activeCampaigns, ownAds })

  const grounding = [
    ...ctx.provenance,
    `stage:${stage}`,
    `campaigns_active:${activeCampaigns}`,
    `creatives_wk:${creativesWk}`,
    `inbox_open:${openChats}`,
    winners ? `winner_dna:${winners.winnerCount}` : 'winner_dna:none',
    `gaps:${gaps.length}`,
    ownFound ? `own_ads:${ownAds}` : 'own_ads:0',
  ]

  const sys = `You are the CEO-level growth strategist inside Selfmade — an autonomous marketing company for DTC brands. You think like a top e-commerce founder/operator, not an ad tool.
YOUR JOB: from the account data below, produce a SMALL, RANKED set of the next high-impact TASKS that move the brand's REVENUE — across the WHOLE go-to-market (traffic, conversion, order value, retention, efficiency, brand), not just ads. Generating ad images is a commodity; your value is DIAGNOSIS and picking the highest-leverage lever.
HARD RULES:
- Ground everything ONLY in the data provided. Never invent a competitor, number, metric, or gap that isn't in the input. If evidence is thin, propose lower-confidence discovery tasks and say what you'd need.
- Diagnose first: identify the single biggest constraint on revenue right now, then pick moves that relieve it. More ad spend is rarely the answer once ads are live.
- Respect the BUSINESS STAGE (given below as stage + stage_focus). Do not propose stage-inappropriate plays.
- Each task is concrete and one a real operator would run this week. Name the specific competitor / gap / signal it comes from.
- Prefer diversity of levers over five variations of one idea. Max ${limit} tasks.
- "impact" must be honest: give a $ estimate ONLY if the data supports it (e.g. from ad counts, gaps); otherwise qualitative ("protects scale", "unlocks a channel").
- "runnable": true if Selfmade can act now (ads live, creatives, competitor remakes, replies); false if it first needs a connection the account lacks (e.g. Meta not connected, no store).
Return JSON: {"stage_read":"one plain-English sentence naming the biggest constraint", "tasks":[{"title","lever","dept","why","steps":["…"],"hypothesis","impact","runnable":true|false}]}. lever ∈ {traffic,conversion,aov,retention,efficiency,brand}. dept ∈ {media,creative,research,customer,reports,email,seo,site,outreach}.`

  const user = JSON.stringify({
    brand: ctx.brandName || 'the brand',
    stage,
    stage_focus: STAGE_FOCUS[stage],
    account: {
      plan: ctx.plan.label, meta_connected: ctx.integrations.meta.connected,
      slack: ctx.integrations.slack.connected, whatsapp: ctx.integrations.whatsapp.connected,
      active_campaigns: activeCampaigns, creatives_last_week: creativesWk, open_inbox_threads: openChats,
    },
    competitors: ctx.competitors.map(c => c.name).slice(0, 12),
    winner_dna: winners ? { proven_winners: winners.winnerCount, sample: winners.sampleSize, dist: winners.dist, media_mix: winners.media } : null,
    your_ads: ownFound ? { count: ownAds } : 'no own ads linked yet — ground on competitor DNA',
    gaps: gaps.slice(0, 12),
    ceo_preferences: prefs,
    recent_learnings: learnings.slice(0, 8).map((l: any) => ({ event: l.event, result: l.result, metric: l.metric })),
  })

  let stageRead = STAGE_FOCUS[stage]
  let rawTasks: any[] = []
  try {
    const res = await oai().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    })
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
    if (typeof parsed.stage_read === 'string' && parsed.stage_read.trim()) stageRead = parsed.stage_read.trim()
    if (Array.isArray(parsed.tasks)) rawTasks = parsed.tasks
  } catch { /* fail-soft below */ }

  const LEVERS: Lever[] = ['traffic', 'conversion', 'aov', 'retention', 'efficiency', 'brand']
  const tasks: StrategistTask[] = rawTasks.slice(0, limit).map((t: any, i: number): StrategistTask => {
    const title = String(t?.title || '').trim() || 'Untitled move'
    return {
      title,
      lever: LEVERS.includes(t?.lever) ? t.lever : 'traffic',
      dept: String(t?.dept || 'media').trim(),
      why: String(t?.why || '').trim(),
      steps: Array.isArray(t?.steps) ? t.steps.map((s: any) => String(s)).slice(0, 6) : [],
      hypothesis: String(t?.hypothesis || '').trim(),
      impact: String(t?.impact || '').trim() || '—',
      runnable: t?.runnable !== false,
      suggested_key: `strat:${stage}:${slug(title)}:${i}`,
    }
  })

  const plan: StrategistPlan = { stage, headline: stageRead, tasks, grounding }

  if (opts.persist && tasks.length) await persistTasks(admin, opts.userId, brandId, plan)
  return plan
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

// Write the plan's tasks as SUGGESTED mello_tasks (idempotent by suggested_key). Never executes.
async function persistTasks(admin: SupabaseClient, userId: string, brandId: string | null, plan: StrategistPlan): Promise<void> {
  const kindFor = (dept: string): string => (dept === 'creative' ? 'creative' : dept === 'research' ? 'research' : 'strategy')
  for (const t of plan.tasks) {
    try {
      await (admin as any).from('mello_tasks').upsert({
        user_id: userId, brand_id: brandId, kind: kindFor(t.dept), status: 'suggested',
        title: t.title, why: t.why,
        evidence: { lever: t.lever, dept: t.dept, steps: t.steps, hypothesis: t.hypothesis, impact: t.impact, runnable: t.runnable, stage: plan.stage, source: 'strategist' },
        suggested_key: t.suggested_key, credits: null,
      }, { onConflict: 'suggested_key' })
    } catch { /* best-effort persist — a schema/column mismatch must never break plan generation */ }
  }
}
