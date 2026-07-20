/**
 * Voice preview — hear the narrator BEFORE spending credits. POST { text, voice } → mp3 bytes.
 * TTS's the first ~200 chars (a sentence) so the user can audition the voice speaking their actual
 * script in their chosen language. Costs us fractions of a cent; free to the user; auth required.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const VOICES = new Set(['nova', 'shimmer', 'onyx', 'echo'])
// Same OpenAI-voice → ElevenLabs-preset map as the worker, so the preview matches the final video.
const ELEVEN_VOICE_MAP: Record<string, string> = {
  nova: process.env.ELEVEN_VOICE_NOVA || '21m00Tcm4TlvDq8ikWAM',
  shimmer: process.env.ELEVEN_VOICE_SHIMMER || 'EXAVITQu4vr4xnSDxMaL',
  onyx: process.env.ELEVEN_VOICE_ONYX || 'pNInz6obpgDQGcFmaJgB',
  echo: process.env.ELEVEN_VOICE_ECHO || 'ErXwobaYiN019PkySvjV',
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text, voice, lang, full } = await req.json().catch(() => ({}))
  // `full` = preview the WHOLE script (up to ~1800 chars ≈ a 60s read) so the user can hear every word
  // — brand names, foreign words — BEFORE spending a credit. Default stays the quick first-sentence clip.
  const input = String(text || '').trim().slice(0, full ? 1800 : 200)
  if (!input) return NextResponse.json({ error: 'text required' }, { status: 400 })
  const v = VOICES.has(String(voice)) ? String(voice) : 'nova'
  const nonEn = lang && String(lang).slice(0, 2) !== 'en'

  // Non-English → ElevenLabs Multilingual v2 (matches the final render's voice), fall back to OpenAI.
  if (nonEn && process.env.ELEVENLABS_API_KEY) {
    try {
      const er = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_MAP[v]}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: input, model_id: process.env.ELEVEN_TTS_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
      })
      if (er.ok) return new NextResponse(Buffer.from(await er.arrayBuffer()), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } })
    } catch { /* fall through to OpenAI */ }
  }

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const speak = (model: string) => fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice: v, input, response_format: 'mp3' }),
  })
  let r = await speak('gpt-4o-mini-tts')
  if (!r.ok) r = await speak('tts-1')   // account/model fallback
  if (!r.ok) return NextResponse.json({ error: `tts_failed_${r.status}` }, { status: 502 })
  const buf = Buffer.from(await r.arrayBuffer())
  return new NextResponse(buf, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } })
}
