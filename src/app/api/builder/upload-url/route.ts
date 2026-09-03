/**
 * POST /api/builder/upload-url { contentType, size } — issue a presigned R2 PUT so the browser can
 * upload a video (or large image) straight to storage, then use it in a Page Builder media slot.
 * Returns { uploadUrl, publicUrl, key }. The client PUTs the file bytes to uploadUrl, then stores publicUrl.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { presignPut, r2PublicUrl, isR2Configured } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 120 * 1024 * 1024   // 120MB — enough for short UGC clips
const EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isR2Configured()) return NextResponse.json({ error: 'Media hosting is not configured.' }, { status: 503 })

  const b = await req.json().catch(() => ({}))
  const contentType = String(b?.contentType || '')
  const size = Number(b?.size || 0)
  const ext = EXT[contentType]
  if (!ext) return NextResponse.json({ error: 'Unsupported file type — use MP4/WebM/MOV video or JPEG/PNG/WebP image.' }, { status: 400 })
  if (!size || size > MAX_BYTES) return NextResponse.json({ error: 'File must be under 120MB.' }, { status: 400 })

  const key = `builder/media/${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const uploadUrl = await presignPut(key, contentType, size)
  if (!uploadUrl) return NextResponse.json({ error: 'Could not start the upload — try again.' }, { status: 502 })

  return NextResponse.json({ uploadUrl, publicUrl: r2PublicUrl(key), key })
}
