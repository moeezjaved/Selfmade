import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { base64, mimeType, name } = await request.json()
    if (!base64) return NextResponse.json({ error: 'No image data' }, { status: 400 })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()

    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`

    // Handle video vs image upload
    const isVideo = mimeType?.startsWith('video/')

    if (isVideo) {
      // Upload video to Meta
      const videoRes = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/advideos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: `data:${mimeType};base64,${base64}`, access_token: token, title: name || 'Ad Video' })
      })
      const videoData = await videoRes.json()
      if (videoData.error) {
        // Fallback: try uploading as form data approach - return placeholder
        console.log('Video upload error:', videoData.error.message)
        return NextResponse.json({ hash: null, url: null, error: videoData.error.message, isVideo: true })
      }
      return NextResponse.json({ hash: videoData.id, url: null, isVideo: true, name })
    }

    const res = await fetch(`https://graph.facebook.com/${V}/${adAccountId}/adimages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: base64, access_token: token })
    })

    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const images = data.images
    const firstKey = Object.keys(images)[0]
    const hash = images[firstKey]?.hash
    const url = images[firstKey]?.url

    return NextResponse.json({ hash, url, name: firstKey })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
