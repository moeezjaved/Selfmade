/**
 * /api/ads-studio/your-ads — the user's OWN live ads (the ads audit). A website URL can't surface these,
 * so we key off a Meta page id resolved from the founder's Facebook Ad Library link. The page id is stored
 * on the brand at brand_kit.ownMetaPageId (captured in the landing form / onboarding, or pasted here).
 *
 *  GET  → { ads, pageId }        fetch this brand's live ads from the Meta Ad Library (via the droplet).
 *  POST { link|pageId } → { pageId }   save/replace the brand's Meta page id, then GET returns its ads.
 *
 * fbcdn media is proxied through /api/ads-studio/media (R2 cache) — never hotlinked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { fetchLiveAdsByPage } from '@/lib/ads-studio/adlibrary'

export const dynamic = 'force-dynamic'

// Pull a Meta page id out of an Ad Library link (view_all_page_id=… / page_id=… / …/<id>) or a bare id.
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  if (/^\d{5,}$/.test(t)) return t
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  return m ? m[1] : null
}

const mediaUrl = (u: string | null | undefined) => {
  if (!u) return null
  return /fbcdn|xx\.fbcdn|scontent/i.test(u) ? `/api/ads-studio/media?u=${encodeURIComponent(u)}` : u
}

async function resolve(): Promise<{ admin: any; brandId: string; kit: any; userId: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  if (!brandId) return null
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  return { admin, brandId, userId: user.id, kit: (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {} }
}

export async function GET() {
  const r = await resolve()
  if (!r) return NextResponse.json({ ads: [], pageId: null })
  // Prefer the pasted/onboarding page; else fall back to the CONNECTED Meta account's page so Your Ads
  // auto-shows for founders who connected Meta but never pasted an Ad Library link.
  let pageId = r.kit?.ownMetaPageId ? String(r.kit.ownMetaPageId) : null
  let connected = false
  if (!pageId) {
    const { data: acct } = await r.admin.from('meta_accounts').select('page_id').eq('user_id', r.userId).eq('is_primary', true).maybeSingle()
    if (acct?.page_id) { pageId = String(acct.page_id); connected = true }
  }
  if (!pageId) return NextResponse.json({ ads: [], pageId: null })
  try {
    const live = await fetchLiveAdsByPage(pageId, 24)
    const ads = live.map((a) => ({
      adId: a.adId, title: a.title || a.pageName, body: a.body || '', isActive: a.isActive,
      image: mediaUrl(a.images?.[0] || a.videoPreviews?.[0] || null), link: a.link || '',
      isVideo: (a.videos?.length || 0) > 0 && !(a.images?.length || 0),
    }))
    return NextResponse.json({ ads, pageId })
  } catch { return NextResponse.json({ ads: [], pageId }) }
}

export async function POST(req: NextRequest) {
  const r = await resolve()
  if (!r) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const pageId = extractPageId(String(body.pageId || body.link || ''))
  if (!pageId) return NextResponse.json({ error: 'Paste a valid Facebook Ad Library link.' }, { status: 400 })
  await r.admin.from('brands').update({ brand_kit: { ...r.kit, ownMetaPageId: pageId } }).eq('id', r.brandId)
  return NextResponse.json({ pageId })
}
