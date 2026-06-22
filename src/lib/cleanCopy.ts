// Meta dynamic-creative ads store their primary text as a TEMPLATE containing
// mustache tokens like {{product.brand}}, {{product.name}}, {{product.current_price}}.
// When Meta renders the ad it substitutes real values, but the Ad Library (and so
// our crawl) captures the raw template — so the tokens leak into our UI as literal
// "{{product.brand}}" strings. Strip them everywhere ad copy is shown.
//
// Returns the cleaned primary text. If, after stripping tokens, nothing meaningful
// is left (the body was ONLY tokens), it falls through to the provided fallbacks
// (e.g. on-screen/vision text, then headline) so the card still says something.
export function cleanCopy(
  body?: string | null,
  ...fallbacks: (string | null | undefined)[]
): string {
  const clean = (s?: string | null) =>
    (s || '')
      .replace(/\{\{[^}]*\}\}/g, '')      // drop {{mustache}} tokens
      .replace(/[ \t]{2,}/g, ' ')          // collapse runs of spaces/tabs (keep newlines)
      .replace(/^[ \t]+|[ \t]+$/gm, '')    // trim each line
      .replace(/\n{3,}/g, '\n\n')          // cap consecutive blank lines
      .replace(/\s*([,.;:!?])\s*\1+/g, '$1') // de-dupe punctuation left after a token
      .trim()

  const main = clean(body)
  if (main.length >= 3) return main
  for (const f of fallbacks) {
    const c = clean(f)
    if (c.length >= 3) return c
  }
  return ''
}
