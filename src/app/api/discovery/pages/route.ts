/**
 * Brand autocomplete for the discovery search bar.
 *
 * Atria-style: queries our OWN indexed ad DB (not Meta API), so it's:
 *   • instant (no external HTTP roundtrip)
 *   • rate-limit-immune
 *   • shows real cross-country ad counts from what we've actually indexed
 *
 * Falls back to Meta's pages/search only if our DB has zero matches and the
 * user has a connected Meta account — useful for brands we haven't crawled yet.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q') || ''
  if (!q.trim() || q.trim().length < 2) return NextResponse.json({ pages: [] })

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ pages: [] })

    const admin = createAdminClient()
    const term = q.trim()
    // Accent/diacritic-insensitive normalize: "gruns" ⇄ "Grüns", "cafe" ⇄ "café".
    const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const nq = norm(term)

    // ── 1. Search our own indexed DB ──────────────────────────────
    // Source A — ad index by page_name (handles exact + accented matches).
    const { data: rows } = await (admin as any)
      .from('discovery_ads_index')
      .select('page_id, page_name')
      .ilike('page_name', `%${term}%`)
      .not('page_id', 'is', null)
      .not('page_name', 'is', null)
      .limit(500)

    // Source B — tracked brands by the name the USER typed when adding them
    // (discovery_crawl_terms.term). This is accent-insensitive: a brand added as
    // "gruns" is found even though its page_name is "Grüns". Bounded table, so we
    // fetch and match in JS with the normalize() above.
    const { data: trackedAll } = await (admin as any)
      .from('discovery_crawl_terms')
      .select('page_id, term')
      .not('page_id', 'is', null)
      .limit(5000)
    const trackedHits: string[] = ((trackedAll || []) as any[])
      .filter((t) => t.term && norm(t.term).includes(nq))
      .map((t) => t.page_id)

    // Union candidate page_ids from both sources.
    const candidatePageIds = Array.from(new Set<string>([
      ...((rows || []) as any[]).map((r) => r.page_id),
      ...trackedHits,
    ])).slice(0, 12)

    if (candidatePageIds.length > 0) {
      // Pictures from discovery_crawl_terms in one batched query
      const { data: termRows } = await (admin as any)
        .from('discovery_crawl_terms')
        .select('page_id, picture')
        .in('page_id', candidatePageIds)
      const pictureByPage = new Map<string, string>()
      for (const t of (termRows || []) as any[]) {
        if (t.page_id && t.picture) pictureByPage.set(t.page_id, t.picture)
      }

      // Per page: canonical name (most common page_name = real brand, not a
      // partnership ad's name) + estimated ad count.
      const withCounts = await Promise.all(
        candidatePageIds.map(async (pid) => {
          let adCount: number | string = 0
          let name = ''
          try {
            const { data: sample, count } = await (admin as any)
              .from('discovery_ads_index')
              .select('page_name', { count: 'estimated' })
              .eq('page_id', pid)
              .not('page_name', 'is', null)
              .limit(400)
            if (count != null) adCount = count
            const freq: Record<string, number> = {}
            for (const r of (sample || []) as any[]) {
              const n = (r.page_name || '').trim()
              if (n) freq[n] = (freq[n] || 0) + 1
            }
            name = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
          } catch { /* keep defaults */ }
          return { pageId: pid, name, picture: pictureByPage.get(pid) || null, category: '', adCount }
        })
      )

      // Biggest brands first
      withCounts.sort((a, b) => (Number(b.adCount) || 0) - (Number(a.adCount) || 0))
      return NextResponse.json({ pages: withCounts.filter((b) => b.name).slice(0, 6) })
    }

    // ── 2. Fallback: Meta pages/search ────────────────────────────
    // Only used if our DB returned nothing. Requires a connected Meta account.
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ pages: [] })

    const userToken = decryptToken(metaAccount.access_token)
    const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    const token = userToken || appToken

    const pagesUrl = `https://graph.facebook.com/${V}/pages/search?` + new URLSearchParams({
      q: term,
      fields: 'id,name,picture{url},fan_count,category',
      access_token: token,
      limit: '6',
    })
    const pagesRes = await fetch(pagesUrl)
    const pagesData = await pagesRes.json()
    if (pagesData.error) return NextResponse.json({ pages: [] })

    const pages = (pagesData.data || []).map((p: any) => ({
      pageId: p.id,
      name: p.name,
      picture: p.picture?.data?.url || null,
      fanCount: p.fan_count || 0,
      category: p.category || '',
      adCount: 0, // unknown — not in our index yet
    }))

    return NextResponse.json({ pages })
  } catch {
    return NextResponse.json({ pages: [] })
  }
}
