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
    let { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(storagePath)
    if (error) {
      // Self-heal a missing bucket: Supabase reports it as "Bucket not found" OR "The related resource
      // does not exist" depending on the endpoint/version — the old /bucket not found/ check missed the
      // second, so every VIDEO upload failed with "Upload error: The related resource does not exist".
      // Just try to create it on ANY error (idempotent — ignores "already exists") and retry once.
      await admin.storage.createBucket(bucket, { public: true }).catch(() => {})   // no manual Supabase step
      ;({ data, error } = await admin.storage.from(bucket).createSignedUploadUrl(storagePath))
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({
      signedUrl: data.signedUrl,
      path: storagePath,
      bucket,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
