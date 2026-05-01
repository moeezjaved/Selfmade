import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const isVideo = formData.get('isVideo') === 'true'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Step 1: Upload to Supabase Storage
    const fileExt = file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')
    const fileName = `${user.id}/${Date.now()}.${fileExt}`
    const bucket = 'ads-media'

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { data: uploadData, error: uploadError } = await admin.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return NextResponse.json({ error: 'Storage upload failed: ' + uploadError.message }, { status: 400 })
    }

    // Step 2: Get public URL
    const { data: urlData } = admin.storage.from(bucket).getPublicUrl(fileName)
    const publicUrl = urlData.publicUrl

    console.log('Uploaded to Supabase:', publicUrl)

    // Step 3: Send URL to Meta
    if (isVideo) {
      // For videos: use URL-based upload
      const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/advideos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: publicUrl,
          access_token: token,
        })
      })
      const data = await res.json()
      console.log('Meta video response:', JSON.stringify(data))
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      return NextResponse.json({ videoId: data.id, hash: data.id, isVideo: true, url: publicUrl })
    } else {
      // For images: use URL-based upload
      const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: publicUrl,
          access_token: token,
        })
      })
      const data = await res.json()
      console.log('Meta image response:', JSON.stringify(data))
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      const images = data.images || {}
      const firstKey = Object.keys(images)[0]
      if (!firstKey) return NextResponse.json({ error: 'No image hash returned' }, { status: 400 })
      return NextResponse.json({ hash: images[firstKey]?.hash, url: images[firstKey]?.url })
    }

  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
