/**
 * Industry insights for the AI Ad Studio — aggregate the winning DNA of a niche from the ads we
 * already crawl/classify (discovery_ads_index), weighted by performance_score. This is the
 * "what works in your industry" brief injected into the generation prompt.
 */
type Admin = any

export type NicheInsights = {
  niche: string | null
  topHooks: string[]
  topAngles: string[]
  topFormats: string[]
  topEmotions: string[]
  topCtas: string[]
  sampleSize: number
}

/** Resolve a brand's coarse niche (matches discovery_ads_index.niche) via niche_map. */
export async function resolveBrandNiche(admin: Admin, industries?: string[] | null): Promise<string | null> {
  const list = (industries || []).filter((s) => typeof s === 'string' && s.trim())
  if (!list.length) return null
  const { data } = await admin.from('niche_map').select('niche, priority').in('industry', list).order('priority', { ascending: true }).limit(1)
  return (data && data[0]?.niche) || null
}

const tally = (rows: any[], key: string, split = false): string[] => {
  const m = new Map<string, number>()
  for (const r of rows) {
    const w = Number(r.performance_score) || 0.01
    const raw = r[key]
    const vals: string[] = split && Array.isArray(raw) ? raw : (raw ? [raw] : [])
    for (const v of vals) {
      const k = String(v).trim()
      if (k) m.set(k, (m.get(k) || 0) + w)
    }
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
}

/**
 * Pull the top-performing ads for a niche and distill their DNA. Falls back to the global
 * top performers when the niche is unknown or too sparse.
 */
export async function getNicheInsights(admin: Admin, niche: string | null): Promise<NicheInsights> {
  const cols = 'hook_type, format_style, angle, emotion, cta, performance_score'
  let rows: any[] = []
  if (niche) {
    const { data } = await admin.from('discovery_ads_index').select(cols)
      .eq('niche', niche).order('performance_score', { ascending: false }).limit(200)
    rows = data || []
  }
  if (rows.length < 20) {
    // Sparse niche → blend in global top performers so the brief is never empty.
    const { data } = await admin.from('discovery_ads_index').select(cols)
      .order('performance_score', { ascending: false }).limit(200)
    rows = rows.concat(data || [])
  }
  return {
    niche,
    topHooks: tally(rows, 'hook_type'),
    topAngles: tally(rows, 'angle'),
    topFormats: tally(rows, 'format_style'),
    topEmotions: tally(rows, 'emotion', true),
    topCtas: tally(rows, 'cta'),
    sampleSize: rows.length,
  }
}
