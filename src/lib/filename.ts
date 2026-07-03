/**
 * Build a human-friendly download filename for a creative, e.g. "Selfmade-Aura-2026-07-03.png"
 * or "Selfmade-Aura-2026-07-03-2.png" for the 2nd variation. Beats opaque ids like "clone-14124…-1".
 */
function slug(s?: string | null): string {
  return (s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-zA-Z0-9]+/g, '-')                     // non-alnum → dash
    .replace(/^-+|-+$/g, '')                            // trim dashes
    .slice(0, 40)
}

export function creativeFilename(opts: {
  brand?: string | null
  ext?: string           // 'png' | 'jpg' | 'mp4' — default 'png'
  date?: Date            // default: now
  index?: number         // 1-based variation number; omitted/1 → no suffix
  kind?: string | null   // optional tag, e.g. 'clone' | 'animated' — only used when no brand
}): string {
  const ext = (opts.ext || 'png').replace(/^\./, '')
  const d = opts.date || new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const brand = slug(opts.brand) || slug(opts.kind) || 'creative'
  const suffix = opts.index && opts.index > 1 ? `-${opts.index}` : ''
  return `Selfmade-${brand}-${ymd}${suffix}.${ext}`
}
