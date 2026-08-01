/**
 * The opportunity engine — "What Mello would do." ONE source of truth for the ranked action cards,
 * used by both the Reports narrative and the Morning Brief so they can never drift.
 *
 * Deterministic today (rules over the account's own numbers). Phase 2.5 will feed competitor patterns
 * and creative-fatigue signals in here so the same cards get sharper. Impacts are honest arithmetic
 * (spend/day × 30 × (1 − ROAS), etc.), so every "~+€X/mo" is defensible.
 */
export type OppTone = 'good' | 'warn' | 'bad'
export type Opportunity = { title: string; why: string; impact: string; level: 1 | 2 | 3; href: string; cta: string; tone: OppTone }

export type OppCampaign = { label: string; roas: number; spend: number; conversions: number }
export type OppPlacement = { label: string; roas: number; spend: number }
export type OppInput = {
  roas: number; spend: number; conv: number; days: number
  winners: OppCampaign[]; losers: OppCampaign[]
  bestPl?: OppPlacement | null; worstPl?: OppPlacement | null
  bestAge?: { label: string; roas: number } | null
  bestGender?: { label: string } | null
  segmentEarns?: boolean   // true = the best segment actually converts; false = spend-based early read
}

/** Map a tone to a hex; renderers call this so color lives with the UI, not the data. */
export const oppColor = (t: OppTone) => (t === 'good' ? '#2f7d3a' : t === 'warn' ? '#b7791f' : '#c0392b')

export function computeOpportunities(o: OppInput, fmt: (n: number) => string): Opportunity[] {
  const recs: Opportunity[] = []
  const daysN = Math.max(1, o.days)
  const { roas, spend, conv, winners, losers } = o

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
    recs.push({ title: `Shift budget ${o.worstPl.label} → ${o.bestPl.label}`, why: `${o.bestPl.label} returns ${o.bestPl.roas.toFixed(1)}x; ${o.worstPl.label} only ${o.worstPl.roas.toFixed(1)}x on ${fmt(o.worstPl.spend)}.`, impact: `~+${fmt(shift * (o.bestPl.roas - o.worstPl.roas) / daysN * 30)}/mo`, level: 2, href: '/campaigns', cta: 'Review placements', tone: 'warn' })
  }
  if (o.bestAge && o.bestGender && spend > 0) {
    // Honest copy: only call it "highest-revenue" when it actually earned. Otherwise it's where the
    // spend/reach concentrates — a real early read on the audience, not a converted winner.
    const why = o.segmentEarns
      ? `Your highest-revenue segment. Tightening targeting cuts wasted reach.`
      : `Where most of your reach and budget land — your core audience so far. Tightening toward it cuts wasted spend while you find what converts.`
    recs.push({ title: `Lean into ${o.bestGender.label === 'female' ? 'women' : o.bestGender.label === 'male' ? 'men' : o.bestGender.label} ${o.bestAge.label}`, why, impact: o.segmentEarns ? 'lower CPA' : 'less wasted spend', level: o.segmentEarns && conv >= 10 ? 2 : 1, href: '/m4', cta: 'Target them', tone: 'good' })
  }
  if (winners[0]) {
    recs.push({ title: `Make 3 variations of “${winners[0].label}”`, why: `Winners fatigue. Variations of a proven ad beat cold new concepts.`, impact: 'extends the winner', level: 2, href: '/creative-studio?studio=1', cta: 'Create in Studio', tone: 'good' })
  }
  return recs
}
