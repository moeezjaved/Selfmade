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
