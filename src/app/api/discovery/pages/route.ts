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
import { resolveScopedAccount } from '@/lib/meta/scope'
import { createClient, createReadClient } from '@/lib/supabase/server'
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

    const admin = createReadClient()
    const term = q.trim()
    // Accent- AND space/punctuation-insensitive normalize so "bugmd" ⇄ "Bug MD",
    // "gruns" ⇄ "Grüns", "well-being" ⇄ "wellbeing". Strip everything but a-z0-9.
    const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const nq = norm(term)

    // ── 1. Search the tracked-brand list (small, fast) ────────────────
    // We match against discovery_crawl_terms (~few-K rows) — NOT a `ilike '%term%'`
    // over discovery_ads_index. That leading-wildcard seq-scans the whole 700K-row
    // table (~9s under load) on EVERY keystroke — it was the brand-search hang and a
    // top resource hog (the "exhausting resources" warning). The tracked list covers
    // every brand we crawl; we match BOTH directions so a longer typed query
    // ("mars men") still finds a shorter term ("mars") and vice-versa. (Full
    // page_name substring search returns once a pg_trgm GIN index is built via a
    // direct connection — deferred; not worth a per-keystroke seq-scan.)
    // DB-side match (crawl_terms is ~57K rows — the old `.limit(8000)` fetch-then-JS-filter only
    // saw the first 8K, so most brands were invisible to search). Use a SPACE-INSENSITIVE regex
    // (imatch): de-space the query and put `\s*` between each char, so "bugmd" and "bug md" both
    // match the term "bug md". Regex on 57K rows is a fast seq-scan (~tens of ms).
    const rxBody = nq.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
    let trackedHits: string[] = []
    if (nq.length >= 2) {
      const { data: trackedAll } = await (admin as any)
        .from('discovery_crawl_terms')
        .select('page_id, term')
        .not('page_id', 'is', null)
        .filter('term', 'imatch', rxBody)
        .limit(60)
      trackedHits = ((trackedAll || []) as any[]).map((t) => t.page_id)
    }

    const candidatePageIds = Array.from(new Set<string>(trackedHits)).slice(0, 12)

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
    const metaAccount = await resolveScopedAccount(admin, user.id)
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
