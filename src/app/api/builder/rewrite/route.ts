/**
 * POST /api/builder/rewrite { text, instruction?, context? } → { text }
 * The Page Builder text editor's "✨ Edit with AI" button. Rewrites the selected copy in the brand's voice
 * (tighter, more persuasive, same intent) or follows an optional instruction. Copy generation is free (no
 * credits), matching the section-agent. Returns plain text; the editor drops it back into the text block.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const text = String(b?.text || '').slice(0, 2000).trim()
  const instruction = String(b?.instruction || '').slice(0, 500).trim()
  const context = String(b?.context || '').slice(0, 800).trim()
  if (!text) return NextResponse.json({ error: 'Nothing to rewrite.' }, { status: 400 })

  const sys = `You rewrite landing-page copy for a Shopify product page. Return ONLY the rewritten text — no quotes, no preamble, no markdown, no explanation. Keep it roughly the same length (a headline stays a headline, a sentence stays a sentence). Preserve the original intent and any concrete facts/numbers. Write in a confident, benefit-led DTC voice.`
  const usr = `${context ? `Product/page context: ${context}\n\n` : ''}${instruction ? `Instruction: ${instruction}\n\n` : 'Make it tighter and more persuasive.\n\n'}Text to rewrite:\n${text}`

  try {
    const r = await oai().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      max_tokens: 400,
    })
    let out = (r.choices[0]?.message?.content || '').trim()
    // Strip wrapping quotes the model sometimes adds.
    out = out.replace(/^["'“”]+|["'“”]+$/g, '').trim()
    if (!out) return NextResponse.json({ error: 'No rewrite produced.' }, { status: 502 })
    return NextResponse.json({ text: out })
  } catch {
    return NextResponse.json({ error: 'Could not rewrite — please try again.' }, { status: 502 })
  }
}
