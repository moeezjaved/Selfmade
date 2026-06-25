/**
 * Admin → Pack ads. Search the corpus and attach ads (with a Canva template URL) to a pack.
 * GET ?packId=<pack>        → the pack's ads (joined to corpus + a thumbnail), ordered.
 * GET ?q=<text|ad_id>       → corpus search to PICK ads to add (id, brand, copy snippet, thumb).
 * POST { pack_id, ad_id, canva_template_url?, position? } → attach/update one ad on a pack.
 * DELETE ?id=<pack_ad row>  → detach one ad.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user || (await isAdminToken())
}

const firstThumb = (cres: any[] = []) => {
  const img = cres.find((c) => c.asset_type === 'image')
  const vid = cres.find((c) => c.asset_type === 'video')
  return img?.poster_url || img?.r2_url || vid?.poster_url || vid?.r2_url || null
}

export async function GET(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const packId = req.nextUrl.searchParams.get('packId')
  const q = (req.nextUrl.searchParams.get('q') || '').trim()

  // 1) A pack's current ads, hydrated with brand + thumbnail from the corpus.
  if (packId) {
    const { data: rows, error } = await admin
      .from('expert_pack_ads')
      .select('*')
      .eq('pack_id', packId)
      .order('position', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const ids = (rows || []).map((r: any) => r.ad_id)
    const byId: Record<string, any> = {}
    if (ids.length) {
      const { data: corpus } = await admin
        .from('discovery_ads_index')
        .select('ad_id, page_name, body, title, discovery_creatives(asset_type,position,r2_url,poster_url)')
        .in('ad_id', ids)
      for (const a of (corpus || []) as any[]) byId[a.ad_id] = a
    }
    const ads = (rows || []).map((r: any) => {
      const a = byId[r.ad_id] || {}
      return {
        id: r.id, ad_id: r.ad_id, position: r.position, canva_template_url: r.canva_template_url,
        page_name: a.page_name || '(missing from corpus)',
        copy: (a.body || a.title || '').slice(0, 120),
        thumbnail: firstThumb(a.discovery_creatives),
      }
    })
    return NextResponse.json({ ads })
  }

  // 2) Corpus search to PICK ads to add. Exact ad_id, else fuzzy brand/copy. Inner-join
  //    creatives so we only offer ads that have a displayable thumbnail.
  if (q) {
    let query = admin
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title, is_active, days_running, discovery_creatives!inner(asset_type,position,r2_url,poster_url)')
      .limit(30)
    if (/^\d{5,}$/.test(q)) query = query.eq('ad_id', q)
    else query = query.or(`page_name.ilike.%${q}%,body.ilike.%${q}%,title.ilike.%${q}%`)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const results = (data || []).map((a: any) => ({
      ad_id: a.ad_id,
      page_name: a.page_name,
      copy: (a.body || a.title || '').slice(0, 120),
      is_active: a.is_active,
      days_running: a.days_running,
      thumbnail: firstThumb(a.discovery_creatives),
    }))
    return NextResponse.json({ results })
  }

  return NextResponse.json({ error: 'packId or q required' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const b = await req.json()
  const pack_id = String(b.pack_id || '').trim()
  const ad_id = String(b.ad_id || '').trim()
  if (!pack_id || !ad_id) return NextResponse.json({ error: 'pack_id and ad_id required' }, { status: 400 })

  const row: Record<string, any> = {
    pack_id, ad_id,
    canva_template_url: b.canva_template_url != null ? String(b.canva_template_url).trim() || null : null,
    position: b.position != null ? Math.round(Number(b.position)) : 0,
  }
  const { data, error } = await admin
    .from('expert_pack_ads')
    .upsert(row, { onConflict: 'pack_id,ad_id' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ad: data })
}

export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient().from('expert_pack_ads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
