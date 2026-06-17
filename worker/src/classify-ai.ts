/**
 * AI classification (Claude) — fills hook_type / emotion / angle / cta / tone /
 * persona / desire / usp for ads, powering the brand-profile tabs (Hooks,
 * Personas, Ad angles, USPs). Runs in batches of 25 until the backlog is clear.
 *
 *   npx tsx src/classify-ai.ts               # full run
 *   npx tsx src/classify-ai.ts --max-batches=2   # test (50 ads)
 */
import { supabase } from './db.js'

const KEY = process.env.ANTHROPIC_API_KEY!
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const BATCH = 25

const maxArg = process.argv.find(a => a.startsWith('--max-batches='))
const MAX_BATCHES = maxArg ? parseInt(maxArg.split('=')[1], 10) : Infinity

let totalTokensIn = 0, totalTokensOut = 0

// Strip lone/unpaired surrogates (corrupted emoji etc.) — they make JSON.stringify
// emit invalid JSON that the Anthropic API rejects, stalling the whole batch.
const clean = (s: any) => String(s || '').replace(/[\uD800-\uDFFF]/g, '')

async function classifyBatch(ads: any[]): Promise<number> {
  const adsText = ads.map((ad, i) =>
    `AD ${i + 1} [${ad.ad_id}]:\nBrand: ${clean(ad.page_name)}\nHeadline: ${clean(ad.title)}\nBody: ${clean(ad.body).slice(0, 400)}`
  ).join('\n\n---\n\n')

  const prompt = `Analyze these ${ads.length} ads and classify each one. Return a JSON array only, no explanation.

For each ad return:
{
  "ad_id": "...",
  "hook_type": one of: "Question|Before & After|Testimonial|Story|Announcement|Educational|Urgency|Discount|Unboxing|Us vs Them|Social Proof|Pain Point",
  "emotion": array of 1-3 from: ["curiosity","fear","desire","trust","urgency","hope","excitement","relatability","aspiration","guilt","pride"],
  "angle": one of: "Pain Point|Aspiration|Social Proof|Authority|Scarcity|Curiosity|Value|Story|Comparison",
  "cta": the call-to-action text or "Shop Now" if unclear,
  "tone": one of: "Casual|Professional|Urgent|Inspirational|Humorous|Educational|Emotional",
  "persona": brief target audience description (max 5 words),
  "desire": core desire being addressed (max 5 words),
  "usp": main unique selling point (max 8 words)
}

Ads to classify:
${adsText}

Return only the JSON array.`

  let data: any
  while (true) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    })
    data = await res.json()
    if (data.error && /rate.?limit|overloaded|429|529/i.test(data.error.message || '')) {
      await new Promise(r => setTimeout(r, 20000)); continue
    }
    break
  }
  if (data.error) { console.warn('  anthropic error:', data.error.message); return 0 }
  totalTokensIn += data.usage?.input_tokens || 0
  totalTokensOut += data.usage?.output_tokens || 0

  const text = data.content?.[0]?.text || ''
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return 0
  let cls: any[]
  try { cls = JSON.parse(m[0]) } catch { return 0 }

  for (const c of cls) {
    if (!c.ad_id) continue
    await (supabase as any).from('discovery_ads_index').update({
      hook_type: c.hook_type, emotion: c.emotion || [], angle: c.angle, cta: c.cta,
      tone: c.tone, persona: c.persona, desire: c.desire, usp: c.usp, ai_classified: true,
    }).eq('ad_id', c.ad_id)
  }
  return cls.length
}

async function main() {
  console.log(`AI classify — model=${MODEL}, batch=${BATCH}, maxBatches=${MAX_BATCHES}`)
  let done = 0, batches = 0, fails = 0
  while (batches < MAX_BATCHES) {
    const { data: ads } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title')
      .not('ai_classified', 'is', true)
      .not('body', 'is', null)
      .neq('body', '')
      .limit(BATCH)
    if (!ads?.length) { console.log('  no more unclassified ads.'); break }
    const n = await classifyBatch(ads)
    done += n; batches++
    // Breaker: if a batch makes no progress (API/parse failure), don't loop on the
    // same ads forever. Log the offending ids and stop after a few consecutive misses.
    if (n === 0) {
      fails++
      console.warn(`  ⚠️ batch ${batches} classified 0 — ad_ids: ${ads.map((a: any) => a.ad_id).join(',')}`)
      if (fails >= 5) { console.error('  aborting after 5 consecutive failed batches.'); break }
    } else { fails = 0 }
    await new Promise(r => setTimeout(r, 400))  // gentle on rate limits
    // Haiku 4.5 pricing ≈ $1/M input, $5/M output
    const cost = (totalTokensIn / 1e6) * 1 + (totalTokensOut / 1e6) * 5
    console.log(`  batch ${batches}: +${n} (total ${done}) | tokens in=${totalTokensIn} out=${totalTokensOut} | est $${cost.toFixed(3)}`)
  }
  const cost = (totalTokensIn / 1e6) * 1 + (totalTokensOut / 1e6) * 5
  console.log(`✅ classified ${done} ads | est cost $${cost.toFixed(2)}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
