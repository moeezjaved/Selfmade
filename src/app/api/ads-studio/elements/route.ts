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
import { uploadBufferToR2 } from '@/lib/r2'
import { createHash } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const cleanDomain = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

type Element = { id: string; label: string; url: string }

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
    if (!brandId) return NextResponse.json({ elements: [] })
    return NextResponse.json({ elements: await list(admin, brandId) })
  } catch { return NextResponse.json({ elements: [] }) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const dataUrl = String(body.dataUrl || '')
  const label = String(body.label || 'Element').slice(0, 40)
  try {
    const { admin, userId, brandId } = await ctx(req)
    if (!userId || !brandId) return NextResponse.json({ error: 'Sign in to add elements.' }, { status: 401 })
    const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(dataUrl)
    if (!m) return NextResponse.json({ error: 'image dataUrl required' }, { status: 400 })
    const mime = m[1] || 'image/jpeg'
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > 8_000_000) return NextResponse.json({ error: 'image too large (max 8MB)' }, { status: 400 })
    const id = createHash('sha1').update(m[2].slice(0, 200) + Date.now()).digest('hex').slice(0, 16)
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadBufferToR2(buf, `elements/${brandId}/${id}.${ext}`, mime)
    if (!url) return NextResponse.json({ error: 'upload failed (R2 not configured)' }, { status: 502 })
    const elements = await list(admin, brandId)
    elements.unshift({ id, label, url })
    await save(admin, brandId, elements.slice(0, 60))
    return NextResponse.json({ element: { id, label, url }, elements: elements.slice(0, 60) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  try {
    const { admin, userId, brandId } = await ctx(req)
    if (!userId || !brandId) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
    const elements = (await list(admin, brandId)).filter((e) => e.id !== id)
    await save(admin, brandId, elements)
    return NextResponse.json({ elements })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
