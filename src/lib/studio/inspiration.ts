/**
 * Inspiration retrieval — pick the few reference designs to attach per generation. We can't send
 * the whole library to Gemini, so we select 3-4: prefer the user's niche + matching aspect/format,
 * then fill with diverse high-quality picks. Never returns more than `limit`.
 */
type Admin = any

export type Inspiration = { id: string; r2_url: string; niche: string | null; aspect: string | null; format: string | null; style_tags: string[] | null; layout_type: string | null }

export async function pickInspirations(
  admin: Admin,
  opts: { niche?: string | null; aspect?: string | null; limit?: number }
): Promise<Inspiration[]> {
  const limit = opts.limit || 4
  const sel = 'id, r2_url, niche, aspect, format, style_tags, layout_type'
  const chosen: Inspiration[] = []
  const seen = new Set<string>()
  const add = (rows: any[] | null) => {
    for (const r of rows || []) {
      if (chosen.length >= limit || seen.has(r.id)) continue
      seen.add(r.id); chosen.push(r)
    }
  }

  // 1. niche + aspect match (best) → 2. niche only → 3. aspect only → 4. anything active.
  if (opts.niche) {
    if (opts.aspect) {
      const { data } = await admin.from('ad_inspirations').select(sel).eq('active', true).eq('niche', opts.niche).eq('aspect', opts.aspect).limit(limit)
      add(data)
    }
    if (chosen.length < limit) {
      const { data } = await admin.from('ad_inspirations').select(sel).eq('active', true).eq('niche', opts.niche).limit(limit)
      add(data)
    }
  }
  if (chosen.length < limit && opts.aspect) {
    const { data } = await admin.from('ad_inspirations').select(sel).eq('active', true).eq('aspect', opts.aspect).limit(limit)
    add(data)
  }
  if (chosen.length < limit) {
    const { data } = await admin.from('ad_inspirations').select(sel).eq('active', true).order('created_at', { ascending: false }).limit(limit * 3)
    add(data)
  }
  return chosen.slice(0, limit)
}
