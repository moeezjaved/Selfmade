/**
 * Top Brands — returns brands with most ads for a given search/category.
 * Powers the horizontal brand strip above search results (like Atria).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ brands: [] })

    const admin = createAdminClient()
    const { searchParams } = request.nextUrl
    const q = (searchParams.get('q') || '').trim()
    const mode = searchParams.get('mode') || 'adcopy'
    const industry = searchParams.get('industry') || ''
    const country = searchParams.get('country') || 'US'
    const status = searchParams.get('status') || 'ALL'

    // BRAND mode — the user clicked a specific brand (e.g. "Mars Men"). The grid
    // filters by page_name ONLY, so the strip must too. The content-searching RPC
    // would otherwise surface affiliate pages (e.g. Chuck Liddell) whose ad COPY
    // mentions the brand, making the strip inconsistent with the grid.
    if (q && mode === 'brand') {
      let bq = admin
        .from('discovery_ads_index')
        .select('page_id, page_name')
        .ilike('page_name', `%${q}%`)
      if (country && country !== 'ALL') bq = bq.eq('country', country)
      if (status === 'ACTIVE') bq = bq.eq('is_active', true)
      if (status === 'INACTIVE') bq = bq.eq('is_active', false)

      const counts: Record<string, { name: string; count: number }> = {}
      // paginate (PostgREST caps at 1000) so big brands count fully
      for (let off = 0; off < 50_000; off += 1000) {
        const { data: rows } = await bq.range(off, off + 999)
        const chunk = rows || []
        for (const ad of chunk) {
          if (!ad.page_id) continue
          if (!counts[ad.page_id]) counts[ad.page_id] = { name: ad.page_name, count: 0 }
          counts[ad.page_id].count++
        }
        if (chunk.length < 1000) break
      }
      const brands = Object.entries(counts)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 12)
        .map(([pageId, { name, count }]) => ({ pageId, name, adCount: count, picture: null }))
      return NextResponse.json({ brands })
    }

    // ── KEYWORD/CONCEPT search — must match the GRID exactly ──────────────────
    // The grid (db-search) matches across copy, brand_categories, topics AND
    // industries (with a compound "active wear"⇄"activewear" variant). The old RPC
    // only searched ad COPY, so a brand tagged `activewear` via TOPICS — but whose
    // copy never says the word (e.g. TEN THOUSAND) — flooded the grid yet was absent
    // from this strip. Replicate the grid's matcher so the strip is consistent.
    if (q) {
      const clean = (s: string) => s.replace(/[,(){}]/g, ' ').replace(/\s+/g, ' ').trim()
      const lcPhrase = clean(q).toLowerCase()
      const compound = lcPhrase.replace(/\s+/g, '')
      const words = lcPhrase.split(/\s+/).filter(w => w.length > 1).slice(0, 6)
      const textVariants = Array.from(new Set([lcPhrase, compound].filter(Boolean)))
      const tagVariants = Array.from(new Set([lcPhrase, compound, ...words].filter(Boolean)))
      const keywordOr = [
        ...textVariants.flatMap(v => [`body.ilike.%${v}%`, `title.ilike.%${v}%`, `description.ilike.%${v}%`, `page_name.ilike.%${v}%`]),
        ...tagVariants.flatMap(v => [`brand_categories.cs.{${v}}`, `topics.cs.{${v}}`, `industries.cs.{${v}}`]),
      ].join(',')

      const counts: Record<string, { name: string; hashes: Set<string> }> = {}
      for (let off = 0; off < 10_000; off += 1000) {
        let bq = admin
          .from('discovery_ads_index')
          .select('page_id, page_name, image_hash, video_hash, ad_id')
          .or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%')
          .or(keywordOr)
        if (country && country !== 'ALL') bq = bq.or(`targeted_countries.cs.{${country}},country.eq.${country}`)
        if (industry) {
          const inds = industry.split(',').map(s => s.trim()).filter(Boolean)
          bq = bq.or(inds.flatMap(i => [`industries.cs.{${i}}`, `brand_categories.cs.{${i}}`]).join(','))
        }
        if (status === 'ACTIVE') bq = bq.eq('is_active', true)
        if (status === 'INACTIVE') bq = bq.eq('is_active', false)
        const { data: rows } = await bq.range(off, off + 999)
        const chunk = (rows || []) as any[]
        for (const ad of chunk) {
          if (!ad.page_id) continue
          if (!counts[ad.page_id]) counts[ad.page_id] = { name: ad.page_name, hashes: new Set<string>() }
          const c = counts[ad.page_id]
          // count UNIQUE creatives per brand (match the grid's dedup)
          c.hashes.add(ad.image_hash || ad.video_hash || `_${ad.ad_id}`)
          if (ad.page_name) c.name = ad.page_name
        }
        if (chunk.length < 1000) break
      }
      const brands = Object.entries(counts)
        .map(([pageId, v]) => ({ pageId, name: v.name, adCount: v.hashes.size, picture: null }))
        .sort((a, b) => b.adCount - a.adCount)
        .slice(0, 12)
      return NextResponse.json({ brands })
    }

    // ── No query (browsing all) — overall top brands via RPC ──────────────────
    const { data, error } = await admin.rpc('get_top_brands', {
      search_query: null,
      filter_industry: industry || null,
      filter_country: country === 'ALL' ? null : country,
      filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
      result_limit: 12,
    })
    if (error || !data?.length) return NextResponse.json({ brands: [] })
    return NextResponse.json({
      brands: data.map((b: any) => ({ pageId: b.page_id, name: b.page_name, adCount: b.ad_count, picture: null })),
    })
  } catch (err: any) {
    return NextResponse.json({ brands: [] })
  }
}
