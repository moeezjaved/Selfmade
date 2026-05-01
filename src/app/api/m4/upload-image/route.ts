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

    const body = await request.json()
    const { base64, mimeType, name, isVideo: isVid, fileSize } = body

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = "act_" + metaAccount.account_id
    const isVideo = isVid || mimeType?.startsWith('video/')

    // Handle chunk upload
    const { isChunk, chunk, uploadSessionId, startOffset: chunkStart, adAccountId: chunkAccountId, token: chunkToken } = body
    if (isChunk) {
      const chunkBytes = Buffer.from(chunk, 'base64')
      const cf = new FormData()
      cf.append('upload_phase', 'transfer')
      cf.append('upload_session_id', uploadSessionId)
      cf.append('start_offset', String(chunkStart))
      cf.append('video_file_chunk', new Blob([chunkBytes]))
      cf.append('access_token', chunkToken)
      const cr = await fetch("https://graph.facebook.com/" + V + "/" + chunkAccountId + "/advideos", {method:'POST', body:cf})
      const cd = await cr.json()
      if (cd.error) return NextResponse.json({error: cd.error.message}, {status:400})
      const so = parseInt(cd.start_offset)
      const eo = parseInt(cd.end_offset)
      return NextResponse.json({startOffset: so, endOffset: eo, done: so === eo})
    }

    if (isVideo) {
      const sessionRes = await fetch("https://graph.facebook.com/" + V + "/" + adAccountId + "/advideos", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_phase: 'start', file_size: fileSize || 10000000, access_token: token })
      })
      const session = await sessionRes.json()
      if (session.error) return NextResponse.json({ error: session.error.message }, { status: 400 })
      return NextResponse.json({
        uploadSessionId: session.upload_session_id,
        videoId: session.video_id,
        startOffset: session.start_offset,
        endOffset: session.end_offset,
        token,
        adAccountId,
        isVideo: true,
      })
    }

    if (!base64) return NextResponse.json({ error: 'No image data' }, { status: 400 })

    const res = await fetch("https://graph.facebook.com/" + V + "/" + adAccountId + "/adimages", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: base64, access_token: token })
    })
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
    const images = data.images
    const firstKey = Object.keys(images)[0]
    return NextResponse.json({ hash: images[firstKey]?.hash, url: images[firstKey]?.url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { uploadSessionId, videoId, token, adAccountId } = await request.json()
    const res = await fetch("https://graph.facebook.com/" + V + "/" + adAccountId + "/advideos", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_phase: 'finish', upload_session_id: uploadSessionId, access_token: token })
    })
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
    return NextResponse.json({ hash: videoId, videoId, isVideo: true, success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
