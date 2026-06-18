/**
 * GET /api/cron/dna-classify → Creative DNA for new ads, SYNCHRONOUSLY.
 *
 * Replaces the OpenAI Batch API path for keeping up (a batch silently stuck
 * in_progress for 9h blocked all new-ad DNA). Classifies each unique copy_sig once
 * with gpt-4o-mini and propagates to every ad sharing that copy. Bounded per run;
 * runs hourly so new ads (e.g. the 700-brand import) get hook/emotion/persona fast.
 *
 * Auth mirrors /api/indexer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))
const MAX_SIGS = 400  // unique copies per run

const HOOK = ['Question', 'Before & After', 'Testimonial', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them', 'Social Proof', 'Pain Point']
const EMOTION = ['curiosity', 'fear', 'desire', 'trust', 'urgency', 'hope', 'excitement', 'relatability', 'aspiration', 'guilt', 'pride']
const ANGLE = ['Pain Point', 'Aspiration', 'Social Proof', 'Authority', 'Scarcity', 'Curiosity', 'Value', 'Story', 'Comparison']
const TONE = ['Casual', 'Professional', 'Urgent', 'Inspirational', 'Humorous', 'Educational', 'Emotional']
const SCHEMA = {
  name: 'dna', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['hook_type', 'emotion', 'angle', 'tone', 'persona', 'desire', 'usp', 'topics'],
    properties: {
      hook_type: { type: 'string', enum: HOOK },
      emotion: { type: 'array', items: { type: 'string', enum: EMOTION } },
      angle: { type: 'string', enum: ANGLE },
      tone: { type: 'string', enum: TONE },
      persona: { type: 'string', description: 'target audience, max 5 words' },
      desire: { type: 'string', description: 'core desire addressed, max 5 words' },
      usp: { type: 'string', description: 'main unique selling point, max 8 words' },
      topics: { type: 'array', items: { type: 'string' }, description: '3-6 specific product/benefit/category tags, lowercase; NOT generic words like health/sale' },
    },
  },
} as const

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

async function classify(text: string): Promise<any | null> {
  try {
    const r = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [{ role: 'user', content: `Analyze this ad copy. Identify the hook_type, emotion(s), angle, tone, target persona, core desire, USP, and 3-6 specific topic tags.\n\n${text.slice(0, 3000)}` }],
    })
    return JSON.parse(r.choices[0]?.message?.content || '{}')
  } catch { return null }
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const started = Date.now()

  // Unique copy_sigs needing DNA (is_classifiable + no hook yet). Dedup by copy_sig.
  const bySig = new Map<string, string>()  // copy_sig -> text
  let cursor = ''
  while (bySig.size < MAX_SIGS) {
    let q = admin.from('discovery_ads_index')
      .select('ad_id,copy_sig,title,body').eq('is_classifiable', true).is('hook_type', null)
      .order('ad_id', { ascending: true }).limit(1000)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: false, step: 'scan', error: error.message }, { status: 500 })
    if (!data || !data.length) break
    for (const a of data as any[]) {
      if (a.copy_sig && !bySig.has(a.copy_sig)) bySig.set(a.copy_sig, `${a.title || ''}\n${a.body || ''}`.trim())
      if (bySig.size >= MAX_SIGS) break
    }
    cursor = (data[data.length - 1] as any).ad_id
    if (data.length < 1000) break
  }
  if (!bySig.size) return NextResponse.json({ ok: true, sigs: 0, propagated: 0, duration_ms: Date.now() - started })

  // Classify (concurrency pool) + propagate to all ads with that copy_sig.
  const sigs = Array.from(bySig.entries())
  let i = 0, done = 0, wrote = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < sigs.length) {
      const [sig, text] = sigs[i++]
      const dna = await classify(text); done++
      if (!dna) continue
      const body = {
        hook_type: dna.hook_type, emotion: dna.emotion || [], angle: dna.angle, tone: dna.tone,
        persona: (dna.persona || '').slice(0, 80) || null, desire: (dna.desire || '').slice(0, 80) || null,
        usp: (dna.usp || '').slice(0, 120) || null, topics: dna.topics || [], ai_classified: true,
      }
      const { error } = await admin.from('discovery_ads_index').update(body).eq('copy_sig', sig)
      if (!error) wrote++
    }
  }))

  return NextResponse.json({ ok: true, sigs: done, propagated: wrote, duration_ms: Date.now() - started })
}
