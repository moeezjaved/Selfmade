/**
 * Voice preview — hear the narrator BEFORE spending credits. POST { text, voice } → mp3 bytes.
 * TTS's the first ~200 chars (a sentence) so the user can audition the voice speaking their actual
 * script in their chosen language. Costs us fractions of a cent; free to the user; auth required.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const VOICES = new Set(['nova', 'shimmer', 'onyx', 'echo'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text, voice } = await req.json().catch(() => ({}))
  const input = String(text || '').trim().slice(0, 200)
  if (!input) return NextResponse.json({ error: 'text required' }, { status: 400 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const speak = (model: string) => fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice: VOICES.has(String(voice)) ? voice : 'nova', input, response_format: 'mp3' }),
  })
  let r = await speak('gpt-4o-mini-tts')
  if (!r.ok) r = await speak('tts-1')   // account/model fallback
  if (!r.ok) return NextResponse.json({ error: `tts_failed_${r.status}` }, { status: 502 })
  const buf = Buffer.from(await r.arrayBuffer())
  return new NextResponse(buf, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } })
}
