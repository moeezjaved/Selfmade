/**
 * The ads router — Phase 1 (grounded) + Phase 2 (reasoned), docs/design-mello-ads-employee.md.
 *
 * When a user asks Mello an ad-performance question, we NEVER route through the open tool-loop that
 * hangs. We read the audit we already compute (auditAccount → live grade of the primary account) and:
 *   Phase 2: hand that GROUNDED snapshot to a reasoning model that thinks like a media buyer, returns a
 *            2-4 sentence answer AND concrete pause/scale actions, which we write as one-click
 *            mello_tasks (confirm → tasks/run executes; the model NEVER touches Meta directly).
 *   Phase 1: if the model is unavailable / errors / times out, fall back to the deterministic answer
 *            straight from the audit rules. Either way it is fast and CANNOT hang.
 *
 * Returns { reply } when it handled an ads question, or null when the message isn't one.
 */
import { auditAccount } from '@/lib/meta/audit'
import { recall } from '@/lib/brain'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'
import { parsePeriod, parseMetric, buildMetricAnswer, parseComparison, buildComparisonAnswer, DEFAULT_PERIOD } from '@/lib/meta/metric-contract'

const ADS_NOUN = /\b(ads?|campaigns?|roas|spend(?:ing)?|budget|meta ads?|facebook ads?|ad account|ad performance)\b/i
const ADS_VERB = /\b(improve|fix|optimi[sz]e|scale|pause|kill|cut|stop|help|grow|lower|reduce|what should i do|what do i (?:need to )?do|how (?:are|is|'?s|do|should)|which|worst|best|winning|losing|bleeding|wasting)\b/i
const MY_ADS = /\b(?:my|our) (?:ads?|campaigns?|roas|ad account|account|spend|performance)\b/i
// Money/performance phrasings that mean "how are we doing" — route to the FAST grounded audit answer,
// not the slow agent (which timed out on "what is sales today"). Grounded on the Meta audit today.
const PERF = /\b(sales|revenue|profit|how much (?:did|have|are|is)|how (?:are|'?s|is) (?:we|things|business|it going)|today'?s?\s+(?:numbers|sales|revenue|spend)|this (?:week|month)|are we (?:doing )?(?:ok|okay|good|profitable))\b/i

// HARD RULE: any measurable Meta metric noun routes to the canonical service — never the Brain/LLM.
const METRIC_NOUN = /\b(roas|cpa|cpc|cpm|ctr|impressions?|clicks?|purchases?|orders?|conversions?|revenue|spend|spent|budget)\b/i

export function isAdsQuestion(message: string): boolean {
  const q = String(message || '')
  if (MY_ADS.test(q) || PERF.test(q)) return true
  // A measurable metric is always a canonical-data question (spend/roas/orders/impressions/…), so it must
  // reach auditAccount and never be answered from memory or a generic LLM.
  if (METRIC_NOUN.test(q)) return true
  // "ads performance", "campaign results", "how are the ads doing" — route to the GROUNDED audit, not
  // the free agent (which had no numbers and invented ROAS). A performance question needs no ADS_VERB.
  if (/\b(ads?|campaigns?)\s+(performance|results?|doing|numbers?|stats?)\b/i.test(q)) return true
  return ADS_NOUN.test(q) && ADS_VERB.test(q)
}

const fmtMoney = (n: number, currency: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }

/** Phase 1 — deterministic answer straight from the audit rules. The fallback, and the safety net. */
function deterministicAnswer(a: any, windowLabel = 'the last 30 days'): string {
  const money = (n: number) => fmtMoney(n, a.currency)
  const scale = a.scale?.[0], pause = a.pause?.[0], watch = a.watch?.[0]
  const cur = a.currency || 'USD'

  // Rich, grounded breakdown — same shape as the full Mello analysis, but computed straight from the
  // audit (no LLM, can't hang). Renders as Markdown in both the brief and /mello.
  let out = `**${a.accountName || 'Your account'}** — ${money(a.spend)} spent over ${windowLabel} at **${a.avgRoas}x** ROAS across ${a.total} campaign${a.total === 1 ? '' : 's'} (${money(a.spendToday)} today).\n\n`

  const ads = Array.isArray(a.ads) ? a.ads.slice(0, 5) : []
  if (ads.length) {
    out += `**Top ads**\n\n`
    out += `| Ad | Name | Campaign | Spend | ROAS | CTR |\n|---|---|---|---|---|---|\n`
    for (const ad of ads) {
      const thumb = ad.thumbnail_url ? `![](${ad.thumbnail_url})` : '🎬'
      out += `| ${thumb} | ${ad.name || 'Ad'} | ${ad.campaignName || '—'} | ${money(ad.spend)} | ${ad.roas ? ad.roas.toFixed(2) + 'x' : '—'} | ${ad.ctr ? ad.ctr.toFixed(2) + '%' : '—'} |\n`
    }
    out += `\n`
  }

  const moves: string[] = []
  if (scale) moves.push(`**Scale “${scale.name}”** — your winner at ${scale.roas}x vs ${a.avgRoas}x account average. It has room.`)
  if (pause) moves.push(`**Pause “${pause.name}”** — ${money(pause.spend)} for ${pause.conversions} sale${pause.conversions === 1 ? '' : 's'}. It's bleeding.`)
  if (watch && !scale) moves.push(`**Watch “${watch.name}”** — catchy but not converting yet; give it another day.`)
  if (moves.length) {
    out += `**What I'd do**\n\n${moves.map(m => `- ${m}`).join('\n')}\n\nThese are one-click in your Morning Brief — say yes and I'll make the change on Meta.`
  } else {
    out += `Everything's steady — no campaign needs a move today. I'll flag it the moment one does.`
  }
  return out
}

/** Write the model's proposed actions as one-click mello_tasks (approve → tasks/run executes). */
async function writeActions(admin: any, userId: string, currency: string, actions: any[], validIds: Set<string>) {
  const money = (n: number) => fmtMoney(n, currency)
  const week = (() => { const d = new Date().toISOString().slice(0, 10); return `${d.slice(0, 4)}-W${Math.ceil(new Date().getUTCDate() / 7)}` })()
  for (const act of (Array.isArray(actions) ? actions : []).slice(0, 4)) {
    const id = String(act?.metaCampaignId || '')
    if (!validIds.has(id)) continue                      // never trust a campaign id the model invented
    const name = String(act?.campaignName || 'campaign')
    const reason = String(act?.reason || '').slice(0, 240)
    if (act?.type === 'pause') {
      await admin.from('mello_tasks').upsert({
        user_id: userId, kind: 'meta_pause', title: `Pause “${name}”`, why: reason || `Underperforming — pausing stops the bleed.`,
        evidence: { metaCampaignId: id, campaignName: name }, credits: null, status: 'suggested', suggested_key: `meta_pause:${id}:${week}`,
      }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
    } else if (act?.type === 'scale') {
      const nb = Number(act?.newDailyBudget) || null
      await admin.from('mello_tasks').upsert({
        user_id: userId, kind: 'meta_scale', title: `Scale “${name}”${nb ? ` to ${money(nb)}/day` : ' +20%'}`, why: reason || `Proven winner with room to grow.`,
        evidence: { metaCampaignId: id, campaignName: name, newBudget: nb }, credits: null, status: 'suggested', suggested_key: `meta_scale:${id}:${week}`,
      }, { onConflict: 'user_id,suggested_key', ignoreDuplicates: true }).then(() => {}, () => {})
    }
  }
}

/** Phase 2 — reasoning model over the grounded snapshot. Returns the prose answer, or null on any issue. */
async function reasonedAnswer(admin: any, userId: string, a: any, windowLabel = 'last 30 days'): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const { default: OpenAI } = await import('openai')
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const validIds = new Set<string>([...(a.scale || []), ...(a.watch || []), ...(a.pause || [])].map((c: any) => String(c.metaCampaignId)).filter(Boolean))

  const snapshot = {
    account: a.accountName, currency: a.currency, window: windowLabel,
    spend: a.spend, avgRoas: a.avgRoas, spendToday: a.spendToday, totalCampaigns: a.total,
    readyToScale: a.scale, catchyButNotConverting: a.watch, burningBudget: a.pause,
    topAds: (a.ads || []).map((ad: any) => ({ name: ad.name, spend: ad.spend, impressions: ad.impressions, clicks: ad.clicks, ctr: ad.ctr, cpc: ad.cpc, roas: ad.roas })),
  }
  const system = `You are Mello, a sharp senior Meta media buyer talking to the founder. Reason over the account snapshot and decide what to do to improve the ads. Think about signal quality (a "winner" with only 1-2 conversions is thin), spend concentration, and cheap CTR that isn't converting.
CRITICAL — NUMERIC FIDELITY: Every number you state (ROAS, spend, CTR, CPC, impressions, clicks, %) MUST be copied EXACTLY from the snapshot JSON. Do NOT invent, estimate, average, re-round, or otherwise change any number. The account's average ROAS is EXACTLY ${a.avgRoas}x and total spend is EXACTLY ${fmtMoney(a.spend, a.currency)} — never state a different account ROAS or spend. A campaign/ad's ROAS is only ever the "roas" field on that item in the snapshot. If a number is not in the snapshot, do NOT mention it. Getting a number wrong is a serious failure.
Reply ONLY as JSON: {"answer": string, "actions": [{"type":"pause"|"scale","metaCampaignId":string,"campaignName":string,"reason":string,"newDailyBudget":number}]}.
- "answer": 2-4 sentences, first person, specific, citing numbers copied EXACTLY from the snapshot (${a.currency}). Sound like a media buyer, not a calculator. If nothing needs doing, say so plainly.
- "actions": only high-confidence moves. metaCampaignId MUST be one from the snapshot (readyToScale/catchyButNotConverting/burningBudget). newDailyBudget only for scale (a sensible ~20% step above current dailyBudget). Never invent a campaign. Empty array is fine.`

  // Company Brain: reason THROUGH the company's memory. Beliefs (DNA) are hard constraints; learnings
  // and CEO prefs shape the call. This is what turns a generic media-buyer answer into THIS company's.
  let memory = ''
  try { memory = (await recall(admin, { userId, department: 'media' })).prompt } catch { /* memory is best-effort */ }
  const systemWithMemory = memory
    ? `${system}\n\n--- This company's memory (obey the beliefs, use the learnings) ---\n${memory}`
    : system

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const resp = await openai.chat.completions.create({
    model, temperature: 0, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: systemWithMemory }, { role: 'user', content: JSON.stringify(snapshot) }],
  })
  const raw = resp.choices?.[0]?.message?.content || ''
  let parsed: any = {}
  try { parsed = JSON.parse(raw) } catch { return null }
  const answer = String(parsed.answer || '').trim()
  if (!answer) return null
  try { await writeActions(admin, userId, a.currency, parsed.actions, validIds) } catch { /* tasks are best-effort */ }
  return answer + (Array.isArray(parsed.actions) && parsed.actions.length ? ` I've queued ${parsed.actions.length === 1 ? 'that' : 'those'} as one-click action${parsed.actions.length === 1 ? '' : 's'} in your brief — say yes and I'll make the change.` : '')
}

export async function answerAdsQuestion(admin: any, userId: string, message: string, opts?: { brandId?: string | null }): Promise<{ reply: string } | null> {
  if (!isAdsQuestion(message)) return null

  // Resolve the account ONCE (same brand the Brief uses).
  let scopedAccountId: string | undefined = undefined
  try { scopedAccountId = (await resolveBrandScopedAccount(admin, userId, opts?.brandId ?? undefined))?.account_id || undefined } catch { /* fall back to primary */ }

  // COMPARISON ("did we spend more this week than last week?") → fetch BOTH canonical periods and let
  // deterministic code compute the diff + %; the number is never the LLM's job.
  const cmp = parseComparison(message)
  if (cmp) {
    let aA: any = null, aB: any = null
    try { [aA, aB] = await Promise.all([auditAccount(admin, userId, scopedAccountId, cmp.a.preset), auditAccount(admin, userId, scopedAccountId, cmp.b.preset)]) } catch { /* fall through */ }
    if (aA && aB) {
      const reply = buildComparisonAnswer(aA, aB, cmp, aA.currency || 'USD')
      try { console.log('[mello:metric]', JSON.stringify({ userId, account: aA.selected, brandId: opts?.brandId ?? null, metric: cmp.metric, compare: [cmp.a.preset, cmp.b.preset] })) } catch { /* debug */ }
      return { reply: `${reply}\n\n_Meta Ads · ${aA.accountName || 'your account'} · ${cmp.a.label} vs ${cmp.b.label} · live audit_` }
    }
  }

  // CANONICAL CONTRACT: resolve the exact (metric × period) the question names, so the number matches
  // its own claim and the Brief. Period → native Meta preset; default last_30d (the brief's own window).
  const period = parsePeriod(message) || DEFAULT_PERIOD
  const metric = parseMetric(message)

  // Audit the ACTIVE BRAND's account (scopedAccountId resolved above with the explicit brandId) for the
  // exact period — the #1 "brief right, Mello wrong" cause was resolving from the cookie/primary here.
  let a: any = null
  try { a = await auditAccount(admin, userId, scopedAccountId, period.preset) } catch { /* safe reply below */ }
  // No-guess guard: if there's no account or no data, say so plainly — never fabricate a number.
  if (!a) return { reply: `You don't have a Meta ad account connected yet — connect one from Settings and I'll audit it every morning and tell you exactly what to scale and pause.` }

  // Provenance — every company number Mello quotes is traceable to its source, the ACTUAL period, and
  // that it's the live audit (same auditAccount the Brief reads). No more silent "last 30 days" label.
  const provenance = `\n\n_Meta Ads · ${a.accountName || 'your account'} · ${period.label} · live audit_`
  try { console.log('[mello:metric]', JSON.stringify({ userId, account: a.selected, brandId: opts?.brandId ?? null, metric: metric ?? 'diagnostic', preset: period.preset, spend: a.spend, roas: a.avgRoas, revenue: a.revenue, purchases: a.purchases })) } catch { /* debug only */ }

  // SPECIFIC single-metric question ("what did we spend yesterday / roas this month / how many purchases")
  // → answer DETERMINISTICALLY from the canonical number for THAT period. Never the LLM (it can misattribute
  // the wrong field/window). buildMetricAnswer returns null only when the field genuinely isn't available.
  if (metric) {
    const built = buildMetricAnswer(a, metric, period)
    if (built) return { reply: built.reply + provenance }
  }

  if (!a.total) return { reply: `I checked ${a.accountName || 'your account'} — no active campaigns with spend ${period.label}, so there's nothing to tune yet. Launch one and I'll start grading it and flag what to scale or cut.` }

  // Diagnostic / open-ended ("how are my ads doing", "what should I do") → the reasoning model over the
  // grounded snapshot for THIS period. Hard-capped; deterministic breakdown is the fallback.
  try {
    const reasoned: string | null = await Promise.race([
      reasonedAnswer(admin, userId, a, period.label),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 22000)),
    ])
    if (reasoned) return { reply: reasoned + provenance }
  } catch { /* fall through to deterministic */ }

  return { reply: deterministicAnswer(a, period.label) + provenance }
}
