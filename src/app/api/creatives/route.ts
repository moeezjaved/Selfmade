/**
 * "My Creatives" gallery API.
 * GET    /api/creatives?brandId=&type=   → the user's saved AI generations (newest first)
 * DELETE /api/creatives?id=               → remove one generation (row only; R2 object is left)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const brandId = req.nextUrl.searchParams.get('brandId')
  const type = req.nextUrl.searchParams.get('type')

  let q = admin.from('creative_generations')
    .select('id, brand_id, source_ad_id, source_video_url, parent_id, type, tier, prompt, image_url, media_type, status, created_at, clone_meta')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(300)
  if (brandId) q = q.eq('brand_id', brandId)
  if (type) q = q.eq('type', type)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach brand names for labels.
  const brandIds = Array.from(new Set((data || []).map((g: any) => g.brand_id).filter(Boolean)))
  const names = new Map<string, string>()
  if (brandIds.length) {
    const { data: bs } = await admin.from('brands').select('id, name').in('id', brandIds)
    for (const b of (bs || []) as any[]) names.set(b.id, b.name)
  }

  // "Cloned from" thumbnail: the source ad's R2 poster/image. Edits (tweak-box results) have no source
  // of their own — they're derived from a parent — so they showed a BLANK "Remade from". We resolve an
  // edit's reference by walking up its parent chain to the original clone's source.
  const rows: any[] = data || []
  const byId = new Map<string, any>(rows.map((g) => [g.id, g]))
  // Pull in any parent rows outside the recent window so an edit can still inherit its ancestor's source.
  const missingParents = Array.from(new Set(rows.map((g) => g.parent_id).filter((pid: any) => pid && !byId.has(pid))))
  if (missingParents.length) {
    const { data: par } = await admin.from('creative_generations')
      .select('id, source_ad_id, image_url, parent_id, clone_meta').in('id', missingParents as string[])
    for (const p of (par || []) as any[]) if (!byId.has(p.id)) byId.set(p.id, p)
  }

  // One batched lookup on discovery_creatives (permanent R2 urls) keyed by source_ad_id, across every
  // row we now hold (originals + fetched parents).
  const srcIds = Array.from(new Set(Array.from(byId.values()).map((g: any) => g.source_ad_id).filter(Boolean)))
  const srcThumb = new Map<string, string>()
  if (srcIds.length) {
    const { data: cr } = await admin.from('discovery_creatives')
      .select('ad_id, asset_type, r2_url, poster_url, position').in('ad_id', srcIds as string[]).order('position', { ascending: true })
    for (const c of (cr || []) as any[]) {
      if (srcThumb.has(c.ad_id)) continue   // first (lowest-position) creative per ad
      const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
      if (t) srcThumb.set(c.ad_id, t)
    }
  }

  // A generation's OWN source (discovery ad thumb, else the stored reference image).
  const ownThumb = (g: any): string | null => (g.source_ad_id ? srcThumb.get(g.source_ad_id) || null : null) || g.clone_meta?.ref_url || null
  // Resolve including the parent chain: an edit inherits the original ad it ultimately came from. If the
  // chain has no discovery source at all (e.g. edit of an upload), fall back to the root ancestor's image.
  const resolveThumb = (g: any): string | null => {
    let cur = g
    for (let depth = 0; cur && depth < 8; depth++) {
      const own = ownThumb(cur)
      if (own) return own
      const parent = cur.parent_id ? byId.get(cur.parent_id) : null
      if (!parent) return cur !== g ? cur.image_url || null : null
      cur = parent
    }
    return null
  }

  const creatives = rows.map((g: any) => {
    const { clone_meta, ...rest } = g
    return {
      ...rest,
      brand_name: g.brand_id ? names.get(g.brand_id) || null : null,
      source_thumb: resolveThumb(g),
    }
  })
  return NextResponse.json({ creatives })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('creative_generations').delete().eq('id', id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
