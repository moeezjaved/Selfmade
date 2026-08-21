/**
 * creativeBriefs() — turns the DNA engine's judgment (prescriptions, or the raw gap
 * list when the LLM stayed silent) into concrete, render-ready ad briefs: a headline,
 * the hook/angle/persona/offer to build around, and a concise positive image prompt.
 *
 * Pure function. No I/O, no AI. It only reshapes what runDnaEngine already produced.
 */
import type { FullDnaResult } from './engine'

export type CreativeBrief = {
  key: string // stable id, e.g. 'brief-0'
  gapLabel: string // the gap this ad fills, e.g. 'Video' / 'Founder story'
  headline: string // on-image headline copy
  hook: string
  angle: string
  persona: string
  offer: string
  prompt: string // the full text prompt handed to the image model
}

// Top label of a winner-DNA dimension, if the winners lean on it at all.
const topLabel = (result: FullDnaResult, key: keyof FullDnaResult['winners']['dist']): string | null => {
  const tallies = result.winners.dist[key]
  return tallies && tallies.length ? tallies[0].label : null
}

// Concise POSITIVE prompt — no negative-prompt bloat (see project_clone_prompt_lesson).
const buildPrompt = (brandName: string, niche: string | null, headline: string, angle: string, persona: string): string =>
  `${brandName}${niche ? ' ' + niche : ''} ad. ${headline}. ${angle}. Clean product-forward composition, high-contrast, mobile-first. Persona: ${persona}.`.trim()

export type ShotBeat = { t: string; beat: string; onScreen: string; vo: string } // t = "0:00–0:03"
export type VideoScript = { title: string; totalSeconds: number; product: string; beats: ShotBeat[] }

// Format a second-count as "M:SS" (e.g. 3 → "0:03", 72 → "1:12").
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * videoShotList() — deterministic ARC-style timestamped shot list for one brief.
 * Pure: no LLM, no Date, no Math.random. Free + testable.
 *
 * Beat arc: hook → problem → product reveal → mechanism/proof → offer → CTA.
 * Every beat references the product on-screen (product = the brand's product).
 */
export function videoShotList(brief: CreativeBrief, brandName: string, niche: string | null): VideoScript {
  const product = brandName
  const nicheTag = niche ? ` (${niche})` : ''
  // Fixed per-beat durations summing to 25s (≤30). Six beats.
  const durations = [3, 4, 5, 5, 4, 4]

  const raw: Array<Omit<ShotBeat, 't'>> = [
    {
      beat: 'Hook',
      onScreen: `${brief.hook}`,
      vo: `${brief.hook}`,
    },
    {
      beat: 'Problem',
      onScreen: `The problem ${product} solves${nicheTag}`,
      vo: `${brief.angle}. That's the gap most people live with.`,
    },
    {
      beat: 'Product reveal',
      onScreen: `${product} in hand`,
      vo: `Meet ${product} — ${brief.headline}.`,
    },
    {
      beat: 'Mechanism / proof',
      onScreen: `${product} close-up, how it works`,
      vo: `Here's why ${product} works: ${brief.angle}.`,
    },
    {
      beat: 'Offer',
      onScreen: `${brief.offer} on ${product}`,
      vo: `${brief.offer} — today only.`,
    },
    {
      beat: 'CTA',
      onScreen: `Get ${product}`,
      vo: `Tap to try ${product}. ${brief.headline}.`,
    },
  ]

  let cursor = 0
  const beats: ShotBeat[] = raw.map((b, i) => {
    const start = cursor
    const end = cursor + durations[i]
    cursor = end
    return { t: `${fmt(start)}–${fmt(end)}`, ...b }
  })

  return {
    title: `${brandName} — ${brief.gapLabel}`,
    totalSeconds: durations.reduce((a, b) => a + b, 0),
    product,
    beats,
  }
}

// A REMAKE of a specific rival's proven winning video — same beat arc that's already working for them,
// with the user's product swapped in. Deterministic (no LLM), seeded from the rival's DNA.
export type RivalRef = { brand: string; hook: string; angle: string | null; hookType: string | null; daysRunning: number }
export function remakeScript(rival: RivalRef, brandName: string, niche: string | null): VideoScript {
  const product = brandName
  const nicheTag = niche ? ` (${niche})` : ''
  const angle = (rival.angle || rival.hookType || 'the transformation').toString()
  const hookLine = (rival.hook || rival.hookType || 'Stop scrolling').toString().slice(0, 90)
  const durations = [3, 4, 5, 5, 4, 4]

  const raw: Array<Omit<ShotBeat, 't'>> = [
    { beat: 'Hook — their proven opener', onScreen: hookLine, vo: `Open on the same beat ${rival.brand} hooks with — then it's all you.` },
    { beat: 'Problem', onScreen: `The problem ${product} solves${nicheTag}`, vo: `${angle}. The same tension their winning video rides.` },
    { beat: 'Product reveal', onScreen: `${product} in hand`, vo: `Cut to ${product} — your product in their proven structure.` },
    { beat: 'Mechanism / proof', onScreen: `${product} close-up, how it works`, vo: `Show why ${product} works — the ${angle} payoff.` },
    { beat: 'Social proof', onScreen: 'Real people, real results', vo: `Their version has run ${rival.daysRunning} days — proof this arc converts.` },
    { beat: 'CTA', onScreen: `Get ${product}`, vo: `Close on ${product}. Tap to try.` },
  ]

  let cursor = 0
  const beats: ShotBeat[] = raw.map((b, i) => {
    const start = cursor
    const end = cursor + durations[i]
    cursor = end
    return { t: `${fmt(start)}–${fmt(end)}`, ...b }
  })

  return {
    title: `${brandName} — remake of ${rival.brand}'s winner`,
    totalSeconds: durations.reduce((a, b) => a + b, 0),
    product,
    beats,
  }
}

export function creativeBriefs(
  result: FullDnaResult,
  brandName: string,
  niche: string | null,
  max = 2,
): CreativeBrief[] {
  const prescriptions = result.report?.prescriptions || []

  if (prescriptions.length > 0) {
    return prescriptions.slice(0, max).map((rx, i) => {
      const headline = rx.title
      const angle = rx.angle
      const persona = rx.persona
      return {
        key: `brief-${i}`,
        gapLabel: rx.format,
        headline,
        hook: rx.hook,
        angle,
        persona,
        offer: rx.offer,
        prompt: buildPrompt(brandName, niche, headline, angle, persona),
      }
    })
  }

  // No prescriptions → fall back to the raw gaps, filled from the winners' distribution.
  const hook = topLabel(result, 'hook_type') || 'Lead with the strongest proof'
  const angle = topLabel(result, 'angle') || 'Show the transformation'
  const persona = topLabel(result, 'persona') || 'first-time buyer'
  const offer = topLabel(result, 'offer') || 'Limited-time offer'

  return result.gaps
    .filter((g) => g.kind !== 'overused')
    .slice(0, max)
    .map((g, i) => {
      const headline = g.label
      return {
        key: `brief-${i}`,
        gapLabel: g.label,
        headline,
        hook,
        angle,
        persona,
        offer,
        prompt: buildPrompt(brandName, niche, headline, angle, persona),
      }
    })
}
