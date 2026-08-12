/**
 * POST /api/scripts/transcribe  { adId }
 * reserve(2cr) → Whisper transcript of the ad video → gpt-4o-mini framework/hook
 * analysis → store ad_scripts → commit. Refunds on any failure (no charge for a
 * failed transcription). Cached: if the ad is already transcribed, returns it free.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))
const MAX_BYTES = 25 * 1024 * 1024  // Whisper hard limit

const ANALYSIS_SCHEMA = {
  name: 'script_analysis',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['framework', 'hooks', 'strategies'],
    properties: {
      framework: { type: 'string' },                       // BAB | PAS | AIDA | etc.
      hooks: { type: 'array', items: { type: 'string' } },
      strategies: { type: 'array', items: { type: 'string' } },
    },
  },
} as const

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { adId, language } = await req.json()
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })
  // Surfaced hooks/framework should read in the user's language (default English), NOT the source ad's
  // language — the bug was a Hindi ad showing Hindi hooks. The Whisper transcript stays the literal ad.
  const LANG: Record<string, string> = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' }
  const langName = LANG[String(language || 'en')] || 'English'

  // Analyze framework + hooks + strategies in the target language (cheap gpt-4o-mini).
  const analyze = async (text: string) => {
    const an = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
      messages: [{ role: 'user', content: `Analyze this ad. Identify the copywriting FRAMEWORK (e.g. PAS, AIDA, BAB, Problem-Solution), the HOOKS (first lines / attention grabbers), and persuasion STRATEGIES. Write the framework name, hooks and strategies in ${langName} — the ad itself may be in another language, so translate/transcreate them into ${langName}. Return JSON.\n\n${text.slice(0, 6000) || '(no transcribable content)'}` }],
    })
    return JSON.parse(an.choices[0]?.message?.content || '{}')
  }

  // Cache hit → free. Re-run the cheap analysis in the requested language so cached hooks/framework
  // aren't stuck in the source ad's language (Whisper transcript is reused, not re-run).
  const { data: existing } = await admin.from('ad_scripts').select('*').eq('ad_id', adId).maybeSingle()
  if (existing?.transcript) {
    try {
      const spoken = (existing.transcript as any[]).map((s: any) => s.text).join(' ')
      const analysis = await analyze(spoken)
      const updated = {
        ...existing,
        framework: analysis.framework || existing.framework || null,
        hooks: Array.isArray(analysis.hooks) && analysis.hooks.length ? analysis.hooks : (existing.hooks || []),
        strategies: Array.isArray(analysis.strategies) && analysis.strategies.length ? analysis.strategies : (existing.strategies || []),
      }
      await admin.from('ad_scripts').update({ framework: updated.framework, hooks: updated.hooks, strategies: updated.strategies }).eq('ad_id', adId)
      return NextResponse.json({ script: updated, cached: true })
    } catch { return NextResponse.json({ script: existing, cached: true }) }
  }

  // Need the ad's video (+ its written copy — many UGC ads carry the real message in
  // on-screen text/caption, not speech, so we fold the body into the analysis).
  const { data: ad } = await admin
    .from('discovery_ads_index').select('video_url, format, body, title').eq('ad_id', adId).maybeSingle()
  // discovery_ads_index.video_url is null for almost every ad — the real playable video is the video
  // CREATIVE (discovery_creatives.r2_url where asset_type='video'), exactly what the detail page plays.
  // Fall back to that so "Generate Script" works on the video ads it's offered on.
  let videoUrl = (ad as any)?.video_url as string | undefined
  if (!videoUrl) {
    const { data: vc } = await admin.from('discovery_creatives')
      .select('r2_url').eq('ad_id', adId).eq('asset_type', 'video').not('r2_url', 'is', null).limit(1).maybeSingle()
    videoUrl = (vc as any)?.r2_url || undefined
  }
  if (!videoUrl) return NextResponse.json({ error: 'Ad has no video to transcribe' }, { status: 400 })

  // Generate Script is FREE — it's the teaser that reads a competitor's hook & structure to pull the
  // founder toward the paid "Rewrite for my brand" step. (A stray price row had made it show a charge.)
  try {
    const vidRes = await fetch(videoUrl)
    if (!vidRes.ok) throw new Error('could not fetch ad video')
    const buf = Buffer.from(await vidRes.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) throw new Error('video too large to transcribe (>25MB)')

    const file = new File([buf], 'ad.mp4', { type: 'video/mp4' })
    const tr: any = await getOpenAI().audio.transcriptions.create({
      file, model: 'whisper-1', response_format: 'verbose_json',
    })
    const transcript = (tr.segments || []).map((s: any) => ({ t: Math.round(s.start), text: (s.text || '').trim() }))
    const spoken = (tr.text || transcript.map((s: any) => s.text).join(' ')).trim()
    const thinSpeech = spoken.replace(/[^a-z]/gi, '').length < 40   // little/no spoken audio (text-overlay UGC)

    // Many UGC ads carry the message in on-screen text/caption, not speech — so fold the
    // ad's written copy in. Skip Shopify {{template}} junk.
    const copy = `${ad.title || ''} ${ad.body || ''}`.replace(/\{\{[^}]*\}\}/g, '').trim()
    const analyzeText = [spoken, copy && `[ad copy] ${copy}`].filter(Boolean).join('\n\n')

    // Analyze framework + hooks + strategies (cheap), in the target language.
    const analysis = await analyze(analyzeText)

    const row = {
      ad_id: adId, transcript,
      framework: analysis.framework || null,
      hooks: Array.isArray(analysis.hooks) ? analysis.hooks : [],
      strategies: Array.isArray(analysis.strategies) ? analysis.strategies : [],
    }
    await admin.from('ad_scripts').upsert(row, { onConflict: 'ad_id' })
    return NextResponse.json({ script: row, thinSpeech, cached: false })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'transcription failed' }, { status: 500 })
  }
}
