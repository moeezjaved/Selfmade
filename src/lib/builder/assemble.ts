/**
 * Turn a template + FilledContent into HTML. Two outputs:
 *   assembleDocument   → a full standalone HTML doc (our preview iframe + the saved snapshot)
 *   assembleShopifyBody → body_html for a Shopify Page (font link + <style> + content, self-contained)
 */
import type { PageTemplate, FilledContent, RenderOpts } from './types'
import { paletteOverrideCss } from './palettes'
import { editorChrome } from './editorRuntime'

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

export function assembleShopifyBody(tpl: PageTemplate, content: FilledContent, opts: RenderOpts, editedHtml?: string | null): string {
  return `${FONT}<style>${tpl.css}</style>${paletteStyle(opts)}${bodyHtml(tpl, content, opts, editedHtml)}`
}

/**
 * The page BODY — the visual editor's `edited_html` when the page has been hand-edited (the "page is the
 * document" model), otherwise a fresh render from the slots. One helper so preview + publish + editor all
 * agree on which source wins.
 */
export function bodyHtml(tpl: PageTemplate, content: FilledContent, opts: RenderOpts, editedHtml?: string | null): string {
  return editedHtml && editedHtml.trim() ? editedHtml : tpl.render(content, opts)
}

/** Full standalone doc that RESPECTS an edited_html snapshot — used by preview + the saved snapshot. */
export function assembleDocumentEdited(tpl: PageTemplate, content: FilledContent, opts: RenderOpts, editedHtml?: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escTitle(opts.productName)}</title>${FONT}<style>${tpl.css}</style>${paletteStyle(opts)}</head><body>${bodyHtml(tpl, content, opts, editedHtml)}</body></html>`
}

/** The editor document — the live page + the injected click-anywhere runtime. NEVER used for publish. */
export function assembleEditorDocument(tpl: PageTemplate, content: FilledContent, opts: RenderOpts, editedHtml?: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escTitle(opts.productName)}</title>${FONT}<style>${tpl.css}</style>${paletteStyle(opts)}</head><body>${bodyHtml(tpl, content, opts, editedHtml)}${editorChrome()}</body></html>`
}
