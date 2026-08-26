/**
 * In-session ad-DNA classifier. Turns live-pulled ads (fetchLiveAdsByPage — droplet, no crawl) into
 * rows the DNA engine can roll up, RIGHT NOW, so the audit produces a complete report while the user is
 * still in the theater — never "your report will come later". One LLM pass over the ad copy tags each ad
 * across the same dimensions the crawler's classifier uses (hook/angle/persona/…). Media is never
 * downloaded — we classify from copy and keep the fbcdn thumbnail URL for display only.
 */
import { llm } from '@/lib/llm'
import type { LiveAd } from '@/lib/ads-studio/adlibrary'

const clean = (s: string) => (s || '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim()

// Build an engine-shaped AdRow from a live ad + its classification. Missing dims stay null (rollup skips them).
type Classified = {
  hook_type?: string; angle?: string; persona?: string; desire?: string; emotion?: string[]
  themes?: string[]; usp?: string; problem?: string; offer?: string; cta_style?: string
  format_style?: string; visual_style?: string
}

export async function classifyLiveOwnAds(ads: LiveAd[], brandName: string, niche: string | null): Promise<Record<string, unknown>[]> {
  const usable = ads.filter((a) => (a.body || a.title))
  if (!usable.length) return []
  let tags: Classified[] = []
  try {
    const list = usable.slice(0, 20).map((a, i) => `#${i}: ${clean(a.body || a.title).slice(0, 300)}`).join('\n')
    const prompt = `You are an ad-DNA analyst. For EACH of ${brandName}'s ads below${niche ? ` (niche: ${niche})` : ''}, classify it. Return ONLY a JSON array, one object per ad IN ORDER, each:
{"hook_type":"e.g. Question|Bold claim|Problem-agitate|Social proof|Curiosity|Offer-led","angle":"the persuasion angle in 2-4 words","persona":"who it targets in 2-4 words","desire":"core desire in 2-4 words","emotion":["1-3 emotions"],"themes":["1-3 themes"],"usp":"the differentiator in 2-5 words","problem":"the problem it names in 2-5 words","offer":"any offer/promo or 'none'","cta_style":"e.g. Shop now|Learn more|Sign up|Get offer|None"}
Use plain buyer words. If a field isn't clear, use "none". ADS:\n${list}`
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 2000, temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
    const txt = res.content?.[0]?.text || ''
    const m = txt.match(/\[[\s\S]*\]/)
    if (m) tags = JSON.parse(m[0])
  } catch { /* classification best-effort — rows still carry copy + thumbs */ }

  return usable.slice(0, 20).map((a, i) => {
    const t = tags[i] || {}
    const isVideo = (a.videos && a.videos.length > 0)
    return {
      ad_id: a.adId, page_id: a.pageId, page_name: a.pageName || brandName,
      format: isVideo ? 'video' : 'image',
      format_style: t.format_style || (isVideo ? 'Video' : null),
      visual_style: t.visual_style || null,
      days_running: 0, is_active: a.isActive !== false, has_creative: true, performance_score: null,
      body: a.body || '', title: a.title || '',
      thumbnail_url: (a.images && a.images[0]) || (a.videoPreviews && a.videoPreviews[0]) || null,
      raw_image_urls: a.images || [],
      snapshot_url: a.link || null, start_date: null, link_url: a.link || null,
      hook_type: t.hook_type || null, angle: t.angle || null, persona: t.persona || null,
      desire: t.desire || null, emotion: Array.isArray(t.emotion) ? t.emotion : [],
      themes: Array.isArray(t.themes) ? t.themes : [], usp: t.usp || null,
      problem: t.problem || null, offer: t.offer || null, cta_style: t.cta_style || null,
    }
  })
}
