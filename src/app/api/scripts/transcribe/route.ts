/**
 * POST /api/scripts/transcribe  { adId }
 * reserve(2cr) → Whisper transcript of the ad video → gpt-4o-mini framework/hook
 * analysis → store ad_scripts → commit. Refunds on any failure (no charge for a
 * failed transcription). Cached: if the ad is already transcribed, returns it free.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
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
  const { adId } = await req.json()
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })

  // Cache hit → free, no reserve.
  const { data: existing } = await admin.from('ad_scripts').select('*').eq('ad_id', adId).maybeSingle()
  if (existing?.transcript) return NextResponse.json({ script: existing, cached: true })

  // Need the ad's video (+ its written copy — many UGC ads carry the real message in
  // on-screen text/caption, not speech, so we fold the body into the analysis).
  const { data: ad } = await admin
    .from('discovery_ads_index').select('video_url, format, body, title').eq('ad_id', adId).maybeSingle()
  if (!ad?.video_url) return NextResponse.json({ error: 'Ad has no video to transcribe' }, { status: 400 })

  let tx
  try {
    tx = await reserveCredits(admin, user.id, 'transcribe', adId)
  } catch (e) {
    if (e instanceof InsufficientCreditsError)
      return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have }, { status: 402 })
    throw e
  }

  try {
    const vidRes = await fetch(ad.video_url)
    if (!vidRes.ok) throw new Error('could not fetch ad video')
    const buf = Buffer.from(await vidRes.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) throw new Error('video too large to transcribe (>25MB)')

    const file = new File([buf], 'ad.mp4', { type: 'video/mp4' })
    const tr: any = await openai.audio.transcriptions.create({
      file, model: 'whisper-1', response_format: 'verbose_json',
    })
    const transcript = (tr.segments || []).map((s: any) => ({ t: Math.round(s.start), text: (s.text || '').trim() }))
    const spoken = (tr.text || transcript.map((s: any) => s.text).join(' ')).trim()
    const thinSpeech = spoken.replace(/[^a-z]/gi, '').length < 40   // little/no spoken audio (text-overlay UGC)

    // Many UGC ads carry the message in on-screen text/caption, not speech — so fold the
    // ad's written copy in. Skip Shopify {{template}} junk.
    const copy = `${ad.title || ''} ${ad.body || ''}`.replace(/\{\{[^}]*\}\}/g, '').trim()
    const analyzeText = [spoken, copy && `[ad copy] ${copy}`].filter(Boolean).join('\n\n')

    // Analyze framework + hooks + strategies (cheap).
    const an = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
      messages: [{ role: 'user', content: `Analyze this ad. Identify the copywriting FRAMEWORK (e.g. PAS, AIDA, BAB, Problem-Solution), the HOOKS (first lines / attention grabbers), and persuasion STRATEGIES. Return JSON.\n\n${analyzeText.slice(0, 6000) || '(no transcribable content)'}` }],
    })
    const analysis = JSON.parse(an.choices[0]?.message?.content || '{}')

    const row = {
      ad_id: adId, transcript,
      framework: analysis.framework || null,
      hooks: Array.isArray(analysis.hooks) ? analysis.hooks : [],
      strategies: Array.isArray(analysis.strategies) ? analysis.strategies : [],
    }
    await admin.from('ad_scripts').upsert(row, { onConflict: 'ad_id' })
    await commitCredits(admin, tx.id, {
      model: 'whisper-1+gpt-4o-mini', segments: transcript.length,
      actual_cost_usd: 0.006, reference_id: adId,
    })
    return NextResponse.json({ script: row, thinSpeech, cached: false })
  } catch (e: any) {
    await refundCredits(admin, tx.id).catch(() => {})
    return NextResponse.json({ error: e?.message || 'transcription failed' }, { status: 500 })
  }
}
