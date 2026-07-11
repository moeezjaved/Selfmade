/**
 * GET /api/download?url=<r2 public url>&name=<filename>
 * Forces a real file download: turns a Selfmade-hosted R2 URL into a short-lived presigned URL with
 * Content-Disposition: attachment, then 302-redirects. This fixes "clicking download opens the
 * creative in a new tab" — browsers ignore the <a download> attribute on cross-origin URLs, so we
 * redirect to a same-object URL that carries the attachment header. Only OUR R2 objects are allowed
 * (keyFromPublicUrl returns null otherwise), so this can't be used as an open redirector.
 */
import { NextRequest, NextResponse } from 'next/server'
import { keyFromPublicUrl, presignDownloadUrl } from '@/lib/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || ''
  const name = req.nextUrl.searchParams.get('name') || 'creative'
  const key = keyFromPublicUrl(url)
  if (!key) return NextResponse.json({ error: 'Only Selfmade-hosted media can be downloaded here.' }, { status: 400 })
  const signed = await presignDownloadUrl(key, name)
  if (!signed) return NextResponse.json({ error: 'Download is temporarily unavailable.' }, { status: 500 })
  return NextResponse.redirect(signed)
}
