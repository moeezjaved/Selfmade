import { NextRequest, NextResponse } from 'next/server'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'
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
    const metaAccount = await resolveBrandScopedAccount(admin, user.id)
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id

    // Two input shapes:
    //  · multipart form (file)          — the classic browser upload
    //  · JSON { imageUrl }              — a generated creative (Studio clone → "Run it") pulled
    //    SERVER-side, so R2/storage CORS never gets a say. Image-only.
    let buffer: Buffer
    let isVideo = false
    let contentType = 'image/jpeg'
    let fileExt = 'jpg'
    const ctype = request.headers.get('content-type') || ''
    if (ctype.includes('application/json')) {
      const { imageUrl } = await request.json()
      if (!imageUrl || typeof imageUrl !== 'string' || !/^https:\/\//.test(imageUrl)) {
        return NextResponse.json({ error: 'imageUrl required' }, { status: 400 })
      }
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) return NextResponse.json({ error: `Could not fetch image (${imgRes.status})` }, { status: 400 })
      buffer = Buffer.from(await imgRes.arrayBuffer())
      contentType = imgRes.headers.get('content-type') || 'image/jpeg'
      fileExt = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    } else {
      // Parse multipart form data
      const formData = await request.formData()
      const file = formData.get('file') as File
      isVideo = formData.get('isVideo') === 'true'

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      fileExt = file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')
      contentType = file.type
      buffer = Buffer.from(await file.arrayBuffer())
    }

    if (isVideo) {
      // Video needs a URL Meta can pull, so it goes via Supabase Storage first. Self-heal: create the
      // bucket if it doesn't exist yet (service-role key), so no manual Supabase step is ever needed.
      const fileName = `${user.id}/${Date.now()}.${fileExt}`
      const bucket = 'ads-media'
      let { error: uploadError } = await admin.storage.from(bucket).upload(fileName, buffer, { contentType, upsert: false })
      if (uploadError && /bucket not found|related resource does not exist|not found/i.test(uploadError.message || '')) {
        await admin.storage.createBucket(bucket, { public: true }).catch(() => {})   // idempotent; ignore "already exists"
        ;({ error: uploadError } = await admin.storage.from(bucket).upload(fileName, buffer, { contentType, upsert: false }))
      }
      if (uploadError) return NextResponse.json({ error: 'Storage upload failed: ' + uploadError.message }, { status: 400 })
      const { data: urlData } = admin.storage.from(bucket).getPublicUrl(fileName)
      const publicUrl = urlData.publicUrl
      const metaForm = new FormData()
      metaForm.append('file_url', publicUrl)
      metaForm.append('access_token', token)
      const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/advideos`, {
        method: 'POST',
        body: metaForm
      })
      const data = await res.json()
      console.log('Meta video:', JSON.stringify(data))
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      return NextResponse.json({ videoId: data.id, hash: data.id, isVideo: true })
    } else {
      // Image: Meta takes the raw bytes as base64 — NO storage bucket needed. (Uploading to a missing
      // `ads-media` bucket first was the real cause of "campaign won't create / upload an image".)
      const base64 = buffer.toString('base64')
      const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: base64, access_token: token }),
      })
      const data = await res.json()
      console.log('Meta image:', JSON.stringify(data))
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      const images = data.images || {}
      const firstKey = Object.keys(images)[0]
      if (!firstKey) return NextResponse.json({ error: 'No image hash returned from Meta' }, { status: 400 })
      return NextResponse.json({ hash: images[firstKey]?.hash, url: images[firstKey]?.url })
    }
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Called after a browser-direct upload to Supabase — registers the video URL with Meta
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const metaAccount = await resolveBrandScopedAccount(admin, user.id)
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id

    const { path, bucket: bucketName } = await request.json()
    if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

    // Create signed download URL now — file exists in storage after client upload
    const { data: signedData, error: signedErr } = await admin.storage
      .from(bucketName || 'ads-media')
      .createSignedUrl(path, 3600)
    if (signedErr) return NextResponse.json({ error: 'Failed to sign URL: ' + signedErr.message }, { status: 400 })

    const metaForm = new FormData()
    metaForm.append('file_url', signedData.signedUrl)
    metaForm.append('access_token', token)
    const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/advideos`, {
      method: 'POST',
      body: metaForm,
    })
    const data = await res.json()
    console.log('Meta video (direct):', JSON.stringify(data))
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
    return NextResponse.json({ videoId: data.id, hash: data.id, isVideo: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
