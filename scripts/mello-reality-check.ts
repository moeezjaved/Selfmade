/**
 * Mello Reality Check (Phase 2.2 — Mello State Truth)
 *
 * Every question Mello answers about the company's OWN state (plan, integrations, competitors) must be
 * answered from application state, NOT the language model. This harness asserts the SOURCE OF TRUTH and
 * the routing for that class of questions — the exact failures the founder reported:
 *   #1 "how do I connect my Meta ad account" → false "Creator (paid) feature" to an existing Creator
 *   #2 "look at my competitors' messaging"   → "no active ads" for competitors that HAVE ads
 *   #3 "compare my offer vs competitors"     → hijacked into a "$49/mo … Go full-time" upsell
 *   #4 "what is my current plan"             → "You're on the Free plan" to a Creator
 *
 * DETERMINISTIC MODE (default, no DB): tests classifyIntent + the state-aware productHowTo with mock
 * MelloContext state — proves the pipeline reads state and routes correctly. Runs anywhere:
 *     npx tsx scripts/mello-reality-check.ts
 *
 * LIVE MODE (optional): with MELLO_TEST_USER + Supabase env set, calls the real askMello and prints
 * expected-source → actual-path → answer per question. See runLive() at the bottom.
 */
import { classifyIntent, productHowTo } from '@/lib/mello/intent'
import type { MelloStateLite } from '@/lib/mello/context'

const CREATOR_CONNECTED: MelloStateLite = { plan: { isPaid: true, label: 'Creator' }, meta: { connected: true, accountName: 'Aura' } }
const CREATOR_NOMETA: MelloStateLite = { plan: { isPaid: true, label: 'Creator' }, meta: { connected: false } }
const FREE: MelloStateLite = { plan: { isPaid: false, label: 'Free' }, meta: { connected: false } }

type Check = {
  name: string
  q: string
  state?: MelloStateLite
  intent?: string                 // expected classifyIntent
  source: string                  // the expected source of truth (documentation)
  contains?: string[]             // productHowTo answer MUST contain each
  notContains?: string[]          // productHowTo answer MUST NOT contain any
  answerNull?: boolean            // productHowTo MUST return null (routes elsewhere)
}

const CHECKS: Check[] = [
  // ── Bug #4 — plan truth ────────────────────────────────────────────────
  { name: 'Creator asks current plan → Creator, not Free', q: 'what is my current plan', state: CREATOR_CONNECTED,
    source: 'Subscription (getEntitlements)', contains: ['Creator'], notContains: ['Free plan', '$49/mo', 'upgrade'] },
  { name: 'Creator asks "what plan am I on?" → not an upsell', q: 'what plan am I on?', state: CREATOR_CONNECTED,
    source: 'Subscription', contains: ['Creator'], notContains: ['Free plan', 'Go full-time'] },
  { name: 'Free asks current plan → Free (honest)', q: 'what is my current plan', state: FREE,
    source: 'Subscription', contains: ['Free plan'] },
  { name: 'plan question routes to product_help (deterministic), not general/LLM', q: 'what is my current plan',
    source: 'router', intent: 'product_help' },

  // ── Bug #1 — Meta connect how-to (state-aware) ─────────────────────────
  { name: 'Creator + not connected → real connect path, NO false paid-gate', q: 'how may i connect my meta ad account', state: CREATOR_NOMETA,
    source: 'Integrations + Subscription', contains: ['Connect Meta'], notContains: ['paid feature', 'upgrade to Creator', 'Creator (paid)'] },
  { name: 'Creator + already connected → says already connected + account', q: 'how do I connect meta', state: CREATOR_CONNECTED,
    source: 'Integrations', contains: ['already connected', 'Aura'], notContains: ['upgrade', 'paid feature'] },
  { name: 'Free asks connect Meta → honest paid gate ($49 Creator)', q: 'how do I connect my meta account', state: FREE,
    source: 'Subscription', contains: ['Creator', '$49'] },

  // ── Bug #3 — offer comparison must NOT hit the upsell ──────────────────
  { name: 'offer comparison is NOT product-help (routes to competitor)', q: 'Compare my offer (pricing, guarantee, bundle, shipping) against competitors and tell me where I am weaker or stronger', state: CREATOR_CONNECTED,
    source: 'competitor pipeline', answerNull: true },
  { name: 'offer comparison classifies as competitor', q: 'Compare my offer against my competitors', source: 'router', intent: 'competitor' },
  { name: 'pricing-vs-rivals does not upsell', q: 'how does my pricing compare to competitors?', state: CREATOR_CONNECTED,
    source: 'competitor pipeline', answerNull: true },

  // ── Bug #2 — competitor research routes to the competitor pipeline ─────
  { name: 'competitor messaging-angles → competitor intent', q: 'Look at the messaging angles my competitors are running in their ads and tell me which ones I am not testing yet', source: 'discovery_ads_index (by page_id)', intent: 'competitor' },

  // ── Upsell hygiene — never pitch a plan a paid user owns ───────────────
  { name: 'Creator asks how to upgrade → already on it, no pitch', q: 'how do I upgrade my plan', state: CREATOR_CONNECTED,
    source: 'Subscription', contains: ['already on'], notContains: ['$49'] },
  { name: 'Free asks how to upgrade → real upsell', q: 'how do I upgrade', state: FREE,
    source: 'Subscription', contains: ['$49'] },

  // ── Product help that is genuinely plan-blind stays correct ────────────
  { name: 'add a competitor (Creator) → no "Free tracks 1" nag', q: 'how do I add a competitor', state: CREATOR_CONNECTED,
    source: 'Product help', contains: ['Add a competitor'], notContains: ['Free tracks 1'] },
  { name: 'cancel subscription still works', q: 'how do I cancel my subscription', state: CREATOR_CONNECTED,
    source: 'Product help', contains: ['Cancel subscription'] },
]

function run(): number {
  let pass = 0, fail = 0
  const rows: string[] = []
  for (const c of CHECKS) {
    const problems: string[] = []
    if (c.intent) {
      const got = classifyIntent(c.q)
      if (got !== c.intent) problems.push(`intent: expected ${c.intent}, got ${got}`)
    }
    if (c.answerNull || c.contains || c.notContains) {
      const ans = productHowTo(c.q, c.state)
      if (c.answerNull) { if (ans !== null) problems.push(`expected null (route away), got: "${(ans || '').slice(0, 60)}…"`) }
      else {
        if (ans === null) problems.push('productHowTo returned null (expected an answer)')
        else {
          for (const s of (c.contains || [])) if (!ans.toLowerCase().includes(s.toLowerCase())) problems.push(`missing "${s}"`)
          for (const s of (c.notContains || [])) if (ans.toLowerCase().includes(s.toLowerCase())) problems.push(`must NOT contain "${s}"`)
        }
      }
    }
    const ok = problems.length === 0
    ok ? pass++ : fail++
    rows.push(`${ok ? '✅' : '❌'} ${c.name}\n     source-of-truth: ${c.source}${ok ? '' : `\n     ✗ ${problems.join(' · ')}`}`)
  }
  console.log('\n── Mello Reality Check ─────────────────────────────────────\n')
  console.log(rows.join('\n'))
  console.log(`\n${pass}/${pass + fail} passed${fail ? ` · ${fail} FAILED` : ' · all green'}\n`)
  return fail
}

/**
 * LIVE MODE — run the real pipeline against a seeded account and print the truth table.
 * Requires SUPABASE_URL/SERVICE_ROLE + MELLO_TEST_USER (a real user id) in env.
 *   MELLO_TEST_USER=<uuid> npx tsx scripts/mello-reality-check.ts --live
 */
async function runLive() {
  const userId = process.env.MELLO_TEST_USER
  if (!userId) { console.error('LIVE mode needs MELLO_TEST_USER=<user-uuid>'); process.exit(2) }
  const { createAdminClient } = await import('@/lib/supabase/server')
  const { askMello } = await import('@/lib/mello/ask')
  const { loadMelloContext } = await import('@/lib/mello/context')
  const admin = createAdminClient()
  const ctx = await loadMelloContext(admin, userId)
  console.log('\n── MelloContext snapshot ───────────────────────────────────')
  console.log(ctx.prompt)
  console.log('\nprovenance:', ctx.provenance.join(', '))
  const qs = [
    'what is my current plan',
    'how may i connect my meta ad account',
    'Compare my offer (pricing, guarantee, bundle, shipping) against competitors and tell me where I am weaker or stronger',
    'Look at the messaging angles my competitors are running in their ads and tell me which ones I am not testing yet',
  ]
  console.log('\n── Live answers ────────────────────────────────────────────')
  for (const q of qs) {
    const { reply } = await askMello(admin, userId, q)
    console.log(`\nQ: ${q}\nA: ${reply}`)
  }
  console.log('')
}

if (process.argv.includes('--live')) runLive().catch(e => { console.error(e); process.exit(1) })
else process.exit(run())
