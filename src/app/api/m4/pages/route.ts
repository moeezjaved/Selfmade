import { NextRequest, NextResponse } from 'next/server'
import { resolveBrandScopedAccount, resolveScopedAccount } from '@/lib/meta/scope'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // When the launcher passes an explicit account_id (the account picker), scope to THAT account so pages
  // match where the ad will run — not the brand-fallback primary (which showed another account's pages).
  const acctId = request.nextUrl.searchParams.get('account_id') || ''
  const metaAccount = acctId ? await resolveScopedAccount(admin, user.id, acctId) : await resolveBrandScopedAccount(admin, user.id)

  if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(metaAccount.access_token)

  try {
    // Page through ALL the Pages this person manages — /me/accounts is paginated (default ~25) and the
    // old limit:20 silently dropped everyone past the first batch. Follow paging.next until exhausted.
    const fields = 'id,name,category,fan_count,access_token,instagram_business_account,connected_instagram_account,about,description,products,website'
    let next: string | null = `https://graph.facebook.com/${V}/me/accounts?` + new URLSearchParams({ fields, access_token: token, limit: '100' })
    const rawPages: any[] = []
    for (let guard = 0; next && guard < 20; guard++) {   // up to ~2000 pages
      const res: Response = await fetch(next)
      const data: any = await res.json()
      if (data.error) throw new Error(data.error.message)
      if (Array.isArray(data.data)) rawPages.push(...data.data)
      next = data.paging?.next || null
    }

    // ALSO pages the ad account can advertise for via Business Manager — owned_pages + client_pages. These
    // are NOT in /me/accounts when you're not a direct Page admin (e.g. "Shopoo", run by ROY1's business),
    // so without this the Page the ad actually posts from was missing from the picker.
    try {
      const bizRes = await fetch(`https://graph.facebook.com/${V}/me/businesses?fields=id&limit=50&access_token=${encodeURIComponent(token)}`)
      const biz: any = await bizRes.json()
      const bizIds: string[] = (Array.isArray(biz?.data) ? biz.data : []).map((b: any) => String(b.id)).slice(0, 20)
      const bizFields = 'id,name,category,fan_count,access_token,instagram_business_account,connected_instagram_account,about,description,products,website'
      await Promise.all(bizIds.flatMap((bid) => ['owned_pages', 'client_pages'].map(async (edge) => {
        try {
          const pr = await fetch(`https://graph.facebook.com/${V}/${bid}/${edge}?` + new URLSearchParams({ fields: bizFields, access_token: token, limit: '200' }))
          const pd: any = await pr.json()
          if (Array.isArray(pd?.data)) rawPages.push(...pd.data)
        } catch { /* per-edge best-effort */ }
      })))
    } catch { /* businesses best-effort — /me/accounts pages still returned */ }

    // De-dupe by id (a Page can appear under multiple businesses) and sort by reach.
    const seen = new Set<string>()
    const uniq = rawPages.filter((p) => p?.id && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => (b.fan_count || 0) - (a.fan_count || 0))

    // For each page fetch Instagram using page token. Cap the IG lookups (they're an extra Graph call each)
    // to the top pages so a big Page portfolio doesn't time out — the rest still appear, just without the
    // "+ Instagram" badge (it resolves when that Page is actually selected/launched).
    const pages = await Promise.all(uniq.map(async (p: any, idx: number) => {
      let instagram = null
      const pageToken = p.access_token || token
      if (idx >= 50) return { id: p.id, name: p.name, category: p.category, fan_count: p.fan_count, instagram: null, about: p.about || p.products || p.description || '', website: p.website || '' }

      // Try all known Instagram fields
      try {
        const igRes = await fetch(
          `https://graph.facebook.com/${V}/${p.id}?` +
          new URLSearchParams({
            fields: 'instagram_business_account{id,username,name},connected_instagram_account{id,username,name}',
            access_token: pageToken,
          })
        )
        const igData = await igRes.json()
        console.log('IG data for', p.name, ':', JSON.stringify(igData))
        
        const ig = igData.instagram_business_account || igData.connected_instagram_account
        if (ig?.id) {
          instagram = { id: ig.id, username: ig.username || 'instagram', name: ig.name || ig.username }
        }
      } catch(e: any) { console.log('IG fetch error:', e.message) }

      // Use about > products > description — in order of usefulness for ad targeting context
      const pageAbout = p.about || p.products || p.description || ''
      return { id: p.id, name: p.name, category: p.category, fan_count: p.fan_count, instagram, about: pageAbout, website: p.website || '' }
    }))
    
    return NextResponse.json({ pages })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
