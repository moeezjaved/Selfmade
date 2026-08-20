/**
 * The opportunity engine — "What Mello would do." ONE source of truth for the ranked action cards,
 * used by both the Reports narrative and the Morning Brief so they can never drift.
 *
 * Deterministic today (rules over the account's own numbers). Phase 2.5 will feed competitor patterns
 * and creative-fatigue signals in here so the same cards get sharper. Impacts are honest arithmetic
 * (spend/day × 30 × (1 − ROAS), etc.), so every "~+€X/mo" is defensible.
 */
export type OppTone = 'good' | 'warn' | 'bad'
// A structured, one-click action for a card. When present, the brief renders a confirm+act button that
// DUPLICATES the winner (never touches the original — same safety as Scale) tuned to this target.
export type ApplyPlan =
  | { kind: 'audience'; genders: number[]; ageMin: number; ageMax: number; label: string }
  | { kind: 'placement'; platform: string; label: string }
export type Opportunity = { title: string; why: string; impact: string; level: 1 | 2 | 3; href: string; cta: string; tone: OppTone; apply?: ApplyPlan }

export type OppCampaign = { label: string; roas: number; spend: number; conversions: number }
export type OppPlacement = { label: string; roas: number; spend: number }
export type OppInput = {
  roas: number; spend: number; conv: number; days: number
  winners: OppCampaign[]; losers: OppCampaign[]
  bestPl?: OppPlacement | null; worstPl?: OppPlacement | null
  bestAge?: { label: string; roas: number } | null
  bestGender?: { label: string } | null
  // Structured targets for one-click apply (Meta codes). Present only when we could resolve them.
  bestGenderCode?: number | null       // 1 = male, 2 = female (omit "unknown")
  bestAgeRange?: { min: number; max: number } | null
  bestPlatform?: string | null         // publisher_platform of the best placement (e.g. 'facebook')
  segmentEarns?: boolean   // true = the best segment actually converts; false = spend-based early read
  accClicks?: number       // total clicks in range — for the "clicks but no sales" leak diagnosis
  accCtr?: number          // account CTR (%)
  fatigue?: { label: string; frequency: number; spend: number } | null   // an over-served, budget-burning ad
}

/** Map a tone to a hex; renderers call this so color lives with the UI, not the data. */
export const oppColor = (t: OppTone) => (t === 'good' ? '#2f7d3a' : t === 'warn' ? '#b7791f' : '#c0392b')

export function computeOpportunities(o: OppInput, fmt: (n: number) => string): Opportunity[] {
  const recs: Opportunity[] = []
  const daysN = Math.max(1, o.days)
  const { roas, spend, conv, winners, losers } = o

  // ── CONVERSION LEAK — the most important thing to tell a spending-but-not-selling account. People
  // CLICK (real CTR, real clicks) but nobody BUYS (0 conversions). That's not an ad problem — it's the
  // landing page, offer, or checkout. Pausing ads treats the symptom; this names the actual cause.
  // Fires FIRST (top of the list) because it changes what you do with today's budget.
  if (conv === 0 && spend > 0 && (o.accClicks || 0) >= 20) {
    recs.push({
      title: `Clicks, but no sales`,
      why: `${fmt(spend)} spent and ${(o.accClicks || 0).toLocaleString()} clicks${o.accCtr ? ` (${o.accCtr.toFixed(1)}% CTR)` : ''} — but 0 purchases. Your ads work; the drop-off is after the click, on the landing page, offer, or checkout.`,
      impact: `the real blocker`, level: 3, href: '/reports', cta: 'See the funnel', tone: 'bad',
    })
  }

  if (losers[0]) {
    const monthly = (losers[0].spend / daysN) * 30 * (1 - losers[0].roas)
    recs.push({ title: `Pause “${losers[0].label}”`, why: `${fmt(losers[0].spend)} spent → ${losers[0].roas.toFixed(2)}x. Every day it runs, money leaks.`, impact: `saves ~${fmt(monthly)}/mo`, level: losers[0].spend > spend * 0.15 ? 3 : 2, href: '/campaigns', cta: 'Pause it', tone: 'bad' })
  }
  if (winners[0] && winners[0].roas >= 1.5) {
    const extra = (winners[0].spend / daysN) * 30 * 0.2 * winners[0].roas
    recs.push({ title: `Scale “${winners[0].label}” +20%`, why: `${winners[0].roas.toFixed(2)}x vs ${roas.toFixed(2)}x account average — your proven winner has room.`, impact: `~+${fmt(extra)}/mo revenue`, level: winners[0].conversions >= 5 ? 3 : 2, href: '/campaigns', cta: 'Scale it', tone: 'good' })
  }
  if (o.bestPl && o.worstPl && o.bestPl.label !== o.worstPl.label && o.bestPl.roas > o.worstPl.roas * 1.5) {
    const shift = o.worstPl.spend * 0.5
    recs.push({ title: `Shift budget ${o.worstPl.label} → ${o.bestPl.label}`, why: `${o.bestPl.label} returns ${o.bestPl.roas.toFixed(1)}x; ${o.worstPl.label} only ${o.worstPl.roas.toFixed(1)}x on ${fmt(o.worstPl.spend)}.`, impact: `~+${fmt(shift * (o.bestPl.roas - o.worstPl.roas) / daysN * 30)}/mo`, level: 2, href: '/campaigns', cta: 'Review placements', tone: 'warn',
      apply: o.bestPlatform ? { kind: 'placement', platform: o.bestPlatform, label: o.bestPl.label } : undefined })
  }
  // AD FATIGUE — an ad your audience has seen too many times (frequency ≥ 3) is spending on people who
  // already scrolled past it; CPM climbs and CTR fades. A fresh creative resets that. One-click to Studio.
  if (o.fatigue) {
    recs.push({ title: `Refresh “${o.fatigue.label}”`, why: `Your audience has seen it ${o.fatigue.frequency}× — that's fatigue. It's still spending ${fmt(o.fatigue.spend)}, but on people who've scrolled past it. A fresh version resets your cost.`, impact: `reverse rising CPM`, level: o.fatigue.frequency >= 4 ? 3 : 2, href: '/creative-studio?studio=1', cta: 'Make a fresh one', tone: 'warn' })
  }
  if (o.bestAge && o.bestGender && spend > 0) {
    // Honest copy: only call it "highest-revenue" when it actually earned. Otherwise it's where the
    // spend/reach concentrates — a real early read on the audience, not a converted winner.
    const why = o.segmentEarns
      ? `Your highest-revenue segment. Tightening targeting cuts wasted reach.`
      : `Where most of your reach and budget land — your core audience so far. Tightening toward it cuts wasted spend while you find what converts.`
    const label = `${o.bestGender.label === 'female' ? 'women' : o.bestGender.label === 'male' ? 'men' : o.bestGender.label} ${o.bestAge.label}`
    // href → /campaigns (NOT /m4): "Target them" hands off to the Campaigns "Manage with Mello"
    // assistant. The brief renders this via TuneConfirm regardless of `apply`, but pin the href too so a
    // fallback link can never bounce the founder to the M4 wizard.
    recs.push({ title: `Lean into ${label}`, why, impact: o.segmentEarns ? 'lower CPA' : 'less wasted spend', level: o.segmentEarns && conv >= 10 ? 2 : 1, href: '/campaigns', cta: 'Target them', tone: 'good',
      apply: (o.bestGenderCode && o.bestAgeRange) ? { kind: 'audience', genders: [o.bestGenderCode], ageMin: o.bestAgeRange.min, ageMax: o.bestAgeRange.max, label } : undefined })
  }
  if (winners[0]) {
    recs.push({ title: `Make 3 variations of “${winners[0].label}”`, why: `Winners fatigue. Variations of a proven ad beat cold new concepts.`, impact: 'extends the winner', level: 2, href: '/creative-studio?studio=1', cta: 'Create in Studio', tone: 'good' })
  }
  // Highest-confidence / biggest-impact first (stable — ties keep the logical order above), so the
  // top 3 the brief shows are always the moves that matter most.
  return recs.sort((a, b) => b.level - a.level)
}
