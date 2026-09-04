/**
 * Publish a built page to Shopify as NATIVE Online Store 2.0 sections + a JSON template — so it replaces
 * the real product PDP / store home (not a standalone /pages blob), and the merchant can reorder,
 * duplicate, or delete each section inside Shopify's own theme customizer (Atlas-style).
 *
 * How it works:
 *   1. Split the page body (our `.pgbld` HTML) into top-level SECTIONS. Each slice is re-wrapped in the
 *      `.pgbld`(/`.wrap`) context it needs so the shared CSS still applies, making every section
 *      self-contained and safely reorderable.
 *   2. Emit one shared CSS asset (assets/…css) — each section loads it via {{ … | stylesheet_tag }},
 *      deduped by URL, so it survives reorder/removal.
 *   3. Emit one `.liquid` section file per slice, each with a {% schema %} so it appears (named) in the
 *      customizer with move/duplicate/remove.
 *   4. Emit a JSON template listing the sections in order (templates/product.<suffix>.json /
 *      templates/index.json / templates/page.<suffix>.json).
 *
 * Assigning the template + choosing which products it covers lives in publish-theme.ts.
 */

const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');\n"

export type PageKind = 'product' | 'home' | 'advertorial' | 'listicle'
export type PageSection = { key: string; name: string; html: string }
export type ThemeAssets = {
  cssKey: string
  cssValue: string
  sections: { key: string; value: string }[]   // sections/<key>.liquid
  templateKey: string                            // templates/…json
  templateValue: string
  sectionOrder: string[]                         // section ids used in the JSON template
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Return the innerHTML of the first element matching `class` (single class, top-level scan). */
function innerOf(html: string, className: string): { inner: string; start: number; end: number } | null {
  const open = new RegExp(`<(\\w+)([^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*)>`, 'i')
  const m = open.exec(html)
  if (!m) return null
  const tag = m[1].toLowerCase()
  let i = m.index + m[0].length
  const innerStart = i
  let depth = 1
  const tagRe = new RegExp(`<(/?)(${tag})\\b[^>]*?(/?)>`, 'gi')
  tagRe.lastIndex = i
  let t: RegExpExecArray | null
  while ((t = tagRe.exec(html))) {
    if (t[3] === '/' || VOID.has(t[2].toLowerCase())) continue
    if (t[1] === '/') { depth--; if (depth === 0) return { inner: html.slice(innerStart, t.index), start: innerStart, end: t.index } }
    else depth++
  }
  return null
}

/** Split a container's inner HTML into its TOP-LEVEL element children (depth-aware, no DOM lib). */
function topLevelChildren(inner: string): string[] {
  const out: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g
  let depth = 0, startIdx = -1, m: RegExpExecArray | null
  while ((m = tagRe.exec(inner))) {
    const closing = m[1] === '/', selfClose = m[3] === '/' || VOID.has(m[2].toLowerCase())
    if (!closing && selfClose) { if (depth === 0) out.push(inner.slice(m.index, m.index + m[0].length)); continue }
    if (closing) { depth--; if (depth === 0 && startIdx >= 0) { out.push(inner.slice(startIdx, m.index + m[0].length)); startIdx = -1 } }
    else { if (depth === 0) startIdx = m.index; depth++ }
  }
  return out.filter((s) => s.trim())
}

/** A human name for a section, inferred from its content so the customizer list is readable. */
function nameFor(html: string, i: number): string {
  const cls = /class=["']([^"']+)["']/.exec(html)?.[1] || ''
  const h = /<h[1-3][^>]*>([^<]{2,60})/i.exec(html.replace(/<span[^>]*>|<\/span>/g, ''))?.[1]?.trim()
  if (/\bhero\b/.test(cls)) return 'Hero'
  if (/\bfloatcta\b/.test(cls)) return 'Sticky buy bar'
  if (/\b(faqacc|faq)\b/.test(cls)) return 'FAQ'
  if (/\b(revs|gcar|testimonial)\b/.test(cls) || /review|customer/i.test(h || '')) return 'Reviews'
  if (/\b(cmp|compare)\b/.test(cls)) return 'Comparison'
  if (/\b(stats|statgrid)\b/.test(cls)) return 'Stats'
  if (/\b(trio|transband|transform)\b/.test(cls)) return 'Transformation'
  if (/\b(bgrid|benefit)\b/.test(cls)) return 'Benefits'
  return h ? h.slice(0, 40) : `Section ${i + 1}`
}

/**
 * Split the page body into self-contained sections. Each slice is re-wrapped so the shared CSS applies:
 *   • a child of `.wrap`  → `<div class="pgbld"><div class="wrap">…</div></div>`  (contained width)
 *   • a full-bleed band (direct child of `.pgbld`, e.g. a gradient band) → `<div class="pgbld">…</div>`
 */
export function splitPageIntoSections(body: string): PageSection[] {
  const pg = innerOf(body, 'pgbld')
  if (!pg) return [{ key: 'sf-1', name: 'Page', html: body }]   // fallback: whole thing as one section
  const kids = topLevelChildren(pg.inner)
  const slices: { html: string; contained: boolean }[] = []
  for (const kid of kids) {
    const isWrap = /^<\w+[^>]*\bclass=["'][^"']*\bwrap\b/.test(kid)
    if (isWrap) {
      const wi = innerOf(kid, 'wrap')
      if (wi) { for (const inner of topLevelChildren(wi.inner)) slices.push({ html: inner, contained: true }); continue }
    }
    slices.push({ html: kid, contained: false })
  }
  return slices.map((s, i) => ({
    key: `sf-${i + 1}`,
    name: nameFor(s.html, i),
    html: s.contained ? `<div class="pgbld"><div class="wrap">${s.html}</div></div>` : `<div class="pgbld">${s.html}</div>`,
  }))
}

/** Wrap one section's HTML into a Liquid section file, loading the shared CSS + a schema so it's native. */
function liquidSection(cssKey: string, name: string, html: string): string {
  const cssHandle = cssKey.replace(/^assets\//, '')
  return `{{ '${cssHandle}' | asset_url | stylesheet_tag }}
${html}
{% schema %}
{"name": ${JSON.stringify(name.slice(0, 25))}, "settings": [], "presets": [{"name": ${JSON.stringify(name.slice(0, 25))}}]}
{% endschema %}`
}

/** Build every theme asset for a page: the CSS, one section per slice, and the JSON template. */
export function buildThemeAssets(opts: { pageId: string; kind: PageKind; css: string; body: string; templateSuffix: string }): ThemeAssets {
  const slug = `sf-${opts.pageId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
  const cssKey = `assets/${slug}.css`
  const cssValue = FONT_IMPORT + opts.css
  const parts = splitPageIntoSections(opts.body)

  const sections = parts.map((p, i) => {
    const key = `${slug}-${i + 1}`
    return { id: key, key: `sections/${key}.liquid`, value: liquidSection(cssKey, p.name, p.html) }
  })

  // JSON template: order + reference each section. Home replaces templates/index.json; product/page use a suffix.
  const order: Record<string, any> = {}
  const orderArr: string[] = []
  for (const s of sections) { order[s.id] = { type: s.id }; orderArr.push(s.id) }
  const templateValue = JSON.stringify({ sections: order, order: orderArr }, null, 2)

  const templateKey =
    opts.kind === 'home' ? 'templates/index.json'
    : opts.kind === 'product' ? `templates/product.${opts.templateSuffix}.json`
    : `templates/page.${opts.templateSuffix}.json`

  return {
    cssKey, cssValue,
    sections: sections.map((s) => ({ key: s.key, value: s.value })),
    templateKey, templateValue,
    sectionOrder: orderArr,
  }
}
