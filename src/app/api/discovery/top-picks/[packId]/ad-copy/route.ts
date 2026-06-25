/**
 * Top Picks — AI ad-copy rewrite. Given an ad in an UNLOCKED pack, returns a few fresh
 * hook+body variants the user can paste into the Canva template. Mirrors the gating in the
 * pack-detail route (free or purchased only).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))

export async function POST(req: NextRequest, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { adId } = await req.json()
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })

  const admin = createReadClient()
  // Verify the ad is in this pack and the user may see it (free or purchased).
  const { data: pack } = await admin.from('expert_packs').select('id, gate, is_published').eq('id', packId).maybeSingle()
  if (!pack || !pack.is_published) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: inPack } = await admin.from('expert_pack_ads').select('id').eq('pack_id', packId).eq('ad_id', adId).maybeSingle()
  if (!inPack) return NextResponse.json({ error: 'ad not in pack' }, { status: 404 })
  if (pack.gate !== 'free') {
    const { data: pur } = await admin.from('expert_pack_purchases').select('id').eq('user_id', user.id).eq('pack_id', packId).maybeSingle()
    if (!pur) return NextResponse.json({ error: 'locked', message: 'Unlock this pack first.' }, { status: 403 })
  }

  const { data: ad } = await admin
    .from('discovery_ads_index')
    .select('page_name, body, title, on_screen_text')
    .eq('ad_id', adId).maybeSingle()
  if (!ad) return NextResponse.json({ error: 'ad not found' }, { status: 404 })

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  const source = [ad.title, ad.body, ad.on_screen_text].filter(Boolean).join('\n').slice(0, 1500)
  try {
    const res = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a direct-response ad copywriter. Given a winning ad, write 3 fresh variations that keep its persuasive structure but use new hooks and angles. Return JSON: {"variants":[{"hook":"...","body":"..."}]}. Hooks are short and scroll-stopping; bodies are 1-3 punchy sentences.' },
        { role: 'user', content: `Brand: ${ad.page_name || 'unknown'}\n\nWinning ad copy:\n${source}\n\nWrite 3 fresh variants.` },
      ],
    })
    const raw = res.choices[0]?.message?.content || '{}'
    let variants: { hook: string; body: string }[] = []
    try { variants = (JSON.parse(raw).variants || []).slice(0, 3) } catch { variants = [] }
    return NextResponse.json({ variants })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'generation failed' }, { status: 500 })
  }
}
