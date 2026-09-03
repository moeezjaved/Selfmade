/**
 * Turn a template + FilledContent into HTML. Two outputs:
 *   assembleDocument   → a full standalone HTML doc (our preview iframe + the saved snapshot)
 *   assembleShopifyBody → body_html for a Shopify Page (font link + <style> + content, self-contained)
 */
import type { PageTemplate, FilledContent, RenderOpts } from './types'

const FONT = '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
const escTitle = (s: string) => String(s || 'Landing page').replace(/[<>&"]/g, '')

export function assembleDocument(tpl: PageTemplate, content: FilledContent, opts: RenderOpts): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escTitle(opts.productName)}</title>${FONT}<style>${tpl.css}</style></head><body>${tpl.render(content, opts)}</body></html>`
}

export function assembleShopifyBody(tpl: PageTemplate, content: FilledContent, opts: RenderOpts): string {
  return `${FONT}<style>${tpl.css}</style>${tpl.render(content, opts)}`
}
