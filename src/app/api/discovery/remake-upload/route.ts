/**
 * Bring-your-own-video: presign a short-lived R2 PUT for a source video the user uploads from their
 * computer, so they can remake an ad that ISN'T in our Discovery library. The client PUTs the bytes
 * straight to R2, then starts the remake by passing the returned publicUrl as `sourceVideoUrl` to
 * POST /api/discovery/clone-video (the exact path Saved-from-Web videos already use).
 *
 * Deliberately NOT the /api/assets flow: these are transient remake *inputs*, not saved assets, so
 * they don't count against the plan's asset-storage cap. POST { fileType, sizeBytes } → { uploadUrl, publicUrl }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { presignPut, r2PublicUrl, isR2Configured } from '@/lib/r2'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Source videos only. Cap at 200 MB — Seedance references a short ad, not a feature film.
const VIDEO: Record<string, { ext: string }> = {
  'video/mp4': { ext: 'mp4' },
  'video/quicktime': { ext: 'mov' },
  'video/webm': { ext: 'webm' },
}
const MAX_BYTES = 200e6

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isR2Configured()) return NextResponse.json({ error: 'not_configured', message: 'Uploads are temporarily unavailable.' }, { status: 503 })

  const { fileType, sizeBytes } = await req.json().catch(() => ({}))
  const spec = VIDEO[String(fileType || '')]
  if (!spec) return NextResponse.json({ error: 'unsupported_type', message: 'Upload an MP4, MOV or WebM video.' }, { status: 400 })
  const size = Math.floor(Number(sizeBytes))
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'bad_size' }, { status: 400 })
  if (size > MAX_BYTES) return NextResponse.json({ error: 'file_too_large', message: `Videos must be under ${Math.round(MAX_BYTES / 1e6)} MB.` }, { status: 400 })

  const key = `remake-uploads/${user.id}/${randomUUID()}.${spec.ext}`
  const uploadUrl = await presignPut(key, String(fileType), size)
  const publicUrl = r2PublicUrl(key)
  if (!uploadUrl || !publicUrl) return NextResponse.json({ error: 'presign_failed' }, { status: 500 })

  return NextResponse.json({ uploadUrl, publicUrl, expiresIn: 300 })
}
