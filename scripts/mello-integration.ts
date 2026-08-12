/**
 * Mello INTEGRATION tests — run the real answerGrounded pipeline end-to-end against a fake Supabase
 * client (no network, no LLM), proving the whole grounded layer routes and answers from data — not just
 * that the classifier labels intents. Covers the deterministic branches; LLM branches (teach/ads/brain)
 * are proven by routing in mello-tests.ts. Run:  npx tsx scripts/mello-integration.ts
 */
import { answerGrounded } from '@/lib/mello/grounded'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }

// Minimal chainable/thenable fake of the Supabase query builder used by answerGrounded.
function makeAdmin(seed: Record<string, any[]>) {
  const from = (table: string) => {
    let rows = (seed[table] || []).slice()
    let countMode = false
    const b: any = {
      select: (_cols?: any, opts?: any) => { if (opts && opts.count) countMode = true; return b },
      eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return b },
      in: (col: string, vals: any[]) => { rows = rows.filter((r) => vals.includes(r[col])); return b },
      order: () => b, limit: () => b, gte: () => b, not: () => b, or: () => b,
      insert: () => ({ then: (res: any) => res({ data: null, error: null }), select: () => ({ single: () => Promise.resolve({ data: { id: 'x' } }) }) }),
      single: () => Promise.resolve({ data: rows[0] || null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
      // awaiting the builder resolves to {count} in count-mode, else {data}
      then: (res: any) => res(countMode ? { count: rows.length, error: null } : { data: rows, error: null }),
    }
    return b
  }
  return { from }
}

const USER = 'u1', BRAND = 'b1'
const withFollows = makeAdmin({
  followed_brands: [
    { user_id: USER, brand_id: BRAND, brand_name: 'Sterone', spied: true, page_id: 'p1' },
    { user_id: USER, brand_id: BRAND, brand_name: 'NovaMane', spied: true, page_id: 'p2' },
  ],
  // 3 competitor ads crawled (page_id in {p1,p2}) — the "ads read overnight" number.
  discovery_ads_index: [
    { ad_id: 'a1', page_id: 'p1' }, { ad_id: 'a2', page_id: 'p2' }, { ad_id: 'a3', page_id: 'p1' },
    { ad_id: 'a4', page_id: 'zz' }, // a different brand's page — must be excluded by scope
  ],
})
const noFollows = makeAdmin({ followed_brands: [] })

console.log('\nMELLO INTEGRATION TESTS\n')

async function main() {
  // I1 — product help answers from the product layer, mentions no watched competitor.
  {
    const r: any = await answerGrounded(withFollows, USER, 'How do I add a competitor?', { brandId: BRAND })
    ok('I1 handled', r.handled === true)
    ok('I1 intent product_help', r.intent === 'product_help')
    ok('I1 no competitor leaked into product help', r.handled && !/sterone|novamane/i.test(r.reply), r.handled ? r.reply.slice(0, 60) : '')
  }

  // I2 — "who am I watching" lists the brand's OWN watched competitors, from data.
  {
    const r: any = await answerGrounded(withFollows, USER, 'who am I watching?', { brandId: BRAND })
    ok('I2 handled', r.handled === true)
    ok('I2 lists both watched brands', r.handled && /Sterone/.test(r.reply) && /NovaMane/.test(r.reply), r.handled ? r.reply.slice(0, 80) : '')
    ok('I2 sourced from watched brands', r.handled && r.sources.includes('Watched brands'))
  }

  // I3 — no competitors yet → the add-a-competitor nudge, not a made-up answer.
  {
    const r: any = await answerGrounded(noFollows, USER, 'who are my competitors?', { brandId: BRAND })
    ok('I3 handled', r.handled === true)
    ok('I3 says not watching any yet', r.handled && /not watching any/i.test(r.reply))
  }

  // I4 — a general/creative ask escalates to the agent WITH brand-scoped competitor context in watchLine
  //      (so the agent sees this brand's rivals, and only this brand's — no unrelated leak).
  {
    const r: any = await answerGrounded(withFollows, USER, 'make me a fresh ad concept for launch', { brandId: BRAND })
    ok('I4 escalates (handled=false)', r.handled === false)
    ok('I4 carries scoped competitor context', !r.handled && /Sterone/.test(r.watchLine) && /NovaMane/.test(r.watchLine), !r.handled ? r.watchLine.slice(0, 80) : '')
    ok('I4 brand preserved', !r.handled && r.brandId === BRAND)
  }

  // I5 — brief↔chat stat parity: "how many competitor ads did we analyze" reads the SAME scoped count
  //      the brief renders (3 ads on p1/p2, the p-zz ad excluded by brand scope).
  {
    const r: any = await answerGrounded(withFollows, USER, 'how many competitor ads did we analyze overnight?', { brandId: BRAND })
    ok('I5 handled', r.handled === true)
    ok('I5 uses the shared ads-read count (3)', r.handled && /\b3\b/.test(r.reply), r.handled ? r.reply.slice(0, 80) : '')
    ok('I5 sourced from ads-read-overnight', r.handled && r.sources.includes('Ads read overnight'))
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}
main()
