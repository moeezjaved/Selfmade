/**
 * Template registry — the set of page templates the builder offers. Templates are code (versioned),
 * not DB rows. Add a template by importing it here.
 */
import type { PageTemplate, TemplateType } from '../types'
import { advertorialV1 } from './advertorial'
import { listicleV1 } from './listicle'
import { productV1 } from './product'
import { homeV1 } from './home'
import { wellnessV1 } from './wellness'
import { botanicalV1 } from './botanical'
import { radianceV1 } from './radiance'
import { cobaltV1 } from './cobalt'

export const TEMPLATES: PageTemplate[] = [advertorialV1, listicleV1, productV1, homeV1, wellnessV1, botanicalV1, radianceV1, cobaltV1]

// Templates migrated to the BLOCK-NATIVE model: they seed/publish as native sections → editable blocks
// (add/remove/hide/reorder + per-block settings) via pageDocFromContent, instead of a frozen `raw` render.
// Rolled out one template at a time so each is verified before the next. `isBlockNative(id)` gates the
// seeding + publish paths.
export const BLOCK_NATIVE_TEMPLATES = new Set<string>(['cobalt_v1'])
export const isBlockNative = (id?: string | null): boolean => !!id && BLOCK_NATIVE_TEMPLATES.has(id)

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
