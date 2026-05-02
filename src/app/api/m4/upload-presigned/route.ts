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

    const { data: urlData } = admin.storage.from(bucket).getPublicUrl(storagePath)

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
      publicUrl: urlData.publicUrl,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
