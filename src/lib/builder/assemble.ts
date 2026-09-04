/**
 * Turn a template + FilledContent into HTML. Two outputs:
 *   assembleDocument   → a full standalone HTML doc (our preview iframe + the saved snapshot)
 *   assembleShopifyBody → body_html for a Shopify Page (font link + <style> + content, self-contained)
 */
import type { PageTemplate, FilledContent, RenderOpts } from './types'
import { paletteOverrideCss } from './palettes'

const FONT = '<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
const escTitle = (s: string) => String(s || 'Landing page').replace(/[<>&"]/g, '')

// The chosen palette is a `.pgbld{…}` override appended AFTER the template CSS so it wins the cascade.
const paletteStyle = (opts: RenderOpts) => {
  const css = paletteOverrideCss(opts.paletteId)
  return css ? `<style>${css}</style>` : ''
}

export function assembleDocument(tpl: PageTemplate, content: FilledContent, opts: RenderOpts): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escTitle(opts.productName)}</title>${FONT}<style>${tpl.css}</style>${paletteStyle(opts)}</head><body>${tpl.render(content, opts)}</body></html>`
}

export function assembleShopifyBody(tpl: PageTemplate, content: FilledContent, opts: RenderOpts): string {
  return `${FONT}<style>${tpl.css}</style>${paletteStyle(opts)}${tpl.render(content, opts)}`
}
