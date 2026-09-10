/**
 * Elements — reusable people/characters (and props) the founder can drop into any ad. Stored per-brand at
 * brand_kit.adsStudio.elements = [{id,label,url}]; the images live permanently in R2. Selecting an element
 * tags it into the Mello chat, where it's passed to the (unchanged) generate-ad engine as a reference so
 * the person/prop appears in the creative.
 *
 * GET    ?domain=            → list elements
 * POST   { domain, label, dataUrl }  → add one (uploads the image to R2)
 * DELETE { domain, id }      → remove one
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { isAdminToken } from '@/lib/admin/auth'
import { uploadBufferToR2 } from '@/lib/r2'
import { createHash } from 'node:crypto'

// A GLOBAL, admin-curated people/prop library shared with EVERY brand (stock models/creators the founder
// has commercial rights to). Stored in system_flags; images live in R2 under elements/global/. Only admins
// (admin_token) may add/remove these; regular users see + use them but their own uploads stay brand-private.
const GLOBAL_KEY = 'ads_global_elements'
async function listGlobal(admin: any): Promise<Element[]> {
  try {
    const { data } = await admin.from('system_flags').select('value').eq('key', GLOBAL_KEY).maybeSingle()
    const arr = data?.value ? JSON.parse(data.value) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
async function saveGlobal(admin: any, elements: Element[]): Promise<void> {
  await admin.from('system_flags').upsert({ key: GLOBAL_KEY, value: JSON.stringify(elements.slice(0, 100)) }, { onConflict: 'key' })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const cleanDomain = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

type Element = { id: string; label: string; url: string; global?: boolean }

async function ctx(req: NextRequest) {
  const admin = createAdminClient() as any
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  const brandId = user ? await resolveActiveBrandId(admin, user.id).catch(() => null) : null
  return { admin, userId: user?.id || null, brandId }
}
async function list(admin: any, brandId: string): Promise<Element[]> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const e = data?.brand_kit?.adsStudio?.elements
  return Array.isArray(e) ? e : []
}
async function save(admin: any, brandId: string, elements: Element[]): Promise<void> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const existing = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  const ads = existing.adsStudio || {}
  await admin.from('brands').update({ brand_kit: { ...existing, adsStudio: { ...ads, elements } } }).eq('id', brandId)
}

export async function GET(req: NextRequest) {
  try {
    const { admin, brandId } = await ctx(req)
    const isAdmin = await isAdminToken()
    // Shared library FIRST (visible to everyone), then this brand's own private elements.
    const globals = (await listGlobal(admin)).map((e) => ({ ...e, global: true }))
    const brand = brandId ? await list(admin, brandId) : []
    return NextResponse.json({ elements: [...globals, ...brand], isAdmin })
  } catch { return NextResponse.json({ elements: [] }) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const dataUrl = String(body.dataUrl || '')
  const label = String(body.label || 'Element').slice(0, 40)
  const scope: 'global' | 'brand' = body.scope === 'global' ? 'global' : 'brand'
  try {
    const { admin, userId, brandId } = await ctx(req)
    const isAdmin = await isAdminToken()
    if (scope === 'global' && !isAdmin) return NextResponse.json({ error: 'Only admins can add shared (global) elements.' }, { status: 403 })
    if (scope === 'brand' && (!userId || !brandId)) return NextResponse.json({ error: 'Sign in to add elements.' }, { status: 401 })
    const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(dataUrl)
    if (!m) return NextResponse.json({ error: 'image dataUrl required' }, { status: 400 })
    const mime = m[1] || 'image/jpeg'
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > 8_000_000) return NextResponse.json({ error: 'image too large (max 8MB)' }, { status: 400 })
    const id = createHash('sha1').update(m[2].slice(0, 200) + Date.now()).digest('hex').slice(0, 16)
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadBufferToR2(buf, `elements/${scope === 'global' ? 'global' : brandId}/${id}.${ext}`, mime)
    if (!url) return NextResponse.json({ error: 'upload failed (R2 not configured)' }, { status: 502 })
    if (scope === 'global') {
      const g = await listGlobal(admin)
      g.unshift({ id, label, url })
      await saveGlobal(admin, g)
    } else {
      const brand = await list(admin, brandId!)
      brand.unshift({ id, label, url })
      await save(admin, brandId!, brand.slice(0, 60))
    }
    // Return the merged view (shared first, then this brand's) so the row updates in place.
    const globals = (await listGlobal(admin)).map((e) => ({ ...e, global: true }))
    const brand = brandId ? await list(admin, brandId) : []
    return NextResponse.json({ element: { id, label, url, global: scope === 'global' }, elements: [...globals, ...brand], isAdmin })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  try {
    const { admin, userId, brandId } = await ctx(req)
    const isAdmin = await isAdminToken()
    const globals = await listGlobal(admin)
    if (globals.some((e) => e.id === id)) {          // removing a SHARED element → admin only
      if (!isAdmin) return NextResponse.json({ error: 'Only admins can remove shared elements.' }, { status: 403 })
      await saveGlobal(admin, globals.filter((e) => e.id !== id))
    } else {                                          // removing a brand-private element
      if (!userId || !brandId) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
      await save(admin, brandId, (await list(admin, brandId)).filter((e) => e.id !== id))
    }
    const mergedGlobals = (await listGlobal(admin)).map((e) => ({ ...e, global: true }))
    const brand = brandId ? await list(admin, brandId) : []
    return NextResponse.json({ elements: [...mergedGlobals, ...brand], isAdmin })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
