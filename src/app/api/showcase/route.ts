/**
 * Public "Made with Selfmade" showcase — the creatives an admin flagged featured_on_landing.
 * Returns each as a before→after pair (source winning ad thumbnail → the remake we made), for images
 * AND videos. Public (no auth): only admin-featured, already-public R2 creatives are exposed.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const admin = createAdminClient()
    const { data: rows } = await admin.from('creative_generations')
      .select('id, image_url, media_type, source_ad_id, brand_id, created_at')
      .eq('featured_on_landing', true).eq('status', 'done').not('image_url', 'is', null)
      .order('created_at', { ascending: false }).limit(12)
    const list = (rows || []) as any[]
    if (!list.length) return NextResponse.json({ items: [] })

    const brandIds = Array.from(new Set(list.map((r) => r.brand_id).filter(Boolean)))
    const srcIds = Array.from(new Set(list.map((r) => r.source_ad_id).filter(Boolean)))
    const [{ data: brands }, { data: src }] = await Promise.all([
      brandIds.length ? admin.from('brands').select('id, name').in('id', brandIds) : Promise.resolve({ data: [] } as any),
      srcIds.length ? admin.from('discovery_creatives').select('ad_id, asset_type, r2_url, poster_url, position').in('ad_id', srcIds).order('position', { ascending: true }) : Promise.resolve({ data: [] } as any),
    ])
    const brandMap = Object.fromEntries((brands || []).map((b: any) => [b.id, b.name]))
    const srcThumb = new Map<string, string>()
    for (const c of (src || []) as any[]) {
      if (srcThumb.has(c.ad_id)) continue
      const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
      if (t) srcThumb.set(c.ad_id, t)
    }

    const items = list.map((r) => ({
      id: r.id,
      made: r.image_url as string,
      video: (r.media_type || 'image') === 'video',
      source: r.source_ad_id ? srcThumb.get(r.source_ad_id) || null : null,
      brand: r.brand_id ? brandMap[r.brand_id] || null : null,
    }))
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [] })
  }
}
