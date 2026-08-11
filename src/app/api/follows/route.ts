/**
 * Followed brands.
 * GET  /api/follows               → { pageIds: [...], brands: [{page_id, brand_name}] }
 * POST /api/follows { pageId, brandName?, action?:'toggle'|'follow'|'unfollow' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  // Optional scoping (the Competitor Feed uses both): ?brand=<id> → only competitors linked to that
  // brand; ?spied=1 → only spied ones (Brand Spy list, not silent "following"). Without them this stays
  // the full account-wide list it always returned. This is what stops the feed showing rivals from
  // OTHER/deleted brands (the "removed all brands but Feed still shows AlphaInfuse/Iforex" bug).
  const brandParam = req.nextUrl.searchParams.get('brand')
  const spiedOnly = req.nextUrl.searchParams.get('spied') === '1'
  let q = admin.from('followed_brands').select('page_id, brand_name, email_alerts, spied, brand_id').eq('user_id', user.id)
  if (spiedOnly) q = q.eq('spied', true)
  if (brandParam) q = q.eq('brand_id', brandParam)
  const { data } = await q
  const brands = (data || []) as any[]

  // Resolve any missing brand_name from the crawled ads (page_name) — a follow saved without a name
  // was showing the raw page id ("Facebook Page 244668702070242") instead of the real brand.
  const blank = (n?: string) => { const t = String(n ?? '').trim(); return !t || /^\d+$/.test(t) || /^facebook page/i.test(t) }
  const missing = brands.filter(b => blank(b.brand_name)).map(b => String(b.page_id))
  if (missing.length) {
    const { data: named } = await admin.from('discovery_ads_index').select('page_id, page_name').in('page_id', missing).not('page_name', 'is', null).limit(500)
    const nameByPage = new Map<string, string>()
    for (const r of (named || [])) { const pid = String((r as any).page_id); if (!nameByPage.has(pid) && (r as any).page_name) nameByPage.set(pid, String((r as any).page_name)) }
    for (const b of brands) {
      if (blank(b.brand_name) && nameByPage.has(String(b.page_id))) {
        b.brand_name = nameByPage.get(String(b.page_id))
        // Persist so it's fixed everywhere (Brand Spy, alerts, admin) — best-effort, don't block.
        admin.from('followed_brands').update({ brand_name: b.brand_name }).eq('user_id', user.id).eq('page_id', b.page_id).then(() => {}, () => {})
      }
    }
  }
  return NextResponse.json({ pageIds: brands.map(b => b.page_id), brands })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { pageId, brandName, action = 'toggle', email_alerts, brandId, spied } = await req.json()
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // brand_id (migration 117) attaches a competitor to ONE of the user's brands. Nullable — omit it
  // and the follow stays account-level, exactly as before.
  const brand_id = brandId ? String(brandId) : null

  const { data: existing } = await admin
    .from('followed_brands').select('id, brand_id').eq('user_id', user.id).eq('page_id', String(pageId)).maybeSingle()
  const isFollowing = !!existing

  // Set per-brand email alerts (opt-in, 2 credits per email). Follows the brand if not already, so the
  // toggle can be flipped straight from the Brand Spy view.
  if (action === 'set_email') {
    // Enabling alerts from the Brand Spy view implies a spy (spied=true), per the "turning them on auto-spies too" rule.
    if (!isFollowing) await admin.from('followed_brands').insert({ user_id: user.id, page_id: String(pageId), brand_name: brandName || null, email_alerts: !!email_alerts, spied: true, brand_id })
    else await admin.from('followed_brands').update({ email_alerts: !!email_alerts }).eq('user_id', user.id).eq('page_id', String(pageId))
    return NextResponse.json({ following: true, email_alerts: !!email_alerts })
  }

  let following: boolean
  if (action === 'follow' || (action === 'toggle' && !isFollowing)) {
    if (!isFollowing) {
      // spied:true (from onboarding) puts the competitor in Brand Spy immediately — free here, since
      // it's a follow, not the paid /brand-spy action. Default follows stay spied=false (Following only).
      await admin.from('followed_brands').insert({ user_id: user.id, page_id: String(pageId), brand_name: brandName || null, email_alerts: !!email_alerts, brand_id, ...(spied === true ? { spied: true } : {}) })
    } else if (spied === true || (brand_id && !(existing as any).brand_id)) {
      // Already following (e.g. the brand-spy crawl call created the row first, or an account-level
      // onboarding follow). Apply BOTH: promote to spied AND attach the brand. These used to be separate
      // else-if branches, so `spied:true` won and the brand_id was silently dropped — leaving the
      // competitor with brand_id NULL, invisible to a brand-scoped brief. First-assignment wins for
      // brand_id (never move a rival off a brand it's already tied to; migration 117).
      const upd: Record<string, any> = {}
      if (spied === true) upd.spied = true
      if (brand_id && !(existing as any).brand_id) upd.brand_id = brand_id
      if (Object.keys(upd).length) await admin.from('followed_brands').update(upd).eq('user_id', user.id).eq('page_id', String(pageId))
    }
    following = true
  } else {
    if (isFollowing) await admin.from('followed_brands').delete().eq('user_id', user.id).eq('page_id', String(pageId))
    following = false
  }
  return NextResponse.json({ following })
}
