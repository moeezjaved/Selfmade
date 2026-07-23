/**
 * ADMIN · Playbook curation — the "Add Ad" workflow.
 * GET  ?playbookId=      → the playbook's ads, in position order, with media
 * GET  ?q= / ?niche=     → SEARCH the 4.6M-ad library (brand name / copy, has_creative)
 * POST {playbookId, adIds[]}          → add ads (appended at the end)
 * PATCH {playbookId, adId, position?|featured?} → reorder / feature
 * DELETE ?playbookId=&adId=           → remove one ad from the playbook
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createReadClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

const AD_SEL = 'ad_id, page_name, hook_type, format_style, niche, days_running, performance_score, is_active, discovery_creatives(asset_type, r2_url, poster_url)'
const mediaOf = (a: any) => {
  const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
  const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
  if (!cre) return null
  const isVid = cre.asset_type === 'video'
  return { img: isVid ? cre.poster_url : cre.r2_url, video: isVid ? cre.r2_url : null }
}
const shape = (a: any) => ({
  adId: a.ad_id, brand: a.page_name, hook: a.hook_type, format: a.format_style, niche: a.niche,
  days: a.days_running, score: a.performance_score, active: a.is_active, media: mediaOf(a),
})

export async function GET(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createReadClient() as any
  const playbookId = req.nextUrl.searchParams.get('playbookId')
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const niche = (req.nextUrl.searchParams.get('niche') || '').trim()

  if (playbookId) {
    const { data: links } = await admin.from('playbook_ads').select('ad_id, position, featured').eq('playbook_id', playbookId).order('position')
    const ids = (links || []).map((l: any) => l.ad_id)
    if (!ids.length) return NextResponse.json({ ads: [] })
    const { data: rows } = await admin.from('discovery_ads_index').select(AD_SEL).in('ad_id', ids)
    const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
    return NextResponse.json({
      ads: (links || []).map((l: any) => {
        const r = byId.get(l.ad_id)
        return r ? { ...shape(r), position: l.position, featured: l.featured } : null
      }).filter(Boolean),
    })
  }

  // library search for curation
  let query = admin.from('discovery_ads_index').select(AD_SEL).eq('has_creative', true)
  if (niche) query = query.eq('niche', niche)
  if (q) query = query.or(`page_name.ilike.%${q.replace(/[%_,]/g, '')}%,title.ilike.%${q.replace(/[%_,]/g, '')}%`)
  const { data: rows } = await query.order('performance_score', { ascending: false, nullsFirst: false }).limit(40)
  return NextResponse.json({ ads: (rows || []).map(shape).filter((a: any) => a.media?.img) })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const playbookId = String(body.playbookId || '')
  const adIds: string[] = Array.isArray(body.adIds) ? body.adIds.map(String).slice(0, 200) : []
  if (!playbookId || !adIds.length) return NextResponse.json({ error: 'playbookId + adIds required' }, { status: 400 })
  const admin = createAdminClient() as any
  const { data: maxRow } = await admin.from('playbook_ads').select('position').eq('playbook_id', playbookId).order('position', { ascending: false }).limit(1).maybeSingle()
  let pos = (maxRow?.position ?? -1) + 1
  const rows = adIds.map((ad_id) => ({ playbook_id: playbookId, ad_id, position: pos++ }))
  const { error } = await admin.from('playbook_ads').upsert(rows, { onConflict: 'playbook_id,ad_id', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await admin.from('playbooks').update({ updated_at: new Date().toISOString() }).eq('id', playbookId)
  return NextResponse.json({ ok: true, added: rows.length })
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.playbookId || !body.adId) return NextResponse.json({ error: 'playbookId + adId required' }, { status: 400 })
  const admin = createAdminClient() as any
  const patch: any = {}
  if ('position' in body) patch.position = +body.position
  if ('featured' in body) patch.featured = !!body.featured
  const { error } = await admin.from('playbook_ads').update(patch).eq('playbook_id', body.playbookId).eq('ad_id', body.adId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const playbookId = req.nextUrl.searchParams.get('playbookId'), adId = req.nextUrl.searchParams.get('adId')
  if (!playbookId || !adId) return NextResponse.json({ error: 'playbookId + adId required' }, { status: 400 })
  const admin = createAdminClient() as any
  const { error } = await admin.from('playbook_ads').delete().eq('playbook_id', playbookId).eq('ad_id', adId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await admin.from('playbooks').update({ updated_at: new Date().toISOString() }).eq('id', playbookId)
  return NextResponse.json({ ok: true })
}
