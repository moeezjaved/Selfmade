/** GET /api/builder/templates — the templates the wizard's picker shows, each with a live preview. */
import { NextResponse } from 'next/server'
import { TEMPLATES, templateCards } from '@/lib/builder/templates'
import type { RenderOpts } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'

// Neutral demo content so every card renders a real, representative miniature of the design
// (copy comes from each template's own defaults; images fall back to the template's soft placeholder).
const DEMO_OPTS: RenderOpts = {
  productName: 'Your Product',
  productImage: '',
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
