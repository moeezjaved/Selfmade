/**
 * seo-content-worker — writes UNIQUE copy for each /brands/[slug] SEO page (anti-duplicate-content).
 *
 * Templated copy across thousands of pages reads as doorway/duplicate content to Google. This gives
 * every eligible brand (>= SEO_MIN_ADS ads) a distinct AI-written intro + meta description, grounded
 * in that brand's real data (niche, ad count, longest-runner, sample ad copy). Cheap: gpt-4o-mini,
 * ~2-3 sentences per brand. Idempotent — skips brands already in brand_seo_content, so re-runs only
 * fill gaps. Cron it weekly to cover newly-eligible brands.
 *
 * Run (droplet):
 *   docker run --rm --env-file <env> -v /opt/worker/src:/app/src selfmade-worker node src/seo-content-worker.mjs [--limit=500]
 *   env: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEO_MIN_ADS (default 100)
 */
const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const OPENAI = process.env.OPENAI_API_KEY
const MIN_ADS = parseInt(process.env.SEO_MIN_ADS || '100', 10)
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '500', 10)
const CONC = 4
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const enc = encodeURIComponent

if (!U || !K) { console.error('missing SUPABASE_URL / SERVICE_ROLE_KEY'); process.exit(1) }
if (!OPENAI) { console.error('missing OPENAI_API_KEY'); process.exit(1) }

async function getJSON(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status} ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

// Brands eligible for a page but with NO content yet. Two queries + a JS anti-join (the set is small).
async function pending() {
  const brands = await getJSON(`discovery_brand_crawl_state?select=page_id,brand_name,ads_indexed&ads_indexed=gte.${MIN_ADS}&order=ads_indexed.desc&limit=5000`)
  const done = await getJSON('brand_seo_content?select=page_id&limit=100000').catch(() => [])
  const haveContent = new Set((done || []).map(d => d.page_id))
  return (brands || []).filter(b => b.brand_name && !haveContent.has(b.page_id)).slice(0, LIMIT)
}

async function sampleContext(pageId) {
  // A few top ad bodies + niche to ground the copy in the brand's real angles.
  const ads = await getJSON(`discovery_ads_index?select=body,niche,days_running&page_id=eq.${enc(pageId)}&has_creative=is.true&order=performance_score.desc.nullslast&limit=6`).catch(() => [])
  const niche = (ads.find(a => a.niche) || {}).niche || null
  const longest = Math.max(0, ...ads.map(a => a.days_running || 0))
  const bodies = ads.map(a => (a.body || '').trim()).filter(Boolean).slice(0, 4)
  return { niche, longest, bodies }
}

async function writeCopy(name, adCount, ctx) {
  const prompt = `You are writing a short, factual intro for a page that shows ${name}'s Facebook/Instagram ads (from Meta's public Ad Library).
Brand: ${name}
Total ads tracked: ${adCount}
Niche: ${ctx.niche || 'unknown'}
Longest-running ad: ${ctx.longest} days
Sample ad copy from this brand:
${ctx.bodies.map((b, i) => `${i + 1}. ${b.slice(0, 200)}`).join('\n') || '(none)'}

Write UNIQUE copy for THIS brand (do not use generic phrasing that would fit any brand). Return JSON:
{
 "headline": "<H1, ~6-9 words, includes the brand name and 'Facebook Ads' or 'Ads'>",
 "intro_md": "<2-3 sentences, specific to this brand's niche/angles/what a marketer would learn from studying their ads. No fluff, no made-up stats — only use the facts given.>",
 "meta_description": "<150-160 char meta description, specific, with the brand name and a reason to click>"
}`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7, max_tokens: 400,
    }),
  })
  if (!r.ok) throw new Error(`openai ${r.status} ${(await r.text()).slice(0, 120)}`)
  const j = await r.json()
  return JSON.parse(j.choices[0].message.content)
}

async function upsert(row) {
  const r = await fetch(`${U}/rest/v1/brand_seo_content?on_conflict=page_id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
  if (!r.ok) console.warn('upsert failed:', r.status, (await r.text()).slice(0, 120))
}

async function run() {
  const todo = await pending()
  console.log(`✍️  seo-content: ${todo.length} brands need copy (>=${MIN_ADS} ads)`)
  let done = 0, fail = 0, qi = 0
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (qi < todo.length) {
      const b = todo[qi++]
      try {
        const ctx = await sampleContext(b.page_id)
        const c = await writeCopy(b.brand_name, b.ads_indexed, ctx)
        await upsert({
          page_id: b.page_id, brand_name: b.brand_name,
          headline: (c.headline || '').slice(0, 200),
          intro_md: (c.intro_md || '').slice(0, 1200),
          meta_description: (c.meta_description || '').slice(0, 320),
          model: 'gpt-4o-mini', generated_at: new Date().toISOString(),
        })
        done++
        if (done % 25 === 0) console.log(`  … ${done}/${todo.length}`)
      } catch (e) { fail++; console.warn(`  ✗ ${b.brand_name}: ${e.message}`) }
    }
  }))
  console.log(`✅ seo-content done — wrote ${done}, failed ${fail}`)
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
