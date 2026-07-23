/**
 * GET /api/search?q= — universal knowledge search. "Search by knowledge, not by menu."
 * Sectioned results across object types: Brands (brand_directory), Knowledge concepts
 * (the creative-DNA taxonomy → deep-links into the library), Collections, and the raw
 * ad-library search. Public + cheap by design (one ILIKE + static matching) so ⌘K
 * feels instant; it powers both the palette and /search.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createReadClient } from '@/lib/supabase/server'
import { HOOKS, FORMAT_STYLES, VISUAL_STYLES, EMOTIONS, ANGLES, COLLECTIONS, hookHref, formatHref } from '@/lib/knowledge/taxonomy'

export const dynamic = 'force-dynamic'

type Item = { label: string; sub?: string; href: string; kind: string }
const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) {
    // Empty state: the front doors of the graph
    return NextResponse.json({
      sections: [
        { title: 'Start here', items: [
          { label: "Today's Edition", sub: 'what changed in the market', href: '/discover', kind: 'edition' },
          ...COLLECTIONS.map((c) => ({ label: c.name, sub: c.sub, href: c.href, kind: 'collection' })),
        ] },
      ],
    })
  }
  const ql = q.toLowerCase()
  const sections: { title: string; items: Item[] }[] = []

  // Knowledge concepts — taxonomy matching, zero DB cost
  const concepts: Item[] = []
  for (const h of HOOKS) if (h.toLowerCase().includes(ql)) concepts.push({ label: h, sub: 'hook · open every ad using it', href: hookHref(h), kind: 'hook' })
  for (const f of FORMAT_STYLES) if (f.toLowerCase().includes(ql)) concepts.push({ label: f, sub: 'format · open the library', href: formatHref(f), kind: 'format' })
  for (const v of VISUAL_STYLES) if (v.toLowerCase().includes(ql)) concepts.push({ label: v, sub: 'visual style', href: `/discovery?visual_style=${encodeURIComponent(v)}&sort=recommended`, kind: 'visual' })
  for (const e of EMOTIONS) if (e.includes(ql)) concepts.push({ label: e[0].toUpperCase() + e.slice(1), sub: 'emotion', href: `/discovery?emotion=${encodeURIComponent(e)}&sort=recommended`, kind: 'emotion' })
  for (const a of ANGLES) if (a.toLowerCase().includes(ql) && !HOOKS.includes(a)) concepts.push({ label: a, sub: 'angle', href: `/discovery?angle=${encodeURIComponent(a)}&sort=recommended`, kind: 'angle' })
  if (concepts.length) sections.push({ title: 'Knowledge', items: concepts.slice(0, 6) })

  // Collections
  const cols = COLLECTIONS.filter((c) => c.name.toLowerCase().includes(ql) || c.sub.toLowerCase().includes(ql))
    .map((c) => ({ label: c.name, sub: c.sub, href: c.href, kind: 'collection' }))
  if (cols.length) sections.push({ title: 'Collections', items: cols })

  // Brands — one bounded ILIKE over the 611K-brand directory
  try {
    const admin = createReadClient() as any
    const { data: brands } = await admin
      .from('brand_directory')
      .select('page_id, name, industry, country, source_ad_count')
      .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
      .order('source_ad_count', { ascending: false, nullsFirst: false })
      .limit(6)
    const items: Item[] = (brands || [])
      .filter((b: any) => !isBlankName(b.name))
      .map((b: any) => ({
        label: b.name,
        sub: [b.industry, b.country, b.source_ad_count ? `${Number(b.source_ad_count).toLocaleString()} ads on record` : null].filter(Boolean).join(' · '),
        href: `/knowledge/brand/${b.page_id}`,
        kind: 'brand',
      }))
    if (items.length) sections.push({ title: 'Brands', items })
  } catch { /* directory hiccup → other sections still answer */ }

  // Always offer the raw library
  sections.push({ title: 'Ad library', items: [{ label: `Search all ads for “${q}”`, sub: 'full-text across the corpus', href: `/discovery?q=${encodeURIComponent(q)}`, kind: 'ads' }] })

  return NextResponse.json({ sections })
}
