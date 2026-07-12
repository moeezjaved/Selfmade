/**
 * GET /api/reports/ad/[adId]/transcript — auto-transcribe the ad's video (Whisper) into timestamped
 * segments. Cached in R2 (transcripts/<adId>.json) so each video is transcribed once. Cheap
 * (~$0.006/min) and cached forever.
 */
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const V = process.env.META_API_VERSION || 'v20.0'
const cacheKey = (adId: string) => `transcripts/${adId}.json`

async function cached(adId: string): Promise<any | null> {
  const url = r2PublicUrl(cacheKey(adId)); if (!url) return null
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null } catch { return null }
}

export async function GET(req: NextRequest, { params }: { params: { adId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adId = params.adId

  const hit = await cached(adId)
  if (hit) return NextResponse.json(hit)
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not_configured', segments: [] })

  const admin = createAdminClient()
  let acct: any
  try { acct = await resolveScopedAccount(admin, user.id) } catch { acct = null }
  if (!acct?.account_id) return NextResponse.json({ error: 'no_account', segments: [] })
  const token = decryptToken(acct.access_token)

  try {
    // Resolve the ad's video source URL.
    const cr = await fetch(`https://graph.facebook.com/${V}/${adId}?fields=creative{video_id,object_story_spec}&access_token=${token}`).then(r => r.json())
    const vid = cr?.creative?.video_id || cr?.creative?.object_story_spec?.video_data?.video_id
    if (!vid) return NextResponse.json({ error: 'no_video', segments: [] })
    const v = await fetch(`https://graph.facebook.com/${V}/${vid}?fields=source,length&access_token=${token}`).then(r => r.json())
    if (!v?.source) return NextResponse.json({ error: 'no_source', segments: [] })

    // Download the video and hand it to Whisper with segment timestamps.
    const vidRes = await fetch(v.source)
    if (!vidRes.ok) return NextResponse.json({ error: 'download_failed', segments: [] })
    const buf = Buffer.from(await vidRes.arrayBuffer())
    if (buf.byteLength > 24 * 1024 * 1024) return NextResponse.json({ error: 'too_large', segments: [] })

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const file = await toFile(buf, 'ad.mp4', { type: 'video/mp4' })
    const tr: any = await openai.audio.transcriptions.create({
      file, model: 'whisper-1', response_format: 'verbose_json', timestamp_granularities: ['segment'],
    })
    const segments = (tr.segments || []).map((s: any) => ({ start: Math.round(s.start), text: (s.text || '').trim() })).filter((s: any) => s.text)
    const out = { lang: (tr.language || 'en').slice(0, 2).toUpperCase(), duration: Math.round(tr.duration || v.length || 0), segments }
    await uploadBufferToR2(Buffer.from(JSON.stringify(out)), cacheKey(adId), 'application/json').catch(() => null)
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'transcribe_failed', segments: [] })
  }
}
