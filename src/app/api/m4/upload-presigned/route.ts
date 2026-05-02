import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { fileName, contentType } = await request.json()
    if (!fileName || !contentType) return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 })

    const ext = fileName.split('.').pop() || 'mp4'
    const storagePath = `${user.id}/${Date.now()}.${ext}`
    const bucket = 'ads-media'

    const admin = createAdminClient()
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Create a signed download URL (1 hour) — works even if bucket is private,
    // and is what we pass to Meta's file_url so Meta can download the video
    const { data: signedDownload, error: dlErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600)

    if (dlErr) return NextResponse.json({ error: dlErr.message }, { status: 400 })

    return NextResponse.json({
      signedUrl: data.signedUrl,
      path: storagePath,
      downloadUrl: signedDownload.signedUrl,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
