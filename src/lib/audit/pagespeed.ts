/**
 * PageSpeed Insights API — real Chrome UX (CrUX) field data + Lighthouse score for the audit's speed
 * section. Gated on GOOGLE_PAGESPEED_KEY (free key from Google Cloud → enable "PageSpeed Insights API").
 * When absent, the speed step is skipped and the section stays out of the report.
 */
const KEY = process.env.GOOGLE_PAGESPEED_KEY || ''
export function pagespeedConfigured(): boolean { return !!KEY }

export type SpeedRead = { lcpMs: number | null; clsScore: number | null; inpMs: number | null; perf: number | null; hasField: boolean }

export async function pageSpeed(url: string): Promise<SpeedRead | null> {
  try {
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${KEY}&category=performance&strategy=mobile`, { signal: AbortSignal.timeout(28000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return null
    const le = j?.loadingExperience?.metrics || j?.originLoadingExperience?.metrics
    const lcpMs = le?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null
    const clsScore = le?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? le.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null
    const inpMs = le?.INTERACTION_TO_NEXT_PAINT?.percentile ?? le?.EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT?.percentile ?? null
    const perf = j?.lighthouseResult?.categories?.performance?.score != null ? Math.round(j.lighthouseResult.categories.performance.score * 100) : null
    return { lcpMs, clsScore, inpMs, perf, hasField: !!le }
  } catch { return null }
}
