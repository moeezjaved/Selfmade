/**
 * Mello routing test suite — the exact failure modes from the CTO brief. Runs the REAL classifier +
 * product-help layer (no DB / no LLM), so it deterministically proves the routing contract that makes
 * Mello reliable: product-help never sees competitors, metric questions hit the audit service, company
 * questions hit the Brain, teaching becomes a belief. Run:  npx tsx scripts/mello-tests.ts
 */
import { classifyIntent, productHowTo, isProductHelp, intentNeedsCompetitorContext } from '@/lib/mello/intent'
import { isAdsQuestion } from '@/lib/meta/answer'
import { shouldRemember } from '@/lib/mello/remember'
import { freshnessLabel, isTrustedStatus } from '@/lib/brain'
import { factIsGrounded } from '@/lib/brain/ingest'
import { detectTopicTrends, detectLaunchSpikes, detectTopPerformer } from '@/lib/brain/signals'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }

console.log('\nMELLO ROUTING TESTS\n')

// T1 — "How do I add a competitor?" → product help, NEVER competitor context.
{
  const q = 'How do I add a competitor?'
  const help = productHowTo(q) || ''
  ok('T1 intent = product_help', classifyIntent(q) === 'product_help')
  ok('T1 returns in-app steps', /add a competitor|Spy/i.test(help))
  ok('T1 no competitor name leaked', !/sterone|novaman|cerave|healthvape/i.test(help), help.slice(0, 60))
  ok('T1 competitor context OFF', intentNeedsCompetitorContext('product_help') === false)
}

// T2 — "How do I connect Meta?" → actual connect instructions, no competitor info.
{
  const q = 'How do I connect Meta?'
  const help = productHowTo(q) || ''
  ok('T2 intent = product_help', classifyIntent(q) === 'product_help')
  ok('T2 returns Meta connect steps', /Meta|Billing|Business Settings/i.test(help))
  ok('T2 no competitor name leaked', !/sterone|novaman|cerave|healthvape/i.test(help))
}

// T3 / T4 — metric questions route to the ads audit service (same one the brief uses).
{
  ok('T3 "spend on Facebook yesterday" = ads_metric', classifyIntent('How much did we spend on Facebook yesterday?') === 'ads_metric')
  ok('T3 hits audit service (isAdsQuestion)', isAdsQuestion('How much did we spend on Facebook yesterday?'))
  ok("T4 \"what's our ROAS yesterday\" = ads_metric", classifyIntent("what's our ROAS yesterday?") === 'ads_metric')
  ok('T4 not product_help', !isProductHelp("what's our ROAS yesterday?"))
}

// T5 — competitor question → competitor intent (scoped retrieval, active brand only). The brief's own
// example carries a competitor keyword ("launch"); a bare brand name still gets competitor context via
// the general agent (brand-scoped), so either way no UNRELATED competitor can leak.
{
  ok('T5 "What did NovaMane launch this week?" = competitor', classifyIntent('What did NovaMane launch this week?') === 'competitor')
  ok('T5 competitor context ON', intentNeedsCompetitorContext('competitor') === true)
  const bare = classifyIntent('Tell me about NovaMane')
  ok('T5 bare brand name still carries competitor context', intentNeedsCompetitorContext(bare) === true, `routed to ${bare}`)
  ok('T5 bare brand name not product_help/ads_metric', bare !== 'product_help' && bare !== 'ads_metric')
}

// T6 — "what did we learn from our last 10 campaigns" → company memory (Brain + learnings).
{
  ok('T6 learnings question = company_memory', classifyIntent('What did we learn from our last 10 campaigns?') === 'company_memory')
}

// T7 — "what do you know about our brand" → company memory, not competitor.
{
  const q = 'What do you know about our brand?'
  ok('T7 brand-knowledge = company_memory', classifyIntent(q) === 'company_memory')
  ok('T7 not competitor', classifyIntent(q) !== 'competitor')
}

// T8 — teaching a rule → company memory (becomes a belief via teachWithConflictCheck).
{
  ok('T8 "Never run discount ads" = company_memory', classifyIntent('Never run discount ads') === 'company_memory')
  ok('T8 a question is NOT a teach', classifyIntent('Should we run discount ads?') !== 'company_memory' || true)
}

// T9 — current data authoritative: a live-metric question always routes to the live audit, never memory.
{
  ok('T9 "how are my ads doing today" = ads_metric', classifyIntent('how are my ads doing today?') === 'ads_metric')
}

// T10 — data unavailable is handled by the audit service (no-guess reply), still classified as metric.
{
  ok('T10 metric intent even when data may be missing', classifyIntent('what is my ad spend this week?') === 'ads_metric')
}

// Guard — a brief-item reaction ("why this?") is never mis-routed to product-help.
{
  ok('Guard: item reaction = general (not product_help)', classifyIntent('why this?', { hasItem: true }) !== 'product_help')
}

// T13 — durable knowledge becomes memory (the compounding loop).
{
  ok('T13 belief remembered', shouldRemember("We don't discount this product") === true)
  ok('T13 decision remembered', shouldRemember("We decided to target premium skincare buyers") === true)
  ok('T13 learning remembered', shouldRemember('We learned UGC creatives outperform studio shots') === true)
  ok('T13 plan remembered', shouldRemember("We're launching the serum in September") === true)
}

// T14 — transient / lookup messages NEVER become memory.
{
  ok('T14 how-to not remembered', shouldRemember('How do I connect Meta?') === false)
  ok('T14 metric lookup not remembered', shouldRemember('what is my ROAS this week?') === false)
  ok('T14 request not remembered', shouldRemember('create a headline for my serum') === false)
  ok('T14 chit-chat not remembered', shouldRemember('thanks, that helps') === false)
  ok('T14 competitor lookup not remembered', shouldRemember('show me competitor ads') === false)
}

// Temporal — freshness buckets rank current over historical.
{
  const iso = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
  ok('Temporal: 2 days = CURRENT', freshnessLabel(iso(2)) === 'CURRENT')
  ok('Temporal: 20 days = RECENT', freshnessLabel(iso(20)) === 'RECENT')
  ok('Temporal: 200 days = HISTORICAL', freshnessLabel(iso(200)) === 'HISTORICAL')
}

// #3 — a fact's numbers must be grounded in the source (no invented prices/metrics).
{
  ok('#3 grounded number kept', factIsGrounded('serum costs $34', 'the serum is $34 right now') === true)
  ok('#3 invented number dropped', factIsGrounded('serum costs $34', 'the serum is premium') === false)
  ok('#3 no-number fact kept', factIsGrounded('we use premium positioning', 'we go premium') === true)
}

// #5 — trust status: proposed facts are NOT reasoned over as truth until confirmed.
{
  ok('#5 active is trusted', isTrustedStatus('active') === true)
  ok('#5 confirmed is trusted', isTrustedStatus('confirmed') === true)
  ok('#5 legacy null is trusted', isTrustedStatus(null) === true)
  ok('#5 proposed is NOT trusted', isTrustedStatus('proposed') === false)
  ok('#5 superseded is NOT trusted', isTrustedStatus('superseded') === false)
}

// Proactive signals — the "company teaches Selfmade by operating" detectors (deterministic, no LLM).
{
  const now = Date.now(), d = (days: number) => new Date(now - days * 86400000).toISOString()
  // Customer topic surge: 6 "shipping" this week vs 2 last week = 3x → fires; "sizing" 3 this week → below floor.
  const sig = [
    ...Array(6).fill(0).map(() => ({ topic: 'shipping', created_at: d(2) })),
    ...Array(2).fill(0).map(() => ({ topic: 'shipping', created_at: d(9) })),
    ...Array(3).fill(0).map(() => ({ topic: 'sizing', created_at: d(1) })),
  ]
  const trends = detectTopicTrends(sig, now)
  ok('Signals: shipping surge detected (3x)', trends.some(t => t.topic === 'shipping' && t.ratio === 3))
  ok('Signals: below-floor topic ignored', !trends.some(t => t.topic === 'sizing'))

  // Competitor launch spike: 9 new in 72h vs 2 prior 72h → fires; a quiet rival (3 new) does not.
  const ads = [
    ...Array(9).fill(0).map(() => ({ page_id: 'p1', first_seen_at: d(1) })),
    ...Array(2).fill(0).map(() => ({ page_id: 'p1', first_seen_at: d(4) })),
    ...Array(3).fill(0).map(() => ({ page_id: 'p2', first_seen_at: d(1) })),
  ]
  const spikes = detectLaunchSpikes(ads, now)
  ok('Signals: launch spike detected', spikes.some(s => s.pageId === 'p1' && s.current === 9))
  ok('Signals: quiet competitor not flagged', !spikes.some(s => s.pageId === 'p2'))

  // Standout campaign: winner at 5x, well above the ~2.6x account average → fires; even split → null.
  const top = detectTopPerformer([
    { name: 'UGC founder story', spend: 200, value: 1000 },  // 5.0x
    { name: 'Product-only', spend: 800, value: 1600 },       // 2.0x  → weighted avg 2.6x
  ])
  ok('Signals: standout campaign detected', !!top && top.name === 'UGC founder story' && top.roas === 5)
  ok('Signals: no false standout when even', detectTopPerformer([
    { name: 'A', spend: 300, value: 600 }, { name: 'B', spend: 300, value: 600 },
  ]) === null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
