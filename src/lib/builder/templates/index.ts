/**
 * Template registry — the set of page templates the builder offers. Templates are code (versioned),
 * not DB rows. Add a template by importing it here.
 */
import type { PageTemplate, TemplateType } from '../types'
import { advertorialV1 } from './advertorial'
import { listicleV1 } from './listicle'

export const TEMPLATES: PageTemplate[] = [advertorialV1, listicleV1]

export function getTemplate(id: string): PageTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function templatesByType(type: TemplateType): PageTemplate[] {
  return TEMPLATES.filter((t) => t.type === type)
}

/** Lightweight list for the wizard's template picker (no css/render). */
export function templateCards() {
  return TEMPLATES.map((t) => ({ id: t.id, type: t.type, name: t.name, description: t.description, thumbnail: t.thumbnail }))
}
