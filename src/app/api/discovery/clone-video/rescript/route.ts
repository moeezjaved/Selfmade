/**
 * Re-pace a Cinematic voiceover script to a target LENGTH (the one-tap 15/30/45/60s picker). Free — it's
 * a pre-render helper like the draft script. gpt-4o-mini rewrites the script to ~targetSecs of spoken
 * narration at the TTS rate, preserving the product, message and claims. Scene count + price follow the
 * script length client-side, so this is the single lever that resizes a Cinematic video.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TTS_WPS = 2.6
let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))
const LANG: Record<string, string> = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German' }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const { script, targetSecs, language, productName } = await req.json().catch(() => ({}))
  const src = String(script || '').trim()
  const secs = Math.max(8, Math.min(75, Math.round(Number(targetSecs) || 0)))
  if (!src || !secs) return NextResponse.json({ error: 'script and targetSecs required' }, { status: 400 })

  const needWords = Math.round(secs * TTS_WPS)
  const curWords = src.split(/\s+/).filter(Boolean).length
  const langName = LANG[String(language || 'en')] || 'English'
  const nonEn = language && language !== 'en'
  try {
    const r = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.5, max_tokens: 700, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `Rewrite this ad voiceover to fill about ${secs} seconds of natural spoken narration${nonEn ? ` in ${langName} (natural native ad copy — code-switch English product words where a real creator would)` : ''} — about ${needWords} words. Keep the SAME product (${productName || 'the product'}), the same core message and any claims, developed into a clear ad arc: hook → the problem → introduce the product → how you use it → the benefit → a short call to action. ${needWords < curWords * 0.9 ? 'TIGHTEN it: cut padding and repetition, keep only the strongest lines.' : 'DEVELOP it fully with natural detail — no filler, no repetition.'} Punchy, real, creator/UGC tone. No stage directions, no on-screen-text markers. Current script:\n"${src.replace(/"/g, "'")}"\n\nReturn ONLY JSON: {"script":"..."}` }],
    })
    const out = JSON.parse(r.choices?.[0]?.message?.content || '{}')
    const s = typeof out.script === 'string' && out.script.trim() ? out.script.trim() : src
    return NextResponse.json({ script: s })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 502 })
  }
}
