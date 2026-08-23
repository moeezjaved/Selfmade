/**
 * Meta ads playbook engine — the on-demand half of the ads department. One engine powers ~10 of the "50
 * paid-ads agents": each generates an account-grounded, advisory brief (never auto-executes). Every
 * playbook is grounded in the REAL account (auditAccount metrics + the health watchdog's flagged issues +
 * the brand), so it references actual numbers, not generic advice. The Weekly Report is fully data-driven.
 *
 * Advisory + honest: these are briefs/checklists the founder acts on; the engine forbids invented numbers.
 */
import { llm } from '@/lib/llm'
import { auditAccount } from '@/lib/meta/audit'
import { checkAdsHealth } from '@/lib/meta/health'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'
import { describeBrand } from '@/lib/geo/understand'

export type PlaybookKind =
  | 'weekly_report' | 'scaling' | 'creative_refresh' | 'asc_setup' | 'retargeting_ladder'
  | 'capi_health' | 'signal_recovery' | 'exclusions' | 'offer_testing' | 'promo_calendar' | 'audience_expansion'

export const PLAYBOOKS: { kind: PlaybookKind; name: string; blurb: string; dataGrounded?: boolean }[] = [
  { kind: 'weekly_report', name: 'Weekly report', blurb: 'A plain-English read of the week + what to do', dataGrounded: true },
  { kind: 'scaling', name: 'Scaling playbook', blurb: 'How to add budget without breaking ROAS' },
  { kind: 'creative_refresh', name: 'Creative refresh brief', blurb: 'What to make next to beat fatigue' },
  { kind: 'asc_setup', name: 'Advantage+ (ASC) setup', blurb: 'The exact ASC campaign structure to launch' },
  { kind: 'retargeting_ladder', name: 'Retargeting ladder', blurb: 'Warm-audience stages + messaging per stage' },
  { kind: 'capi_health', name: 'CAPI / pixel health', blurb: 'Conversions API + event-match checklist' },
  { kind: 'signal_recovery', name: 'Signal recovery', blurb: 'Recover post-iOS signal + match quality' },
  { kind: 'exclusions', name: 'Exclusion lists', blurb: 'Who to exclude so you stop paying twice' },
  { kind: 'offer_testing', name: 'Offer testing plan', blurb: 'Offers to test, ranked by leverage' },
  { kind: 'promo_calendar', name: 'Promo calendar', blurb: 'A 90-day promo + creative calendar' },
  { kind: 'audience_expansion', name: 'Audience expansion', blurb: 'New audiences to open next, safely' },
]

const isKind = (k: any): k is PlaybookKind => PLAYBOOKS.some((p) => p.kind === k)

const PROMPTS: Record<PlaybookKind, string> = {
  weekly_report: 'Write this week\'s ad account report for the founder. Sections: "The week in one line", "What worked", "What slipped", "Do this week" (3-4 concrete actions). Reference the REAL numbers given (spend, ROAS, CTR, CVR, AOV, and any flagged issues). Honest and specific — no fluff, no invented figures.',
  scaling: 'Write a scaling playbook: how to add budget to this account WITHOUT breaking ROAS, given its real metrics. Cover: which campaigns/ad sets can take more, the % step-up cadence, when to duplicate vs raise budget, and the ROAS floor to defend. Ground it in the real numbers.',
  creative_refresh: 'Write a creative-refresh brief to beat fatigue for this account. Given the real frequency/CTR, say how urgent it is, then specify 3-4 new creatives to make (angle, format, hook) that keep the winning angle but reset delivery. No invented performance claims.',
  asc_setup: 'Write the exact Advantage+ Shopping Campaign (ASC) setup for this brand: objective, budget to start (based on their real spend), audience settings, existing-customer cap, how many/which creatives to load, and the read window before judging. Concrete, launch-ready steps.',
  retargeting_ladder: 'Design a retargeting ladder for this brand: the warm-audience stages (e.g. viewers → engagers → ATC → checkout-abandon → past buyers), the message/offer for each stage, and suggested budget split. Concrete, grounded in the brand.',
  capi_health: 'Write a Conversions API + pixel health checklist for this store: verify server events, dedup with the pixel, event-match-quality improvements (which parameters to send), and how to confirm it\'s working. A checklist a founder can actually run.',
  signal_recovery: 'Write a post-iOS signal recovery plan: CAPI + EMQ, aggregated event measurement priorities, first-party data (email/phone) to feed, and how to read attribution honestly after the loss. Concrete steps.',
  exclusions: 'Write the audience exclusion plan so this brand stops paying to reach the same people twice: which audiences to exclude from which campaigns (prospecting vs retargeting vs past buyers), and how to set it up. Concrete.',
  offer_testing: 'Propose an offer-testing plan for this brand ranked by leverage (given their AOV/margin context): 3-5 specific offers to test (bundle, threshold free-ship, first-order, subscription), the hypothesis for each, and how to read the result. No invented numbers.',
  promo_calendar: 'Draft a 90-day promo + creative calendar for this brand: the key moments/promotions, the angle + creative for each, and lead time. Grounded in the category and season.',
  audience_expansion: 'Recommend the next audiences to open for this brand, safely: broad vs interest vs lookalike, the order to test them, budget guardrails, and how to know one is working before scaling. Ground in the brand + real metrics.',
}

export type Playbook = { kind: PlaybookKind; name: string; title: string; sections: { heading: string; items: string[] }[]; grounded: boolean }

export async function generatePlaybook(admin: any, userId: string, brandId: string | null, kind: PlaybookKind): Promise<Playbook | null> {
  if (!isKind(kind)) return null
  const meta = PLAYBOOKS.find((p) => p.kind === kind)!

  // Ground: resolve the brand's account, pull real metrics + the health watchdog's issues + the brand read.
  const acct = await resolveBrandScopedAccount(admin, userId, brandId ?? null).catch(() => null)
  const acctId = (acct as any)?.account_id ? String((acct as any).account_id) : undefined
  const [audit, health, brand] = await Promise.all([
    acctId ? auditAccount(admin, userId, acctId).catch(() => null) : Promise.resolve(null),
    checkAdsHealth(admin, userId, brandId).catch(() => null),
    describeBrand(admin, userId, brandId).catch(() => null),
  ])
  const grounded = !!(audit && (audit as any).spend != null)

  const facts = {
    brand: brand?.category || undefined,
    currency: (audit as any)?.currency || undefined,
    real_metrics: audit ? {
      spend_30d: (audit as any).spend, roas: (audit as any).avgRoas, ctr: (audit as any).ctr,
      cpc: (audit as any).cpc, cpm: (audit as any).cpm, purchases: (audit as any).purchases,
      revenue: (audit as any).revenue, active_ads: Array.isArray((audit as any).ads) ? (audit as any).ads.length : undefined,
    } : 'Meta account not connected — write the playbook generically for this brand and say what you\'d tailor once ads data is connected.',
    flagged_issues: (health?.issues || []).map((i) => ({ kind: i.kind, title: i.title })),
    recent_vs_baseline: health?.recent && health?.baseline ? { ctr_now: health.recent.ctr, ctr_base: health.baseline.ctr, roas_now: health.recent.roas, roas_base: health.baseline.roas, frequency: health.recent.frequency } : undefined,
  }

  const sys = `You are a senior paid-media strategist. ${PROMPTS[kind]}
HARD RULES: use ONLY the real numbers provided — invent NO metrics, spend, or results. Be specific and actionable. Return ONLY JSON: {"title":"...","sections":[{"heading":"...","items":["...","..."]}]}. 2-5 sections, each with 2-6 short concrete items.`

  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1400, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\nACCOUNT:\n${JSON.stringify(facts)}` }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    if (!j?.title || !Array.isArray(j?.sections)) return null
    return {
      kind, name: meta.name, title: String(j.title).slice(0, 180), grounded,
      sections: (j.sections || []).map((s: any) => ({ heading: String(s.heading || ''), items: (s.items || []).map((x: any) => String(x)).slice(0, 8) })).slice(0, 6),
    }
  } catch { return null }
}
