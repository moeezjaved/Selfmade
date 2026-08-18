/**
 * Single brand — GET (with products + assets), PATCH (update), DELETE.
 * POST adds a product or asset ({ resource:'product'|'asset', ... }).
 * DELETE ?productId= / ?assetId= removes a child. All ownership-checked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { persistImagesToR2 } from '@/lib/brand-photos'
import { brandPoolUserIds } from '@/lib/org'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const ARR = (v: any) => Array.isArray(v) ? v.map(String) : (v ? [String(v)] : [])

// One shared workspace: a brand is "accessible" to anyone in its owner's org (member edits assets, uses
// Studio, etc.) — not just the row's user_id. Was self-only, which is why an invited member couldn't
// open the owner's brand.
async function owned(admin: any, brandId: string, userId: string) {
  const ids = await brandPoolUserIds(admin, userId).catch(() => [userId])
  const { data } = await admin.from('brands').select('id').eq('id', brandId).in('user_id', ids).maybeSingle()
  return !!data
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const memberIds = await brandPoolUserIds(admin, user.id).catch(() => [user.id])
  const { data: brand } = await admin.from('brands').select('*').eq('id', params.id).in('user_id', memberIds).maybeSingle()
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [{ data: products }, { data: assets }] = await Promise.all([
    admin.from('brand_products').select('*').eq('brand_id', params.id).order('created_at', { ascending: false }),
    admin.from('brand_assets').select('*').eq('brand_id', params.id),
  ])
  return NextResponse.json({ brand: { ...brand, products: products || [], assets: assets || [] } })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json()
  const update: Record<string, any> = {}
  for (const k of ['name', 'website', 'description', 'target_audience', 'tone'])
    if (b[k] !== undefined) update[k] = b[k] || null
  for (const k of ['industry', 'usps', 'preferred_words', 'avoid_words'])
    if (b[k] !== undefined) update[k] = ARR(b[k])
  if (b.brand_kit !== undefined && typeof b.brand_kit === 'object') update.brand_kit = b.brand_kit
  if (b.brand_type === 'physical' || b.brand_type === 'service' || b.brand_type === 'app') update.brand_type = b.brand_type
  await admin.from('brands').update(update).eq('id', params.id)
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json()

  if (b.resource === 'product') {
    const { data, error } = await admin.from('brand_products').insert({
      brand_id: params.id, name: b.name || null, description: b.description || null,
      price: b.price || null, image_urls: ARR(b.image_urls),
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ product: data })
  }
  // Add product photos to the brand (upload data: URLs or auto-detected http URLs). Copies them
  // into R2 and appends to the brand's primary product (creates one if none), so the photos persist
  // and can be re-used by Clone. Returns the merged photo list.
  if (b.resource === 'photos') {
    const incoming = ARR(b.images)
    if (!incoming.length) return NextResponse.json({ error: 'images required' }, { status: 400 })
    const persisted = await persistImagesToR2(user.id, incoming)
    const add = persisted.length ? persisted : incoming
    const { data: prod } = await admin.from('brand_products').select('id, image_urls').eq('brand_id', params.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (prod) {
      const merged = Array.from(new Set([...((prod as any).image_urls || []), ...add])).slice(0, 24)
      await admin.from('brand_products').update({ image_urls: merged }).eq('id', (prod as any).id)
      return NextResponse.json({ image_urls: merged })
    }
    const { data } = await admin.from('brand_products').insert({ brand_id: params.id, name: 'Product', image_urls: add.slice(0, 24) }).select('image_urls').single()
    return NextResponse.json({ image_urls: (data as any)?.image_urls || add })
  }
  if (b.resource === 'asset') {
    const { data, error } = await admin.from('brand_assets').insert({
      brand_id: params.id, type: b.type, value: b.value || null,
      is_default: !!b.is_default, meta: b.meta || null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ asset: data })
  }
  return NextResponse.json({ error: 'resource must be product|asset' }, { status: 400 })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const productId = req.nextUrl.searchParams.get('productId')
  const assetId = req.nextUrl.searchParams.get('assetId')
  const photoUrl = req.nextUrl.searchParams.get('photoUrl')
  if (photoUrl) {
    // Remove a single product photo from whichever product row holds it.
    const { data: prods } = await admin.from('brand_products').select('id, image_urls').eq('brand_id', params.id)
    for (const p of (prods || []) as any[]) {
      if ((p.image_urls || []).includes(photoUrl)) {
        await admin.from('brand_products').update({ image_urls: (p.image_urls || []).filter((u: string) => u !== photoUrl) }).eq('id', p.id)
      }
    }
  }
  else if (productId) await admin.from('brand_products').delete().eq('id', productId).eq('brand_id', params.id)
  else if (assetId) await admin.from('brand_assets').delete().eq('id', assetId).eq('brand_id', params.id)
  else {
    // Deleting a WHOLE brand is destructive and shared-workspace-visible. `owned` is org-scoped now, so
    // guard here: the brand's creator can delete it, AND so can an org OWNER/ADMIN (they run the
    // workspace — this is what lets an owner remove a duplicate brand a member created during the old
    // from-scratch onboarding). A plain member still can't nuke someone else's brand.
    const { data: br } = await admin.from('brands').select('user_id').eq('id', params.id).maybeSingle()
    if (br && (br as any).user_id !== user.id) {
      const { data: myRoles } = await admin.from('org_members').select('org_id, role').eq('user_id', user.id)
      const adminOrgs = (myRoles || []).filter((r: any) => r.role === 'owner' || r.role === 'admin').map((r: any) => r.org_id)
      let allowed = false
      if (adminOrgs.length) {
        const { data: shared } = await admin.from('org_members').select('org_id').eq('user_id', (br as any).user_id).in('org_id', adminOrgs)
        allowed = !!(shared && shared.length)
      }
      if (!allowed) return NextResponse.json({ error: 'Only the teammate who created this brand, or an org owner/admin, can delete it.' }, { status: 403 })
    }
    // When an owner/admin deletes a brand created by ANOTHER member, the ghost-data cleanup must target
    // that CREATOR's rows, not the caller's, or the competitors/brief cards orphan.
    const ownerUid = (br as any)?.user_id || user.id
    // Ghost-data cleanup: followed_brands.brand_id is ON DELETE SET NULL (mig 117) and brief_events has
    // NO foreign key (mig 108) — so deleting a brand otherwise leaves its competitors behind (orphaned
    // to account-level, still spied) and its brief cards forever. That's the "removed all brands but the
    // brief + Feed still show their competitors" bug. Delete them explicitly FIRST, while brand_id still
    // matches (the SET NULL fires the moment the brand row goes), then delete the brand.
    await admin.from('followed_brands').delete().eq('user_id', ownerUid).eq('brand_id', params.id).then(() => {}, () => {})
    await admin.from('brief_events').delete().eq('user_id', ownerUid).eq('brand_id', params.id).then(() => {}, () => {})
    await admin.from('brands').delete().eq('id', params.id)  // delete the whole brand (cascades the rest)
  }
  return NextResponse.json({ success: true })
}
