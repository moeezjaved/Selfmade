/**
 * Poll an Animate (Veo) job. GET ?id=<creative_generations.id> → { done, url? , error? }.
 * When Veo finishes: downloads the MP4 → uploads to R2 → marks the row done → commits credits.
 * On failure: refunds the reserved credits and marks the row failed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { pollVideo } from '@/lib/gemini/video'
import { uploadBufferToR2 } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations')
    .select('id, status, operation, credit_tx, image_url').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const r = row as any
  if (r.status === 'done') return NextResponse.json({ done: true, url: r.image_url })
  if (r.status === 'failed') return NextResponse.json({ done: true, error: 'generation failed' })
  if (!r.operation) return NextResponse.json({ done: false })

  const res = await pollVideo(r.operation)
  if (!res.done) return NextResponse.json({ done: false })

  const commit = async () => { if (r.credit_tx) await admin.rpc('commit_credits', { p_tx: r.credit_tx, p_metadata: {} }).then(() => {}, () => {}) }
  const refund = async () => { if (r.credit_tx) await admin.rpc('refund_credits', { p_tx: r.credit_tx }).then(() => {}, () => {}) }

  if (res.error || !res.videoB64) {
    await refund()
    await admin.from('creative_generations').update({ status: 'failed' }).eq('id', id)
    console.warn('animate failed:', res.error)
    return NextResponse.json({ done: true, error: res.error || 'no video produced' })
  }

  const buf = Buffer.from(res.videoB64, 'base64')
  const key = `creatives/${user.id}/${Buffer.from(`${user.id}:${process.hrtime.bigint()}`).toString('hex').slice(0, 24)}.mp4`
  const url = await uploadBufferToR2(buf, key, res.mimeType || 'video/mp4')
  if (!url) {
    await refund()
    await admin.from('creative_generations').update({ status: 'failed' }).eq('id', id)
    return NextResponse.json({ done: true, error: 'could not store video (R2)' })
  }

  await admin.from('creative_generations').update({ status: 'done', image_url: url, media_type: 'video' }).eq('id', id)
  await commit()
  return NextResponse.json({ done: true, url })
}
