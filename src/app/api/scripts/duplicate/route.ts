/**
 * POST /api/scripts/duplicate  { sourceAdId, brandId?, brief? }
 * Take a transcribed source ad's framework + beats and rewrite it for the user's brand/product,
 * SAME structure → store generated_scripts. FREE — parity with the Remake studio, which does the
 * identical brand rewrite for free and only charges credits at video render. (Was 35cr, a bug: it
 * charged for a text rewrite the Remake flow gives away.) Requires the source ad transcribed first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { sourceAdId, brandId, brief, language } = await req.json()
  if (!sourceAdId) return NextResponse.json({ error: 'sourceAdId required' }, { status: 400 })
  // Target language for the rewritten script. Defaults to English (like the Remake flow) so a Hindi/Urdu
  // source ad is TRANSCREATED into the brand's language instead of mirroring the source (the bug: the
  // rewrite came out in Hindi). The ad-detail UI passes an explicit choice.
  const LANG: Record<string, string> = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' }
  const langName = LANG[String(language || 'en')] || 'English'

  const { data: src } = await admin.from('ad_scripts').select('*').eq('ad_id', sourceAdId).maybeSingle()
  if (!src?.transcript) return NextResponse.json({ error: 'Source ad not transcribed yet — transcribe it first' }, { status: 400 })

  let brand: any = null
  if (brandId) {
    const { data } = await admin.from('brands').select('*').eq('id', brandId).eq('user_id', user.id).maybeSingle()
    brand = data
  }

  try {
    const sourceText = (src.transcript as any[]).map(s => s.text).join(' ')
    const brandBrief = brand
      ? `Brand: ${brand.name}\nDescription: ${brand.description || ''}\nUSPs: ${(brand.usps || []).join(', ')}\nTone: ${brand.tone || ''}\nTarget: ${brand.target_audience || ''}\nPrefer words: ${(brand.preferred_words || []).join(', ')}\nAvoid words: ${(brand.avoid_words || []).join(', ')}`
      : (typeof brief === 'string' ? brief : JSON.stringify(brief || {}))

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content:
`You are an expert direct-response copywriter. Rewrite the SOURCE ad script for a NEW brand, keeping the EXACT same framework, beat structure, pacing, and persuasion strategy — only swap in the new brand's product, angle, and voice. Do not copy the source's specific claims/product.

SOURCE FRAMEWORK: ${src.framework || 'unknown'}
SOURCE HOOKS: ${(src.hooks || []).join(' | ')}
SOURCE STRATEGIES: ${(src.strategies || []).join(' | ')}

SOURCE SCRIPT:
${sourceText.slice(0, 4000)}

NEW BRAND BRIEF:
${brandBrief}

Write the new script in ${langName} — natural native ad copy (code-switch English product/brand words where a real creator would). Do NOT mirror the source ad's language.

Return ONLY the new script text, ready to read on camera. Match the source's length and structure.` }],
    })
    const script = completion.choices[0]?.message?.content?.trim() || ''

    const { data: row } = await admin.from('generated_scripts').insert({
      user_id: user.id, source_ad_id: sourceAdId, brand_id: brandId || null,
      framework: src.framework, script, brief: brand ? { brandId } : (brief || null),
    }).select().single()

    return NextResponse.json({ generated: row })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'duplication failed' }, { status: 500 })
  }
}
