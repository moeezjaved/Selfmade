/**
 * Vision classifier (E2) — fills the VISUAL filters text can't: format_style (UGC vs studio),
 * visual_style (the setting), visual_scene, and on_screen_text — by actually LOOKING at the creative
 * with gpt-4o-mini vision. Deduped by creative HASH (one call per unique image, fanned out to every
 * ad that uses it) and scoped to the ads users actually filter on (active by default) to control cost.
 *
 *   docker run -d --name vision --env-file /opt/worker/.env \
 *     -v /root/Selfmade/worker/src:/app/src selfmade-worker npx tsx src/vision-classify.ts
 *   # tunables: VISION_CONCURRENCY (6), VISION_SCOPE (active|winning|all), VISION_MAX (0=unlimited)
 *
 * on_screen_text it writes feeds the TEXT classifier (classify-batch) so video hooks get accurate.
 */
import { supabase } from './db.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.VISION_MODEL || 'gpt-4o-mini'
const CONCURRENCY = Math.max(1, parseInt(process.env.VISION_CONCURRENCY ?? '6', 10))
const SCOPE = (process.env.VISION_SCOPE || 'active').toLowerCase()   // active | winning | all
const MAX = Math.max(0, parseInt(process.env.VISION_MAX ?? '0', 10)) // 0 = unlimited
const BATCH = 300

const FORMAT_STYLES = ['UGC', 'Studio / Produced', 'Graphic / Text', 'Mixed']
const VISUAL_STYLES = ['Selfie / Handheld', 'Bathroom / Mirror', 'Kitchen / Home', 'Outdoor / Lifestyle', 'Studio Product Shot', 'Before & After', 'Text Overlay Graphic', 'Unboxing', 'Lifestyle / Editorial', 'Other']

const PROMPT = `Look at this ad creative and return ONE JSON object only, no prose:
{
 "format_style": one of "UGC" | "Studio / Produced" | "Graphic / Text" | "Mixed",
 "visual_style": one of ${VISUAL_STYLES.map(s => `"${s}"`).join(' | ')},
 "visual_scene": short phrase (max 6 words) describing the shot,
 "on_screen_text": the prominent text shown ON the image, VERBATIM, or "" if none
}
UGC = looks user-shot/selfie/handheld/phone footage. Studio / Produced = polished, lit, produced.
Graphic / Text = mostly designed graphic or text card. Mixed = a combination.`

type Cand = { hash: string; assetType: string; img: string }

async function classifyOne(c: Cand): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODEL, max_tokens: 220,
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: c.img, detail: 'low' } },   // low detail = cheapest
        ] }],
      }),
    })
    if (!res.ok) { if (res.status === 429) await new Promise(r => setTimeout(r, 3000)); return false }
    const j = await res.json()
    const raw = (j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return false
    const o = JSON.parse(m[0])
    const update: Record<string, any> = {
      format_style: FORMAT_STYLES.includes(o.format_style) ? o.format_style : null,
      visual_style: VISUAL_STYLES.includes(o.visual_style) ? o.visual_style : null,
      visual_scene: typeof o.visual_scene === 'string' ? o.visual_scene.slice(0, 120) : null,
      on_screen_text: (typeof o.on_screen_text === 'string' && o.on_screen_text.trim()) ? o.on_screen_text.slice(0, 500) : null,
      visual_classified: true,
    }
    // Fan out to EVERY ad that uses this creative (matches whichever hash column it lives in).
    await (supabase as any).from('discovery_ads_index')
      .update(update)
      .or(`image_hash.eq.${c.hash},video_hash.eq.${c.hash}`)
    return true
  } catch { return false }
}

async function main() {
  if (!OPENAI_KEY) { console.error('missing OPENAI_API_KEY'); process.exit(1) }
  console.log(`👁️  vision-classify — model=${MODEL}, scope=${SCOPE}, concurrency=${CONCURRENCY}, max=${MAX || '∞'}`)
  const seen = new Set<string>()
  let cursor: string | null = null
  let done = 0, ok = 0
  for (;;) {
    // Active ads (or winners / all) that still need visual classification + have a creative image.
    let q = (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, image_hash, video_hash, discovery_creatives!inner(poster_url, r2_url, asset_type, hash)')
      .or('visual_classified.is.null,visual_classified.eq.false')
      .order('ad_id', { ascending: false })
      .limit(BATCH)
    if (SCOPE === 'active') q = q.eq('is_active', true)
    else if (SCOPE === 'winning') q = q.in('performance_tier', ['winning', 'optimized'])
    if (cursor) q = q.lt('ad_id', cursor)
    const { data, error } = await q
    if (error) { console.error('query error:', error.message); break }
    const rows = (data || []) as any[]
    if (!rows.length) break

    const fresh: Cand[] = []
    for (const r of rows) {
      const cre = (r.discovery_creatives || [])[0]
      const hash = cre?.hash || r.image_hash || r.video_hash
      if (!hash || seen.has(hash)) continue
      const img = cre?.poster_url || cre?.r2_url
      if (!img) continue
      seen.add(hash)
      fresh.push({ hash, assetType: cre?.asset_type || 'image', img })
    }

    for (let i = 0; i < fresh.length; i += CONCURRENCY) {
      const slice = fresh.slice(i, i + CONCURRENCY)
      const res = await Promise.all(slice.map(classifyOne))
      done += slice.length; ok += res.filter(Boolean).length
      if (MAX && done >= MAX) { console.log(`reached VISION_MAX=${MAX}`); console.log(`✅ vision-classify done — ${ok}/${done} unique creatives`); process.exit(0) }
    }
    cursor = rows[rows.length - 1].ad_id
    console.log(`  … ${done} unique creatives classified (${ok} ok), cursor=${cursor}`)
  }
  console.log(`✅ vision-classify done — ${ok}/${done} unique creatives`)
  process.exit(0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
