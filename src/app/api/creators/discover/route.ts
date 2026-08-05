/**
 * POST /api/creators/discover — find Instagram creators by country + follower range + niche (via the Apify
 * actor) and save them into the pipeline as 'sourced'. Also handles manual add ({ handles } / { manual }).
 * Returns { needsToken } when APIFY_TOKEN isn't set yet so the UI can prompt — manual add still works.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { discoverCreators, type CreatorCandidate } from '@/lib/creators/discover'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 150

async function firstBrand(admin: any, userId: string): Promise<string | null> {
  try { const { data } = await admin.from('brands').select('id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(); return data?.id || null } catch { return null }
}

async function saveCandidates(admin: any, userId: string, brandId: string | null, cands: CreatorCandidate[], source: string): Promise<number> {
  let saved = 0
  for (const c of cands) {
    if (!c.handle) continue
    const { error } = await admin.from('creators').upsert({
      user_id: userId, brand_id: brandId, platform: 'instagram', handle: c.handle,
      full_name: c.fullName || null, profile_url: c.profileUrl || null, avatar_url: c.avatarUrl || null,
      followers: c.followers ?? null, engagement_rate: c.engagementRate ?? null, category: c.category || null,
      bio: c.bio || null, country: c.country || null, email: c.email || null, phone: c.phone || null,
      source, stage: 'sourced', updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform,handle', ignoreDuplicates: false })
    if (!error) saved++
  }
  return saved
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const brandId = await firstBrand(admin, user.id)

  // Manual add — one or more handles pasted by the founder.
  const handlesRaw = body.handles
  if (handlesRaw || Array.isArray(body.manual)) {
    const manual: CreatorCandidate[] = Array.isArray(body.manual) ? body.manual
      : String(handlesRaw || '').split(/[\n,]/).map((h: string) => h.trim().replace(/^@/, '')).filter(Boolean).map((handle: string) => ({ handle }))
    const saved = await saveCandidates(admin, user.id, brandId, manual, 'manual')
    return NextResponse.json({ ok: true, saved, candidates: manual })
  }

  // Apify discovery.
  const input = {
    country: body.country ? String(body.country) : undefined,
    minFollowers: body.minFollowers != null ? Number(body.minFollowers) : undefined,
    maxFollowers: body.maxFollowers != null ? Number(body.maxFollowers) : undefined,
    niche: body.niche ? String(body.niche) : undefined,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : (body.hashtags ? String(body.hashtags).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined),
    limit: body.limit != null ? Number(body.limit) : 50,
    requireEmail: !!body.requireEmail,
  }
  const res = await discoverCreators(input)
  if (res.needsToken) return NextResponse.json({ needsToken: true, saved: 0, candidates: [] })
  if (res.error) return NextResponse.json({ error: res.error, saved: 0, candidates: [] }, { status: 502 })
  const saved = await saveCandidates(admin, user.id, brandId, res.candidates, 'apify')
  return NextResponse.json({ ok: true, saved, found: res.candidates.length, candidates: res.candidates })
}
