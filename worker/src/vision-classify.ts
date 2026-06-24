/**
 * Vision classifier (E2) — fills the VISUAL filters text can't: format_style (UGC vs studio),
 * visual_style (the setting), visual_scene, and on_screen_text — by actually LOOKING at the creative
 * with gpt-4o-mini vision. Deduped by creative HASH (one call per unique image, fanned out to every
 * ad that uses it).
 *
 * Two scopes:
 *   • GLOBAL (cost-controlled) — VISION_SCOPE=active|winning|all → powers the Discovery filters.
 *   • BRAND (deep spy)         — VISION_PAGE_ID=<page_id>        → EVERY creative of one brand.
 *
 *   docker run -d --name vision --env-file /opt/worker/.env \
 *     -v /root/Selfmade/worker/src:/app/src selfmade-worker npx tsx src/vision-classify.ts
 *   # tunables: VISION_CONCURRENCY (6), VISION_SCOPE (active|winning|all), VISION_MAX (0=∞), VISION_PAGE_ID
 *
 * runVision() is also imported by vision-spy-daemon.ts to run the brand pass per spied brand.
 */
import { supabase } from './db.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.VISION_MODEL || 'gpt-4o-mini'
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

type Cand = { hash: string; img: string }

export async function classifyOne(c: Cand): Promise<boolean> {
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
    await (supabase as any).from('discovery_ads_index')
      .update(update)
      .or(`image_hash.eq.${c.hash},video_hash.eq.${c.hash}`)   // fan out to every ad with this creative
    return true
  } catch { return false }
}

/** Run a vision pass. Pass pageId for the FULL brand (deep spy) scope, else the global scope. */
export async function runVision(opts: { pageId?: string; scope?: string; max?: number; concurrency?: number }): Promise<{ done: number; ok: number }> {
  const { pageId = '', scope = 'active', max = 0, concurrency = 6 } = opts
  const seen = new Set<string>()
  let cursor: string | null = null
  let done = 0, ok = 0
  for (;;) {
    let q = (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id, image_hash, video_hash, discovery_creatives!inner(poster_url, r2_url, asset_type, hash)')
      .or('visual_classified.is.null,visual_classified.eq.false')
      .order('ad_id', { ascending: false })
      .limit(BATCH)
    if (pageId) q = q.eq('page_id', pageId)                                    // deep spy: ALL creatives
    else if (scope === 'active') q = q.eq('is_active', true)
    else if (scope === 'winning') q = q.in('performance_tier', ['winning', 'optimized'])
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
      fresh.push({ hash, img })
    }
    for (let i = 0; i < fresh.length; i += concurrency) {
      const slice = fresh.slice(i, i + concurrency)
      const res = await Promise.all(slice.map(classifyOne))
      done += slice.length; ok += res.filter(Boolean).length
      if (max && done >= max) return { done, ok }
    }
    cursor = rows[rows.length - 1].ad_id
    console.log(`  … ${done} unique creatives classified (${ok} ok)${pageId ? ` [brand ${pageId}]` : ''}`)
  }
  return { done, ok }
}

async function main() {
  if (!OPENAI_KEY) { console.error('missing OPENAI_API_KEY'); process.exit(1) }
  const pageId = (process.env.VISION_PAGE_ID || '').trim()
  const scope = (process.env.VISION_SCOPE || 'active').toLowerCase()
  const max = Math.max(0, parseInt(process.env.VISION_MAX ?? '0', 10))
  const concurrency = Math.max(1, parseInt(process.env.VISION_CONCURRENCY ?? '6', 10))
  console.log(`👁️  vision-classify — model=${MODEL}, ${pageId ? `brand=${pageId} (FULL)` : `scope=${scope}`}, concurrency=${concurrency}, max=${max || '∞'}`)
  const { done, ok } = await runVision({ pageId, scope, max, concurrency })
  console.log(`✅ vision-classify done — ${ok}/${done} unique creatives`)
  process.exit(0)
}

// Run as CLI unless imported (the daemon imports runVision/classifyOne).
if (process.env.VISION_AS_LIB !== '1') main().catch((e) => { console.error('fatal:', e); process.exit(1) })
