/**
 * Assets — confirm an upload, list the org library, delete. (spec §10.3/§10.4 steps 3+)
 *   POST   { assetId, key, fileType, fileName, brandId } → verify R2 object + record the row
 *   GET    [?brand_id=&type=]                            → org's assets + storage usage (for the meter)
 *   DELETE ?id=                                          → author or org admin/owner; removes row + R2 object
 * Org-shared + storage-capped upstream at /api/assets/upload-url.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, canManage } from '@/lib/org'
import { getPlanId } from '@/lib/entitlements'
import { planEntitlements } from '@/lib/plans'
import { headObjectSize, deleteFromR2, r2PublicUrl } from '@/lib/r2'
import { embedText } from '@/lib/assets/enrich'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

const catOf = (mime: string) => mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image'

// POST — confirm a completed upload.
export async function POST(req: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const { assetId, key, fileType, fileName, brandId, width, height, durationSec } = await req.json().catch(() => ({}))
  if (!key || !assetId) return NextResponse.json({ error: 'assetId + key required' }, { status: 400 })

  // Org-path pinning — a member of org A can't claim an object under org B.
  if (!String(key).startsWith(`orgs/${org.orgId}/`)) return NextResponse.json({ error: 'forbidden_key' }, { status: 403 })

  // Verify the object actually landed in R2 and get its REAL size (client can't lie to dodge the cap).
  const realSize = await headObjectSize(key)
  if (realSize == null) { return NextResponse.json({ error: 'upload_not_found', message: 'Upload was not found in storage.' }, { status: 400 }) }

  const { data, error } = await admin.from('assets').insert({
    id: assetId, org_id: org.orgId, brand_id: brandId || null, uploaded_by: user.id,
    file_url: r2PublicUrl(key), r2_key: key, file_type: catOf(String(fileType || '')), mime: fileType || null,
    file_name: fileName || null, size_bytes: realSize, width: width || null, height: height || null,
    duration_sec: durationSec || null, status: 'processing',   // client calls /api/assets/enrich → 'ready'
  }).select().single()
  if (error) { await deleteFromR2(key); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ asset: data })
}

// GET — the org's asset library + storage usage.
export async function GET(req: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  const brandId = req.nextUrl.searchParams.get('brand_id')
  const type = req.nextUrl.searchParams.get('type')
  const search = req.nextUrl.searchParams.get('q')

  let assets: any[] = []
  if (search && search.trim()) {
    // Semantic/visual search: embed the query, cosine-rank the org's assets (spec §10.3).
    const emb = await embedText(search.trim())
    if (emb) {
      const { data } = await admin.rpc('search_assets', { p_org: org.orgId, p_query: emb as any, p_limit: 60 })
      assets = (data || []) as any[]
      if (brandId) assets = assets.filter(a => a.brand_id === brandId)
      if (type) assets = assets.filter(a => a.file_type === type)
    }
  } else {
    let q = admin.from('assets').select('*').eq('org_id', org.orgId).order('created_at', { ascending: false })
    if (brandId) q = q.eq('brand_id', brandId)
    if (type) q = q.eq('file_type', type)
    const { data } = await q
    assets = (data || []) as any[]
  }

  // Resolve uploader display names (for the Uploader filter) — distinct ids only.
  const uids = Array.from(new Set(assets.map(a => a.uploaded_by).filter(Boolean)))
  const nameById: Record<string, string> = {}
  await Promise.all(uids.map(async (id: string) => {
    try { const { data } = await admin.auth.admin.getUserById(id); nameById[id] = data?.user?.user_metadata?.full_name || data?.user?.email || 'Member' } catch { nameById[id] = 'Member' }
  }))
  for (const a of assets) a.uploader_name = a.uploaded_by ? (nameById[a.uploaded_by] || 'Member') : 'Member'

  // storage usage across the WHOLE org (unfiltered) for the meter
  const { data: allRows } = await admin.from('assets').select('size_bytes').eq('org_id', org.orgId)
  const usedBytes = (allRows || []).reduce((s: number, r: any) => s + Number(r.size_bytes || 0), 0)
  const limitGb = planEntitlements(await getPlanId(admin, org.ownerId)).assetsGb

  return NextResponse.json({ assets: assets || [], usedBytes, limitGb })
}

// DELETE — remove an asset (author or org admin/owner).
export async function DELETE(req: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: a } = await admin.from('assets').select('org_id, uploaded_by, r2_key').eq('id', id).maybeSingle()
  if (!a || a.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (a.uploaded_by !== user.id && !canManage(org.role)) return NextResponse.json({ error: 'Only the uploader or an admin can delete this.' }, { status: 403 })

  await admin.from('assets').delete().eq('id', id).eq('org_id', org.orgId)
  if (a.r2_key) await deleteFromR2(a.r2_key)
  return NextResponse.json({ ok: true })
}
