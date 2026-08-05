/**
 * POST /api/guardian/recheck  { brandId? } — force a fresh crawl of the founder's spied competitors so
 * Brand Guardian notices new ads NOW instead of waiting for the 6h cycle. Resets last_crawled_at + bumps
 * priority to 9 on their crawl terms (the same mechanism as a paid re-spy). The droplet crawler picks
 * them up next pass — so this only helps if the crawler is alive (which the freshness read reveals).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const brandId = body.brandId || undefined

  let fq = admin.from('followed_brands').select('page_id').eq('user_id', user.id).eq('spied', true)
  if (brandId) fq = fq.eq('brand_id', brandId)
  const { data: f } = await fq.limit(50)
  const ids = (f || []).map((x: any) => x.page_id).filter(Boolean)
  if (!ids.length) return NextResponse.json({ ok: true, queued: 0 })

  // Reset the crawl terms → the droplet crawler re-crawls them as top priority next pass.
  const { error } = await admin.from('discovery_crawl_terms')
    .update({ last_crawled_at: null, priority: 9 }).in('page_id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, queued: ids.length })
}
