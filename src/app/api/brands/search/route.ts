/**
 * Public brand search — powers the /brands search box. Filters the cached indexable-brand list by
 * name (only brands that HAVE a page, so every result links to a real /brands/[slug]). Public, no auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getIndexableBrands } from '@/lib/seo/brands'

export const revalidate = 3600

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  if (q.length < 2) return NextResponse.json({ results: [], total: 0 })
  const brands = await getIndexableBrands()
  const matches = brands.filter((b) => b.name.toLowerCase().includes(q))
  // Prefix matches first (better relevance), then by ad count.
  matches.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
    return ap - bp || b.adCount - a.adCount
  })
  return NextResponse.json({
    total: matches.length,
    results: matches.slice(0, 40).map((b) => ({ slug: b.slug, name: b.name, adCount: b.adCount })),
  })
}
