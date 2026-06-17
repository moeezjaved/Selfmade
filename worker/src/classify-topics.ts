/**
 * Topical tagging (Claude) — tags each ad with normalized topic keywords so
 * topic search ("hair loss") catches every related ad regardless of wording
 * (thinning, regrow, balding…). Writes the `topics` text[] column. Independent
 * of the hook/persona classifier (different column), safe to run concurrently.
 *
 *   npx tsx src/classify-topics.ts [--max-batches=N]
 */
import { supabase } from './db.js'

const KEY = process.env.ANTHROPIC_API_KEY!
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const BATCH = 25
const maxArg = process.argv.find(a => a.startsWith('--max-batches='))
const MAX_BATCHES = maxArg ? parseInt(maxArg.split('=')[1], 10) : Infinity
const clean = (s: any) => String(s || '').replace(/[\uD800-\uDFFF]/g, '')

let tIn = 0, tOut = 0

async function topicBatch(ads: any[]): Promise<number> {
  const adsText = ads.map((a, i) =>
    `AD ${i + 1} [${a.ad_id}]:\nBrand: ${clean(a.page_name)}\nBody: ${clean(a.body).slice(0, 350)}`
  ).join('\n\n---\n\n')

  const prompt = `For each ad below, output 2-5 short TOPIC tags describing what the product/ad is about.
Rules:
- lowercase, SHORTEST canonical form (usually 1-2 words). Tag the CORE topic and the
  product TYPE as SEPARATE tags — e.g. ["hair loss","supplement"] NOT ["hair loss supplement"].
- Normalize synonyms to ONE canonical tag so similar ads share it:
  thinning hair / regrow / balding / receding → "hair loss"
  fat loss / GLP-1 / semaglutide / slimming → "weight loss"
  ED / erectile → "erectile dysfunction"
  low T / testosterone booster → "testosterone"
- Tag the problem/benefit + category, NOT generic words like "health", "wellness", "sale", "discount".
Return ONLY a JSON array: [{"ad_id":"...","topics":["...","..."]}]

Ads:
${adsText}

Return only the JSON array.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
  })
  const data: any = await res.json()
  if (data.error) { console.warn('  anthropic error:', data.error.message); return 0 }
  tIn += data.usage?.input_tokens || 0; tOut += data.usage?.output_tokens || 0

  const m = (data.content?.[0]?.text || '').match(/\[[\s\S]*\]/)
  if (!m) return 0
  let cls: any[]
  try { cls = JSON.parse(m[0]) } catch { return 0 }

  for (const c of cls) {
    if (!c.ad_id) continue
    const topics = Array.isArray(c.topics)
      ? Array.from(new Set(c.topics.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean))).slice(0, 6)
      : []
    await (supabase as any).from('discovery_ads_index').update({ topics }).eq('ad_id', c.ad_id)
  }
  return cls.length
}

async function main() {
  console.log(`Topic tagging — model=${MODEL}, batch=${BATCH}`)
  let done = 0, batches = 0, fails = 0
  while (batches < MAX_BATCHES) {
    const { data: ads } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, page_name, body')
      .is('topics', null)
      .not('body', 'is', null)
      .neq('body', '')
      .limit(BATCH)
    if (!ads?.length) { console.log('  no more untagged ads.'); break }
    const n = await topicBatch(ads)
    done += n; batches++
    if (n === 0) {
      fails++
      console.warn(`  ⚠️ batch ${batches} +0 — ids: ${ads.map((a: any) => a.ad_id).join(',')}`)
      if (fails >= 5) { console.error('  aborting after 5 fails.'); break }
    } else fails = 0
    const cost = tIn / 1e6 * 1 + tOut / 1e6 * 5
    if (batches % 10 === 0) console.log(`  batch ${batches}: total ${done} | est $${cost.toFixed(2)}`)
    await new Promise(r => setTimeout(r, 400))
  }
  console.log(`✅ tagged ${done} ads | est $${(tIn / 1e6 * 1 + tOut / 1e6 * 5).toFixed(2)}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
