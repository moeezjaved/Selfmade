/**
 * Ad-account DIAGNOSIS — reads the connected Meta account's real metrics and says, per metric, what's
 * good and what's bad, in plain English with the fix. Encodes a media-buyer's diagnostic framework
 * (CPM → offer/compliance, CTR → creative, CVR → site, AOV → bundles/upsells, ROAS → the outcome,
 * frequency → audience, creative volume → fatigue). Pure + deterministic so it's unit-testable and free.
 *
 * Honest-or-silent: a metric with no data (null) returns verdict 'unknown' and is not diagnosed. Metrics
 * that need Shopify/TikTok (returning-customer rate, request rate) are intentionally NOT here — Meta alone
 * can't see them; that's a later "connect your store" expansion.
 */

export type AccountMetrics = {
  spend: number
  currency: string
  cpm: number | null        // cost per 1000 impressions
  ctr: number | null        // click-through rate, as a fraction (0.012 = 1.2%)
  cvr: number | null        // conversion rate = purchases / clicks, as a fraction
  aov: number | null        // average order value = revenue / purchases
  roas: number | null       // return on ad spend = revenue / spend
  frequency: number | null  // impressions / reach
  activeCreatives: number | null
}

export type Verdict = 'good' | 'warn' | 'bad' | 'unknown'
export type Diagnosis = {
  key: string
  label: string
  value: string       // formatted for display ("$42", "1.2%", "2.3x")
  verdict: Verdict
  headline: string    // the one-line judgment
  meaning: string     // what it means (framework)
  fix: string         // what to do about it (framework)
}

const pct = (f: number | null) => (f == null ? '—' : `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`)
const money = (n: number | null, cur: string) => (n == null ? '—' : `${cur === 'USD' || !cur ? '$' : cur + ' '}${Math.round(n).toLocaleString()}`)
const mult = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}x`)

// Thresholds tuned to the framework (industry rules of thumb). good / warn boundaries.
export function diagnose(m: AccountMetrics): Diagnosis[] {
  const cur = m.currency || 'USD'
  const out: Diagnosis[] = []

  // CPM — high CPM is usually offer or compliance/messaging, weighted far above site speed.
  out.push({
    key: 'cpm', label: 'CPM (cost per 1,000 views)', value: money(m.cpm, cur),
    verdict: m.cpm == null ? 'unknown' : m.cpm <= 25 ? 'good' : m.cpm <= 50 ? 'warn' : 'bad',
    headline: m.cpm == null ? 'No CPM data yet' : m.cpm <= 25 ? 'Cheap reach — you’re in the compliance zone' : m.cpm <= 50 ? 'Getting expensive to reach people' : 'You’re overpaying to be seen',
    meaning: 'The biggest levers on CPM are your OFFER and message compliance — not site speed. Flagged health/claim keywords or a weak offer spike CPM the most.',
    fix: 'Sharpen the offer (better price / bundle / more value than rivals) and scrub claim-heavy or flagged wording. A stronger offer can drop CPM dramatically.',
  })

  // CTR — low CTR is a creative + messaging problem.
  out.push({
    key: 'ctr', label: 'Click-through rate', value: pct(m.ctr),
    verdict: m.ctr == null ? 'unknown' : m.ctr >= 0.015 ? 'good' : m.ctr >= 0.008 ? 'warn' : 'bad',
    headline: m.ctr == null ? 'No CTR data yet' : m.ctr >= 0.015 ? 'Your ads earn the click' : m.ctr >= 0.008 ? 'Clicks are soft' : 'People scroll past your ads',
    meaning: 'Low CTR = a creative + messaging problem. The ad isn’t calling out the right person or promise.',
    fix: 'Make better creatives: call out the audience directly, add UGC/video, features + benefits, review-based and more ad formats. Get CTR up with a low CPM and your top-of-funnel is healthy.',
  })

  // Conversion rate — with good CTR + CPM, low CVR points to the SITE, not the ads.
  out.push({
    key: 'cvr', label: 'Conversion rate', value: pct(m.cvr),
    verdict: m.cvr == null ? 'unknown' : m.cvr >= 0.025 ? 'good' : m.cvr >= 0.012 ? 'warn' : 'bad',
    headline: m.cvr == null ? 'No conversion data yet' : m.cvr >= 0.025 ? 'The site closes the sale' : m.cvr >= 0.012 ? 'The site is leaking sales' : 'Traffic lands but doesn’t buy',
    meaning: 'If CTR is high and CPM is low but conversion is low, it’s a SITE issue, not an ads issue — or shipping cost, or something broken at checkout.',
    fix: 'Tighten the product page: 3 clear bullets, 5–7 callout images, move everything above the fold, default subscribe-and-save, add payment options (Apple/Google Pay, BNPL), and check shipping cost + a broken/covered checkout button.',
  })

  // AOV — the fastest ROAS lever. Below ~$35 is very hard to scale.
  out.push({
    key: 'aov', label: 'Average order value', value: money(m.aov, cur),
    verdict: m.aov == null ? 'unknown' : m.aov >= 60 ? 'good' : m.aov >= 35 ? 'warn' : 'bad',
    headline: m.aov == null ? 'No order-value data yet' : m.aov >= 60 ? 'Every order pulls its weight' : m.aov >= 35 ? 'Room to raise order value' : 'Order value too low to scale',
    meaning: 'AOV is the fastest ROAS lever: double AOV and ROAS doubles without changing a single ad. Below ~$35 it’s almost impossible to scale profitably.',
    fix: 'Add bundles, upsells and cross-sells (in-cart, on-site, popup, pre-built bundles) and free-shipping thresholds just above your AOV so a small add gets them over the line.',
  })

  // ROAS — the outcome. Low ROAS with healthy CTR/CPM/CVR = an AOV problem (money per customer).
  out.push({
    key: 'roas', label: 'Return on ad spend', value: mult(m.roas),
    verdict: m.roas == null ? 'unknown' : m.roas >= 2.5 ? 'good' : m.roas >= 1.4 ? 'warn' : 'bad',
    headline: m.roas == null ? 'No ROAS data yet' : m.roas >= 2.5 ? 'Ads are paying for themselves' : m.roas >= 1.4 ? 'Thin margins on ad spend' : 'Ads are losing money',
    meaning: 'ROAS is downstream of everything else. If CTR + CPM + CVR look fine but ROAS is low, the culprit is usually AOV (money per customer) or reaching the same buyers over and over.',
    fix: 'Raise AOV first (fastest lever). If ROAS is falling as you scale, it’s creative fatigue/velocity or high frequency — segment out existing customers so spend chases NEW buyers, not the same list.',
  })

  // Frequency — high frequency oversaturates; add retargeting / expand / segment.
  out.push({
    key: 'frequency', label: 'Frequency', value: m.frequency == null ? '—' : `${m.frequency.toFixed(1)}x`,
    verdict: m.frequency == null ? 'unknown' : m.frequency <= 2 ? 'good' : m.frequency <= 3.5 ? 'warn' : 'bad',
    headline: m.frequency == null ? 'No frequency data yet' : m.frequency <= 2 ? 'Fresh reach — not oversaturated' : m.frequency <= 3.5 ? 'Hitting the same people a lot' : 'You’re burning out your audience',
    meaning: 'High frequency means the same people see the ad over and over — it inflates returning-customer sales and flattens growth.',
    fix: 'Add a retargeting campaign (Meta then self-adjusts and lowers prospecting frequency), expand or consolidate audiences, and segment out existing customers so prospecting chases new people.',
  })

  // Creative volume — too few active creatives = fatigue as you scale.
  out.push({
    key: 'creatives', label: 'Active creatives', value: m.activeCreatives == null ? '—' : String(m.activeCreatives),
    verdict: m.activeCreatives == null ? 'unknown' : m.activeCreatives >= 15 ? 'good' : m.activeCreatives >= 8 ? 'warn' : 'bad',
    headline: m.activeCreatives == null ? 'No creative data yet' : m.activeCreatives >= 15 ? 'Healthy creative volume' : m.activeCreatives >= 8 ? 'Low creative volume for scaling' : 'Too few creatives — fatigue incoming',
    meaning: 'Spend burns through creatives faster the higher you scale. Too few, or the same angle repeated, and ROAS fatigues and falls.',
    fix: 'Raise creative velocity — new creatives every week in a dedicated TESTING campaign, rotate winners into the scale campaign, cut losers. More formats and personas, not the same angle repeated.',
  })

  return out
}

// The single biggest lever — the framework's cross-metric read, so the report can LEAD with one verdict.
export function biggestLever(m: AccountMetrics, d: Diagnosis[]): { headline: string; detail: string } {
  const bad = d.find((x) => x.verdict === 'bad')
  // Classic combo: healthy top-of-funnel but low ROAS → it's AOV (money per customer).
  if (m.roas != null && m.roas < 1.8 && (m.ctr ?? 0) >= 0.012 && (m.cpm ?? 999) <= 40 && (m.aov ?? 999) < 45) {
    return { headline: 'Your biggest lever is order value (AOV)', detail: 'Your ads work — cheap reach, strong clicks — but ROAS is held back by how little each order is worth. Bundles + upsells to lift AOV is the fastest fix, no ad changes needed.' }
  }
  // Healthy clicks + cheap reach but low conversion → the site.
  if ((m.ctr ?? 0) >= 0.012 && (m.cpm ?? 999) <= 40 && (m.cvr ?? 1) < 0.012) {
    return { headline: 'Your biggest lever is the website', detail: 'Cheap reach and strong clicks, but people aren’t buying — that’s a site/checkout problem, not an ads problem. Fix the product page, payment options and shipping.' }
  }
  if (bad) return { headline: bad.headline, detail: `${bad.meaning} ${bad.fix}` }
  const warn = d.find((x) => x.verdict === 'warn')
  if (warn) return { headline: warn.headline, detail: `${warn.meaning} ${warn.fix}` }
  return { headline: 'Your account is healthy', detail: 'No red flags across CPM, CTR, conversion, AOV, ROAS, frequency or creative volume — now it’s about scaling creative velocity and volume.' }
}
