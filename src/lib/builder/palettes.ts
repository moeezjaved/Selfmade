/**
 * Preset colour palettes for the Page Builder (Atlas-style). The merchant picks one in the wizard;
 * the whole generated page re-skins because every template drives its look from the same CSS vars
 * (--accent / --accent2 / --grad / --dark / --ink / --paper). We only override those, keeping a light
 * ground + dark text for readability, exactly like Atlas's palette row.
 *
 * `swatch` is the 3-chip preview shown in the picker (light · accent · dark). `vars` is injected as a
 * `.pgbld{…}` override after the template CSS (see assemble.ts). Default is the pink→purple house look.
 */
export interface BuilderPalette {
  id: string
  name: string
  swatch: [string, string, string]
  vars: { accent: string; accent2: string; ink: string; paper: string; dark: string }
}

export const PALETTES: BuilderPalette[] = [
  { id: 'berry',   name: 'Berry',    swatch: ['#f8f6fb', '#d6248f', '#7b2ff7'], vars: { accent: '#d6248f', accent2: '#7b2ff7', ink: '#1a1720', paper: '#f8f6fb', dark: '#1a1720' } },
  { id: 'mono',    name: 'Mono',     swatch: ['#f7f7f8', '#6b7280', '#111114'], vars: { accent: '#111114', accent2: '#4b5563', ink: '#111114', paper: '#f6f6f7', dark: '#111114' } },
  { id: 'navy',    name: 'Navy',     swatch: ['#f4f6fb', '#2f4d8f', '#0f1a33'], vars: { accent: '#2f4d8f', accent2: '#5a78c4', ink: '#101828', paper: '#f4f6fb', dark: '#0f1a33' } },
  { id: 'forest',  name: 'Forest',   swatch: ['#f1f7f2', '#1f8a55', '#14261c'], vars: { accent: '#1f8a55', accent2: '#3fae72', ink: '#12261b', paper: '#f1f7f2', dark: '#14261c' } },
  { id: 'sunset',  name: 'Sunset',   swatch: ['#fdf6ee', '#e0851e', '#7b2ff7'], vars: { accent: '#e0851e', accent2: '#7b2ff7', ink: '#241a12', paper: '#fdf6ee', dark: '#241a12' } },
  { id: 'lagoon',  name: 'Lagoon',   swatch: ['#eef8fb', '#0ea5b7', '#2c3a17'], vars: { accent: '#0ea5b7', accent2: '#3f5220', ink: '#0f2027', paper: '#eef8fb', dark: '#12222a' } },
  { id: 'camel',   name: 'Camel',    swatch: ['#faf6ef', '#b0834e', '#22324f'], vars: { accent: '#b0834e', accent2: '#24324f', ink: '#20242c', paper: '#faf6ef', dark: '#20242c' } },
  { id: 'ember',   name: 'Ember',    swatch: ['#fbf5f1', '#e0330a', '#1a1412'], vars: { accent: '#e0330a', accent2: '#ff6a3d', ink: '#1a1412', paper: '#fbf5f1', dark: '#1a1412' } },
  { id: 'grape',   name: 'Grape',    swatch: ['#fbf6ef', '#f26a1b', '#4a1d6e'], vars: { accent: '#f26a1b', accent2: '#4a1d6e', ink: '#221a2b', paper: '#fbf6ef', dark: '#2a1740' } },
]

export const DEFAULT_PALETTE_ID = 'berry'

export function getPalette(id?: string | null): BuilderPalette {
  return PALETTES.find((p) => p.id === id) || PALETTES[0]
}

/** The `.pgbld{…}` override string for a palette (empty for the default so nothing changes). */
export function paletteOverrideCss(id?: string | null): string {
  if (!id || id === DEFAULT_PALETTE_ID) return ''
  const p = getPalette(id)
  const v = p.vars
  return `.pgbld{--accent:${v.accent};--accent2:${v.accent2};--grad:linear-gradient(100deg,${v.accent},${v.accent2});--ink:${v.ink};--paper:${v.paper};--dark:${v.dark}}`
}
