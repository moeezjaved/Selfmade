/**
 * The Growth Plan engine — the structure that turns "grow $10k → $50k" into a concrete, math-backed plan.
 *
 * ONE abstraction: a Lever. Every way to grow is a lever on the same equation — Revenue = Traffic × CVR × AOV.
 * Adding a new flow (SEO, TikTok, email, GEO, bundles…) = adding ONE Lever entry; the math display, the
 * waterfall, and the approve wiring are all shared. That's what lets the plan grow without a rewrite.
 *
 * HONESTY IS THE BACKBONE: every number is derived from the founder's REAL data (CAC, AOV, CVR from Meta) or
 * a clearly-labelled assumption/benchmark, and each lever carries a `confidence` tag. `buildGrowthPlan` is a
 * PURE function over the metrics the route hands it — no I/O, no LLM, easy to reason about and test.
 */

export type Metric = 'traffic' | 'cvr' | 'aov' | 'retention'
export type Confidence = 'measured' | 'estimated' | 'benchmark' | 'test' | 'potential'
export type ActionKind = 'run' | 'connect' | 'soon'

export type Lever = {
  key: string
  name: string
  agent: string            // the owning agent / chain, e.g. "🔍 Research → ✉️ SEO → 🎨 Creative"
  metric: Metric
  live: boolean            // true = computed from real data + actionable now; false = potential, needs a connection
  delta: number            // + revenue / month this lever adds (its estimate)
  deltaText: string        // formatted, e.g. "+$12k"
  confidence: Confidence
  math: MathSeg[]          // the plain-words explanation ({t} runs + {b} bolded numbers)
  flow: string[]           // the visual step chips: "+$40/day" → "~4 sales/day" → "+$400/day" → "+$12k/mo"
  assumption: string       // the honest caveat, in plain words
  action: { kind: ActionKind; label: string; href?: string }
  chain: string            // one line: who does it / how it's tracked
}
export type MathSeg = { t: string; b?: boolean }   // a run of text; b=true → bold (a number the user recognizes)

export type GrowthPlan = {
  currency: string
  metaConnected: boolean
  current: number          // ad-driven revenue / month (labelled ad-driven until Shopify lands)
  goal: number
  gap: number
  levers: Lever[]
  planTotal: number        // sum of the levers' deltas
  projected: number        // current + planTotal
  coveragePct: number      // projected / goal (capped 100 for the bar)
  note?: string
}

export type PlanInput = {
  currency: string
  metaConnected: boolean
  revenueMo: number | null   // ad-driven revenue over the last 30d
  spendMo: number | null
  purchases: number | null
  clicks: number | null
  cac: number | null         // spend / purchases
  aov: number | null         // revenue / purchases
  cvr: number | null         // purchases / clicks (fraction)
  rivalCount: number
  hasShopify: boolean
  hasKlaviyo: boolean
  goal?: number | null
}

const MILES = [10000, 50000, 100000, 250000, 500000, 1000000]
const nextMilestone = (v: number) => MILES.find((m) => m > v) ?? MILES[MILES.length - 1]

const sym = (c: string) => (({ USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[c] || '')
const money = (n: number, c: string) => `${sym(c)}${Math.round(n).toLocaleString()}`
// compact money for the big +delta badges: +$12k, +$1.2k, +$900
const moneyK = (n: number, c: string) => {
  const s = sym(c)
  if (n >= 1000) { const k = n / 1000; return `+${s}${k >= 10 ? Math.round(k) : k.toFixed(1)}k` }
  return `+${s}${Math.round(n)}`
}
const pct = (f: number) => `${(f * 100).toFixed(f * 100 < 10 ? 1 : 0)}%`

export function buildGrowthPlan(inp: PlanInput): GrowthPlan {
  const c = inp.currency || 'USD'
  const current = Math.max(0, Math.round(inp.revenueMo || 0))
  const goal = inp.goal && inp.goal > current ? inp.goal : nextMilestone(current)
  const gap = Math.max(0, goal - current)

  // no Meta = no real math to build on → an honest "connect first" plan
  if (!inp.metaConnected || !inp.cac || !inp.aov || !inp.cac || inp.cac <= 0) {
    return {
      currency: c, metaConnected: !!inp.metaConnected, current, goal, gap,
      levers: [], planTotal: 0, projected: current, coveragePct: 0,
      note: 'Connect your Meta ad account and I’ll build the plan from your real cost-per-sale, order value and conversion rate.',
    }
  }

  const cac = inp.cac!, aov = inp.aov!, cvr = inp.cvr || 0.01
  const roas = aov / cac                          // revenue back per $1 of ad spend
  const dailyNow = Math.max(0, Math.round((inp.spendMo || 0) / 30))
  const levers: Lever[] = []

  // ── 1. SCALE META (Traffic) — measured, live when Meta is connected ──
  {
    const addDaily = Math.max(20, Math.round(dailyNow || 40))          // roughly double today's budget
    const raw = addDaily * 30 * roas
    const delta = Math.min(raw, Math.round(current * 1.2 || raw))       // scaling rarely more than ~doubles cleanly
    const extraSales = Math.max(1, Math.round((addDaily / cac)))
    levers.push({
      key: 'meta_scale', name: 'Scale your Meta ads', agent: '📈 Media agent', metric: 'traffic', live: true,
      delta, deltaText: moneyK(delta, c), confidence: 'measured',
      math: [
        { t: 'Right now, every ' }, { t: money(cac, c), b: true }, { t: ' you spend on ads brings ' }, { t: '1 sale', b: true },
        { t: ' worth ' }, { t: money(aov, c), b: true }, { t: '. That’s money-making — so we spend more. Adding ' },
        { t: `${money(addDaily, c)} a day`, b: true }, { t: ` should bring about ` }, { t: `${extraSales} more sales a day`, b: true }, { t: '.' },
      ],
      flow: [`+${money(addDaily, c)}/day`, `~${extraSales} sales/day`, `+${money(addDaily * roas, c)}/day`, `${moneyK(delta, c)}/mo`],
      assumption: `Assumes your ${money(cac, c)} cost-per-sale holds. I’ll watch how often your audience sees the ads and stop scaling before it slips.`,
      action: { kind: 'run', label: 'Approve & scale →', href: '/campaigns' },
      chain: 'Media agent applies it · weekly forecast vs actual',
    })
  }

  // ── 2. FIX CONVERSION (CVR) — math from real CVR; the fix needs Shopify ──
  {
    const target = Math.min(cvr * 2, 0.03)
    const improve = cvr > 0 ? target / cvr - 1 : 0
    const delta = Math.round(current * improve)
    levers.push({
      key: 'cvr_fix', name: 'Fix your checkout', agent: '🛍️ Store agent', metric: 'cvr', live: false,
      delta, deltaText: moneyK(delta, c), confidence: 'estimated',
      math: [
        { t: 'Out of every ' }, { t: '100', b: true }, { t: ' people who visit, about ' }, { t: `${Math.max(1, Math.round(cvr * 100))}`, b: true },
        { t: ` buy — that’s a ` }, { t: pct(cvr), b: true }, { t: ' rate. The rest leave. Getting to ' }, { t: pct(target), b: true },
        { t: ' means ' }, { t: 'more sales from the exact same traffic', b: true }, { t: ' — with no extra ad spend.' },
      ],
      flow: ['same visitors', `${pct(cvr)} → ${pct(target)} buy`, 'more paid sales', `${moneyK(delta, c)}/mo`],
      assumption: 'The fix is trust + a smoother checkout, modelled on the pages your rivals use. Needs Shopify connected so I can see and fix your store.',
      action: inp.hasShopify ? { kind: 'run', label: 'Approve the fix →', href: '/settings' } : { kind: 'connect', label: 'Connect Shopify to fix →', href: '/settings' },
      chain: 'Store agent audits the store · you approve each change',
    })
  }

  // ── 3. SEO CHAIN (Traffic, organic) — potential from a stated capture assumption ──
  {
    const assumedVisits = 2000
    const delta = Math.round(assumedVisits * cvr * aov / 1)   // visits × buy-rate × order value
    levers.push({
      key: 'seo', name: 'Rank for what your buyers search', agent: '🔍 Research → ✉️ SEO → 🎨 Creative', metric: 'traffic', live: false,
      delta, deltaText: moneyK(delta, c), confidence: 'potential',
      math: [
        { t: 'Your rivals pull thousands of ' }, { t: 'free visits a month', b: true }, { t: ' from people searching things like ' },
        { t: '“quit nicotine.”', b: true }, { t: ' You get almost none. If we capture just ' }, { t: `${assumedVisits.toLocaleString()} visits/mo`, b: true },
        { t: ' and they buy at your ' }, { t: pct(cvr), b: true }, { t: ' rate at ' }, { t: money(aov, c), b: true }, { t: ':' },
      ],
      flow: [`${assumedVisits.toLocaleString()} visits/mo`, `${pct(cvr)} buy`, `${Math.round(assumedVisits * cvr)} sales × ${money(aov, c)}`, `${moneyK(delta, c)}/mo & growing`],
      assumption: 'Three agents chain here: Research finds the keywords rivals rank for → SEO writes the blog → Creative makes the hero image. Compounds monthly. Estimate firms up once we see real search volumes.',
      action: { kind: 'soon', label: 'Unlock keyword data →' },
      chain: 'Research → SEO → Creative · a real growth engine',
    })
  }

  // ── 4. EMAIL / SMS (Retention) — benchmark ──
  {
    const delta = Math.round(current * 0.2)
    levers.push({
      key: 'email', name: 'Win back people who almost bought', agent: '✉️ Growth agent', metric: 'retention', live: false,
      delta, deltaText: moneyK(delta, c), confidence: 'benchmark',
      math: [
        { t: 'Some people add to cart and leave; some buy once and vanish. Two automatic emails — ' }, { t: '“you left something”', b: true },
        { t: ' and ' }, { t: '“come back”', b: true }, { t: ' — typically recover ' }, { t: '15–25%', b: true },
        { t: ' of a store’s revenue, from people you already paid to reach.' },
      ],
      flow: ['abandoned cart', 'winback flow', '15–25% of revenue', `${moneyK(delta, c)}/mo`],
      assumption: 'Runs on autopilot once set up. Needs Klaviyo connected.',
      action: inp.hasKlaviyo ? { kind: 'run', label: 'Set up flows →', href: '/settings' } : { kind: 'connect', label: 'Connect Klaviyo →', href: '/settings' },
      chain: 'Growth agent writes the flows · you approve',
    })
  }

  // ── 5. TIKTOK (Traffic, new channel) — a test-sized bet ──
  {
    const testDaily = 30
    const delta = Math.min(Math.round(testDaily * 30 * roas * 0.5), Math.round(current * 0.5))   // half Meta efficiency, capped
    const rivals = inp.rivalCount > 0 ? `${inp.rivalCount} of your rivals run ads` : 'rivals run ads'
    levers.push({
      key: 'tiktok', name: 'Open a new channel: TikTok', agent: '🔍 Research → 🎨 Creative → 📈 Media', metric: 'traffic', live: false,
      delta, deltaText: moneyK(delta, c), confidence: 'test',
      math: [
        { t: `${rivals} on TikTok right now`, b: true }, { t: ' — a channel you’re not on. We test small (' }, { t: `${money(testDaily, c)}/day`, b: true },
        { t: '). If it converts anywhere near your Meta cost, it’s a whole new revenue stream.' },
      ],
      flow: [`${money(testDaily, c)}/day test`, 'match Meta cost?', 'scale winners', `${moneyK(delta, c)}/mo`],
      assumption: 'Research recons rivals’ TikTok ads → Creative remakes them → Media tests. This is a starting bet, not a promise — no spend until you approve.',
      action: { kind: 'soon', label: 'Explore TikTok →' },
      chain: 'starts with recon — no spend without your yes',
    })
  }

  const planTotal = levers.reduce((s, l) => s + Math.max(0, l.delta), 0)
  const projected = current + planTotal
  const coveragePct = goal > 0 ? Math.min(100, Math.round((projected / goal) * 100)) : 0

  return { currency: c, metaConnected: true, current, goal, gap, levers, planTotal, projected, coveragePct }
}
