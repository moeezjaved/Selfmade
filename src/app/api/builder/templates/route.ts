/** GET /api/builder/templates — the templates the wizard's picker shows, each with a live preview. */
import { NextResponse } from 'next/server'
import { TEMPLATES, templateCards } from '@/lib/builder/templates'
import type { RenderOpts } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'

// A neutral inline product mockup so preview thumbnails show a "sample product" everywhere an image would
// appear (instead of blank), helping users picture the final page. Inline SVG → always renders, no network.
const SAMPLE_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 440'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#eef1f7'/><stop offset='1' stop-color='#e3e7f2'/></linearGradient></defs><rect width='400' height='440' fill='url(#g)'/><rect x='158' y='96' width='84' height='250' rx='20' fill='#ffffff' stroke='#d5dae8' stroke-width='3'/><rect x='182' y='66' width='36' height='36' rx='8' fill='#c9d0e4'/><rect x='172' y='168' width='56' height='120' rx='10' fill='#eef1fb'/><circle cx='200' cy='150' r='10' fill='#cdd5ec'/><text x='200' y='392' font-family='Inter,system-ui,sans-serif' font-size='17' fill='#9aa3bd' text-anchor='middle'>Sample product</text></svg>`,
)

// Neutral demo content so every card renders a real, representative miniature of the design (copy comes
// from each template's own defaults; a sample product image fills the hero + gallery so nothing looks blank).
const DEMO_OPTS: RenderOpts = {
  productName: 'Your Product',
  productImage: SAMPLE_IMAGE,
  priceLabel: '$49',
  ctaHref: '#',
  rating: { stars: 4.9, countLabel: '2,431 reviews' },
}

// Turn each template's dashed image placeholders into clean soft-tinted blocks so the thumbnail
// reads as a finished design rather than a wireframe.
const PREVIEW_CSS = `body{margin:0}.pgbld .ph{border:none!important}.pgbld .ph .phi,.pgbld .ph .phl,.pgbld .ph .phi svg{display:none!important}`

export async function GET() {
  const cards = templateCards().map((c) => {
    const tpl = TEMPLATES.find((t) => t.id === c.id)
    let preview: string | null = null
    if (tpl) {
      try {
        const body = tpl.render({}, DEMO_OPTS)
        preview = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1180"><style>${tpl.css}\n${PREVIEW_CSS}</style></head><body>${body}</body></html>`
      } catch {
        preview = null // card falls back to its gradient thumbnail
      }
    }
    return { ...c, preview }
  })
  return NextResponse.json({ templates: cards })
}
