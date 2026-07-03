/**
 * Admin — the AI Ad Studio inspiration library. Admin-gated.
 *   GET               → list inspirations (newest first).
 *   POST { images:[dataURL] }  → upload to R2 (unique keys) + auto-tag each via Gemini vision.
 *   DELETE ?id=       → soft-delete (active=false).
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { uploadBufferToR2 } from '@/lib/r2'
import { classifyInspirationDebug } from '@/lib/gemini/vision'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('ad_inspirations')
    .select('id, r2_url, niche, format, aspect, palette, style_tags, layout_type, tagged, active, created_at')
    .eq('active', true).order('created_at', { ascending: false }).limit(500)
  return NextResponse.json({ inspirations: data || [], total: (data || []).length })
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await request.json().catch(() => ({}))
  const images: string[] = Array.isArray(body.images) ? body.images.filter((s: any) => typeof s === 'string' && s.startsWith('data:')) : []
  if (!images.length) return NextResponse.json({ error: 'no images' }, { status: 400 })

  // Constrain auto-tagged niche to the coarse vocabulary we actually filter on.
  const { data: nc } = await admin.from('niche_counts').select('niche').limit(100)
  const nicheVocab = (nc || []).map((r: any) => r.niche).filter(Boolean)

  const saved: any[] = []
  const errors: string[] = []
  for (const src of images.slice(0, 30)) {   // cap per request; the UI batches
    const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
    if (!m) { errors.push('not a data URL'); continue }
    const mime = m[1] || 'image/jpeg'
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    const buf = Buffer.from(m[2], 'base64')
    const url = await uploadBufferToR2(buf, `inspirations/${randomUUID()}.${ext}`, mime)
    if (!url) { errors.push('R2 upload failed (R2 env not set?)'); continue }

    const { tags, error: tagErr } = await classifyInspirationDebug({ mimeType: mime, dataB64: m[2] }, nicheVocab).catch((e) => ({ tags: null, error: String(e?.message || e) }))
    if (!tags && tagErr) errors.push(`tag: ${tagErr}`)
    const { data: row, error } = await admin.from('ad_inspirations').insert({
      r2_url: url,
      niche: tags?.niche || null,
      format: tags?.format || 'image',
      aspect: tags?.aspect || null,
      palette: tags?.palette || [],
      style_tags: tags?.style_tags || [],
      layout_type: tags?.layout_type || null,
      tagged: !!tags,
    }).select('id, r2_url, niche, format, aspect, palette, style_tags, layout_type, tagged').single()
    if (error) { errors.push(`db: ${error.message}`); continue }
    if (row) saved.push(row)
  }
  if (saved.length === 0 && errors.length) console.warn('inspirations upload — all failed:', errors)
  return NextResponse.json({ saved, count: saved.length, errors: errors.slice(0, 3) })
}

export async function DELETE(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('ad_inspirations').update({ active: false }).eq('id', id)
  return NextResponse.json({ ok: true })
}
