/**
 * Cover-image upload for the blog editor. Accepts a multipart file, stores it in R2 under blog/,
 * returns the public URL to drop into a post's cover_image_url. Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isR2Configured()) return NextResponse.json({ error: 'R2 not configured on the server' }, { status: 500 })
  const form = await request.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Image too large (max 8MB)' }, { status: 400 })
  const type = file.type || 'image/jpeg'
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('+xml', '')
  const key = `blog/${randomUUID()}.${ext}`
  const buffer = await file.arrayBuffer()
  const url = await uploadToR2(buffer, key, type)
  if (!url) return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  return NextResponse.json({ url })
}
