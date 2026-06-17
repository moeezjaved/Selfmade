/**
 * Shared classification core — ONE merged prompt that produces BOTH the
 * hook/persona fields AND the topic tags in a single Claude call (was two
 * separate passes = 2× cost), plus per-CREATIVE propagation so we classify
 * once per unique image/video and fan the result out to every ad that shares
 * it (brands run one creative as dozens of ads → ~3-5× fewer calls).
 *
 * Used by classify-batch.ts (async Batch API, 50% off — the backlog drain and
 * steady-state classifier).
 */
import { supabase } from './db.js'

// Strip lone/unpaired surrogates (corrupted emoji) — they make JSON.stringify
// emit invalid JSON the Anthropic API rejects, stalling a whole batch.
export const clean = (s: any) => String(s || '').replace(/[\uD800-\uDFFF]/g, '')

export interface CreativeItem {
  key: string          // copy_sig (sha256 of normalized page_id+title+body); echoed as the result id
  page_name?: string
  title?: string
  body?: string
}

/**
 * Build the merged classification prompt for a chunk of CREATIVES. Each item is
 * referenced by its `key`, which the model echoes back as "id" so results are
 * self-describing (we map by id, not by request order — survives restarts).
 */
export function buildMergedPrompt(items: CreativeItem[]): string {
  const text = items.map((it, i) =>
    `CREATIVE ${i + 1} [${it.key}]:\nBrand: ${clean(it.page_name)}\nHeadline: ${clean(it.title)}\nBody: ${clean(it.body).slice(0, 400)}`
  ).join('\n\n---\n\n')

  return `Analyze these ${items.length} ad creatives. For EACH, return one JSON object. Output a JSON array only, no prose.

For each creative return EXACTLY:
{
  "id": "<echo the [bracketed] id verbatim>",
  "hook_type": one of: "Question|Before & After|Testimonial|Story|Announcement|Educational|Urgency|Discount|Unboxing|Us vs Them|Social Proof|Pain Point",
  "emotion": array of 1-3 from: ["curiosity","fear","desire","trust","urgency","hope","excitement","relatability","aspiration","guilt","pride"],
  "angle": one of: "Pain Point|Aspiration|Social Proof|Authority|Scarcity|Curiosity|Value|Story|Comparison",
  "cta": the call-to-action text, or "Shop Now" if unclear,
  "tone": one of: "Casual|Professional|Urgent|Inspirational|Humorous|Educational|Emotional",
  "persona": brief target audience (max 5 words),
  "desire": core desire addressed (max 5 words),
  "usp": main unique selling point (max 8 words),
  "topics": array of 2-5 SHORT topic tags describing what the product/ad is about. Rules:
     - lowercase, shortest canonical form (1-2 words). Use the SINGULAR noun and no
       internal spaces for compound product types (e.g. "activewear" not "active wear",
       "supplement" not "supplements"). Tag the CORE topic and the product TYPE as
       SEPARATE tags — e.g. ["hair loss","supplement"] NOT ["hair loss supplement"].
     - Normalize synonyms to ONE canonical tag: thinning/regrow/balding → "hair loss";
       fat loss/GLP-1/semaglutide/slimming → "weight loss"; ED/erectile → "erectile dysfunction";
       low T/testosterone booster → "testosterone".
     - Tag the problem/benefit + category, NOT generic words like "health","wellness","sale","discount".
}

Creatives:
${text}

Return only the JSON array.`
}

// Shared vocab — exported so the OpenAI Structured-Output schema constrains to the
// SAME enums the Anthropic path validates against (one source of truth).
export const HOOKS = ['Question','Before & After','Testimonial','Story','Announcement','Educational','Urgency','Discount','Unboxing','Us vs Them','Social Proof','Pain Point'] as const
export const ANGLES = ['Pain Point','Aspiration','Social Proof','Authority','Scarcity','Curiosity','Value','Story','Comparison'] as const
export const TONES = ['Casual','Professional','Urgent','Inspirational','Humorous','Educational','Emotional'] as const
export const EMOTIONS = ['curiosity','fear','desire','trust','urgency','hope','excitement','relatability','aspiration','guilt','pride'] as const
const HOOK_SET = new Set<string>(HOOKS)
const ANGLE_SET = new Set<string>(ANGLES)
const TONE_SET = new Set<string>(TONES)

// Canonical topic map — collapses singular/plural and spacing variants to ONE
// surface form so the topic dimension doesn't fragment (e.g. "active wear"(9) vs
// "activewear"(1062)). Each variant maps to the dominant form observed in the data.
// Spelling/spacing only — NOT concept merging (activewear vs gymwear stay distinct;
// the search's semantic layer relates them). Re-run the audit periodically and add
// new pairs here. Applied at write-time → every future classification is canonical.
export const CANONICAL_TOPICS: Record<string, string> = {
  'supplements': 'supplement', 'active wear': 'activewear', 'sales': 'sale',
  'relationship': 'relationships', 'gym wear': 'gymwear', 'discounts': 'discount',
  'snacks': 'snack', 'outdoors': 'outdoor', 'legging': 'leggings', 'vitamin': 'vitamins',
  'gift': 'gifts', 'athletic wear': 'athleticwear', 'subscriptions': 'subscription',
  'promotions': 'promotion', 'protein bars': 'protein bar', 'athletics': 'athletic',
  'superfoods': 'superfood', 'multivitamins': 'multivitamin',
}

export function canonTopic(t: string): string {
  const k = t.trim().toLowerCase()
  return CANONICAL_TOPICS[k] || k
}

export function normalizeTopics(arr: any): string[] {
  if (!Array.isArray(arr)) return []
  return Array.from(new Set(arr.map((t: any) => canonTopic(String(t))).filter(Boolean))).slice(0, 6)
}

/** Extract the JSON array from a model text response. */
export function parseClassification(text: string): any[] {
  const m = (text || '').match(/\[[\s\S]*\]/)
  if (!m) return []
  try { return JSON.parse(m[0]) } catch { return [] }
}

/**
 * Apply one creative's classification to EVERY ad that shares the SAME COPY.
 * Keyed on copy_sig (a Postgres-generated sha256 of normalized page_id+title+body):
 * since classification derives only from copy, identical copy ⟹ identical tags, so
 * the fan-out is provably correct (unlike image_hash, which smears one caption's tags
 * across visual variants). Idempotent → re-processing an adopted batch is safe.
 */
export async function propagateClassification(copySig: string, c: any): Promise<number> {
  const update: Record<string, any> = {
    hook_type: HOOK_SET.has(c.hook_type) ? c.hook_type : null,
    emotion: Array.isArray(c.emotion) ? c.emotion.slice(0, 3) : [],
    angle: ANGLE_SET.has(c.angle) ? c.angle : null,
    cta: c.cta ? String(c.cta).slice(0, 120) : 'Shop Now',
    tone: TONE_SET.has(c.tone) ? c.tone : null,
    persona: c.persona ? String(c.persona).slice(0, 80) : null,
    desire: c.desire ? String(c.desire).slice(0, 80) : null,
    usp: c.usp ? String(c.usp).slice(0, 120) : null,
    topics: normalizeTopics(c.topics),
    ai_classified: true,
  }
  // One UPDATE fans the tags out to every ad sharing this copy. No count round-trip
  // (logging-only) — at 1M scale the extra SELECT per sig doubles DB load for nothing.
  await (supabase as any).from('discovery_ads_index').update(update).eq('copy_sig', copySig)
  return 1
}

/**
 * Set-based cache: for a batch of copy_sigs, return tags from any ad ALREADY
 * classified under each sig — so steady-state reuses them (copy the tags, skip
 * Claude) instead of paying to re-classify copy we've already seen. One query per
 * 200 sigs, not per ad. On a fresh corpus this returns empty (classify everything).
 */
export async function fetchCachedTags(sigs: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  for (let i = 0; i < sigs.length; i += 200) {
    const slice = sigs.slice(i, i + 200)
    const { data } = await (supabase as any)
      .from('discovery_ads_index')
      .select('copy_sig, hook_type, emotion, angle, cta, tone, persona, desire, usp, topics')
      .in('copy_sig', slice)
      .eq('ai_classified', true)
      .not('topics', 'is', null)
    for (const r of (data || []) as any[]) {
      if (r.copy_sig && !map.has(r.copy_sig)) map.set(r.copy_sig, r)
    }
  }
  return map
}
