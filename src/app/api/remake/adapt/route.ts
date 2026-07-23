/**
 * POST /api/remake/adapt — the magic before the money button.
 * "I studied this campaign. Here's why it worked. I've already adapted it for {brand}."
 * Takes a winning ad's copy + classified DNA and the user's brand + product, and has
 * Mello rewrite the winning STRUCTURE around the user's product — hook, primary text,
 * scene beats, voiceover — so the remake screen opens pre-filled instead of blank.
 *
 * This is a PREVIEW only: it never spends credits or generates media (that stays the
 * existing Remake flow). Auth-gated; fail-soft to a grounded template if the LLM is
 * unavailable so the panel is never empty.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Adaptation = { studied: string; hook: string; primaryText: string; scenes: string[]; voiceover: string }

const template = (ad: any, brand: any, product?: any): Adaptation => {
  const b = brand?.name || 'your brand'
  const p = product?.name || product || (b === 'your brand' ? 'your product' : `${b}`)
  return {
    studied: `It opens on a ${String(ad.hook_type || 'strong').toLowerCase()} hook and rides ${ad.emotion || 'a clear emotion'} — a structure that's kept it running ${ad.days_running || 'for weeks'} days.`,
    hook: `The same opening, rebuilt for ${p}.`,
    primaryText: ad.body ? `Your version of: "${String(ad.body).slice(0, 120)}…"` : `A ${p} take on this winner.`,
    scenes: ['Open on the hook — your product in the first 2s', 'Show the problem it solves', 'The transformation / proof', 'Direct CTA'],
    voiceover: `Written in ${b}'s voice, matched to the pacing that made the original work.`,
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const adId = String(body.adId || '')
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })
  const admin = createAdminClient() as any

  const [{ data: ad }, { data: brand }] = await Promise.all([
    admin.from('discovery_ads_index')
      .select('ad_id, page_name, title, body, hook_type, emotion, angle, tone, persona, desire, usp, problem, mechanism, offer, cta, format_style, niche, days_running')
      .eq('ad_id', adId).maybeSingle(),
    body.brandId
      ? admin.from('brands').select('id, name, website, description, brand_type').eq('id', body.brandId).eq('user_id', user.id).maybeSingle()
      : admin.from('brands').select('id, name, website, description, brand_type').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (!ad) return NextResponse.json({ error: 'ad not found' }, { status: 404 })
  if (!brand) return NextResponse.json({ needsBrand: true })

  const { data: products } = await admin.from('brand_products').select('name').eq('brand_id', brand.id).limit(3)
  const product = products?.[0]

  let out = template(ad, brand, product)
  try {
    if (process.env.OPENAI_API_KEY) {
      const winner = Object.fromEntries(Object.entries({
        brand: ad.page_name, headline: ad.title, copy: String(ad.body || '').slice(0, 700),
        hook: ad.hook_type, emotion: ad.emotion, angle: ad.angle, tone: ad.tone,
        persona: ad.persona, desire: ad.desire, usp: ad.usp, problem: ad.problem,
        mechanism: ad.mechanism, offer: ad.offer, cta: ad.cta, format: ad.format_style,
      }).filter(([, v]) => v != null && String(v).trim() !== ''))
      const mine = Object.fromEntries(Object.entries({
        brand: brand.name, website: brand.website, description: brand.description,
        type: brand.brand_type, product: product?.name, niche: ad.niche,
      }).filter(([, v]) => v != null && String(v).trim() !== ''))
      const or = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: 480, temperature: 0.6, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are Mello, a senior direct-response copywriter. You are given a WINNING ad (structure + DNA) and the USER\'S brand/product. Adapt the winning STRUCTURE to the user\'s product — keep what made it work (the hook shape, emotional angle, pacing), swap in the user\'s product truthfully. Never invent claims or metrics about the user\'s product; if unsure, stay benefit-general. Return JSON: {"studied": string (1 sentence: why the original works), "hook": string (the user\'s new opening line, punchy, ≤14 words), "primaryText": string (2-3 sentence ad primary text for the user\'s brand), "scenes": string[] (3-5 short scene beats for a video version), "voiceover": string (1-2 sentence VO line in the brand\'s voice)}.' },
            { role: 'user', content: JSON.stringify({ winning_ad: winner, my_brand: mine }) },
          ],
        }),
      })
      if (or.ok) {
        const j = await or.json()
        const p = JSON.parse(j.choices?.[0]?.message?.content || '{}')
        if (p.hook && Array.isArray(p.scenes)) {
          out = {
            studied: String(p.studied || out.studied).slice(0, 220),
            hook: String(p.hook).slice(0, 140),
            primaryText: String(p.primaryText || out.primaryText).slice(0, 400),
            scenes: p.scenes.map((s: any) => String(s).slice(0, 120)).slice(0, 5),
            voiceover: String(p.voiceover || out.voiceover).slice(0, 300),
          }
        }
      }
    }
  } catch { /* grounded template stands */ }

  return NextResponse.json({ adaptation: out, brand: { id: brand.id, name: brand.name }, adBrand: ad.page_name })
}
