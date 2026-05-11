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

    // ── 1. Search our own indexed DB ──────────────────────────────
    // Pull a sample of matching ads to identify distinct brands. Limit 500 is
    // enough to surface ~6 unique brand names without scanning the full table.
    const { data: rows } = await (admin as any)
      .from('discovery_ads_index')
      .select('page_id, page_name')
      .ilike('page_name', `%${term}%`)
      .not('page_id', 'is', null)
      .not('page_name', 'is', null)
      .limit(500)

    if (rows && rows.length > 0) {
      // Group by page_id, count partial sample, keep name
      const byPage = new Map<string, { name: string; partial: number }>()
      for (const r of rows as any[]) {
        const pid = r.page_id
        if (!pid) continue
        const existing = byPage.get(pid)
        if (existing) existing.partial++
        else byPage.set(pid, { name: r.page_name, partial: 1 })
      }

      // Top 6 by partial count (best guess at "most relevant" before exact count)
      const candidates = Array.from(byPage.entries())
        .sort((a, b) => b[1].partial - a[1].partial)
        .slice(0, 6)
      const candidatePageIds = candidates.map(([pid]) => pid)

      // Lookup pictures from discovery_crawl_terms in one batched query
      const { data: termRows } = await (admin as any)
        .from('discovery_crawl_terms')
        .select('page_id, picture')
        .in('page_id', candidatePageIds)
      const pictureByPage = new Map<string, string>()
      for (const t of (termRows || []) as any[]) {
        if (t.page_id && t.picture) pictureByPage.set(t.page_id, t.picture)
      }

      // Exact ad counts per page in parallel — estimated count is fast on big tables
      const withCounts = await Promise.all(
        candidates.map(async ([pid, info]) => {
          let adCount: number | string = info.partial
          try {
            const { count } = await (admin as any)
              .from('discovery_ads_index')
              .select('*', { count: 'estimated', head: true })
              .eq('page_id', pid)
            if (count != null) adCount = count
          } catch { /* keep partial */ }
          return {
            pageId: pid,
            name: info.name,
            picture: pictureByPage.get(pid) || null,
            category: '',
            adCount,
          }
        })
      )

      // Re-sort by accurate ad count, biggest brands first
      withCounts.sort((a, b) => (Number(b.adCount) || 0) - (Number(a.adCount) || 0))
      return NextResponse.json({ pages: withCounts })
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
