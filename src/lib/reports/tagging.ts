/**
 * AI creative tagging — the "Creative Patterns" layer (Motion parity).
 * Runs a vision+copy pass over each of the user's own ad creatives and assigns structured tags across
 * creative dimensions (Visual Format, Messaging Theme, Hook Tactic, Headline Tactic, Intended Audience,
 * Offer Type). Reports can then GROUP BY these dimensions.
 *
 * Cost control: tags are cached per ad account in R2 (report-tags/<account_id>.json), so AI runs once
 * per creative — subsequent report loads are free. Each generate call only tags a bounded batch of the
 * highest-spend untagged ads, so first-time tagging never blows the function timeout or the OpenAI bill.
 */
import OpenAI from 'openai'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

export type TagDimension = 'visual_format' | 'messaging_theme' | 'hook_tactic' | 'headline_tactic' | 'intended_audience' | 'offer_type'

export const TAG_DIMENSIONS: { key: TagDimension; label: string; hint: string }[] = [
  { key: 'visual_format',    label: 'Visual format',    hint: 'Testimonial, Unboxing, Demo, Montage, Cinematic B-Roll, Greenscreen…' },
  { key: 'messaging_theme',  label: 'Messaging theme',  hint: 'Problem/Solution, Social Proof, Benefit-led, FOMO…' },
  { key: 'hook_tactic',      label: 'Hook tactic',      hint: 'Question, Bold Claim, Problem Callout, POV…' },
  { key: 'headline_tactic',  label: 'Headline tactic',  hint: 'Discount, Urgency, Benefit, Curiosity…' },
  { key: 'intended_audience',label: 'Intended audience',hint: 'The persona the ad speaks to' },
  { key: 'offer_type',       label: 'Offer type',       hint: 'Discount, BOGO, Free Shipping, Bundle, No Offer…' },
]
export const TAG_KEYS = TAG_DIMENSIONS.map(d => d.key)
export const isTagDimension = (k: string): k is TagDimension => (TAG_KEYS as string[]).includes(k)

// Controlled vocabularies keep grouping tidy (the model must pick from these where given).
const VOCAB: Record<TagDimension, string[] | null> = {
  visual_format: ['Testimonial', 'UGC', 'Unboxing', 'Demo', 'Product Showcase', 'Feature Callout', 'Lifestyle', 'Montage', 'Cinematic B-Roll', 'Greenscreen', 'Talking Head', 'Comparison', 'Before & After', 'Text-Heavy', 'Founder Story'],
  messaging_theme: ['Problem/Solution', 'Social Proof', 'Benefit-Led', 'Emotional', 'Educational', 'Offer/Discount', 'FOMO', 'Identity/Belonging', 'Authority', 'Curiosity'],
  hook_tactic: ['Question', 'Bold Claim', 'Problem Callout', 'Pattern Interrupt', 'Statistic', 'Story Open', 'POV', 'Direct Address', 'Negative Hook', 'Visual Surprise'],
  headline_tactic: ['Discount', 'Urgency', 'Benefit', 'Social Proof', 'Curiosity', 'Question', 'How-To', 'Announcement', 'None'],
  intended_audience: null, // free-form short label, e.g. "Smokers quitting nicotine"
  offer_type: ['Discount', 'BOGO', 'Free Shipping', 'Bundle', 'Free Gift', 'New Arrival', 'Subscription', 'No Offer'],
}

export type CreativeTags = Record<TagDimension, string>
export type TagInput = { id: string; name?: string; primaryText?: string; headline?: string; thumbnail?: string | null; format?: string }

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

const cacheKey = (accountId: string) => `report-tags/${accountId}.json`

export async function loadTagCache(accountId: string): Promise<Record<string, CreativeTags>> {
  const url = r2PublicUrl(cacheKey(accountId))
  if (!url) return {}
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return {}
    return (await res.json()) || {}
  } catch { return {} }
}

async function saveTagCache(accountId: string, cache: Record<string, CreativeTags>): Promise<void> {
  await uploadBufferToR2(Buffer.from(JSON.stringify(cache)), cacheKey(accountId), 'application/json').catch(() => null)
}

// One ad → tags. Vision when a thumbnail is available, else copy-only. Never throws (returns null).
async function tagOne(ad: TagInput): Promise<CreativeTags | null> {
  const vocabLines = TAG_DIMENSIONS.map(d => {
    const v = VOCAB[d.key]
    return `- ${d.key}: ${v ? `choose ONE of [${v.join(', ')}]` : 'a short 1-3 word audience label'}`
  }).join('\n')
  const copy = [ad.name && `Ad name: ${ad.name}`, ad.headline && `Headline: ${ad.headline}`, ad.primaryText && `Primary text: ${ad.primaryText}`].filter(Boolean).join('\n') || '(no copy provided)'
  const prompt = `You are tagging a Meta ad creative for a performance-marketing analytics tool. Classify it across these dimensions and return STRICT JSON with exactly these keys:\n${vocabLines}\n\nCreative copy:\n${copy}\n\nReturn only the JSON object.`

  const content: any[] = [{ type: 'text', text: prompt }]
  if (ad.thumbnail && /^https?:\/\//.test(ad.thumbnail)) content.push({ type: 'image_url', image_url: { url: ad.thumbnail, detail: 'low' } })

  try {
    const res = await oai().chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 200, temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: content as any }],
    })
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
    const out = {} as CreativeTags
    for (const d of TAG_DIMENSIONS) {
      let val = String(parsed[d.key] ?? '').trim()
      const v = VOCAB[d.key]
      if (v && !v.some(o => o.toLowerCase() === val.toLowerCase())) val = v.find(o => val.toLowerCase().includes(o.toLowerCase())) || 'Other'
      else if (v) val = v.find(o => o.toLowerCase() === val.toLowerCase()) || val
      out[d.key] = val || 'Unknown'
    }
    return out
  } catch {
    // Copy-only retry if the image fetch was the problem.
    if (content.length > 1) return tagOne({ ...ad, thumbnail: null })
    return null
  }
}

// Concurrency-capped batch runner.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

/**
 * Ensure the given ads are tagged. Tags cached ones for free; AI-tags up to `budget` of the remaining
 * (highest-priority first — pass ads pre-sorted by spend). Returns the full id→tags map and whether any
 * ads were left untagged (so the caller can surface "still tagging N more").
 */
export async function ensureTags(accountId: string, ads: TagInput[], budget = 30): Promise<{ tags: Record<string, CreativeTags>; taggedNow: number; remaining: number }> {
  if (!process.env.OPENAI_API_KEY) return { tags: {}, taggedNow: 0, remaining: ads.length }
  const cache = await loadTagCache(accountId)
  const untagged = ads.filter(a => !cache[a.id])
  const batch = untagged.slice(0, budget)
  if (batch.length) {
    const results = await mapPool(batch, 6, tagOne)
    results.forEach((r, i) => { if (r) cache[batch[i].id] = r })
    await saveTagCache(accountId, cache)
  }
  return { tags: cache, taggedNow: batch.length, remaining: Math.max(0, untagged.length - batch.length) }
}
