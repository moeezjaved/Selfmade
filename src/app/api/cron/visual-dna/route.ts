/**
 * GET /api/cron/visual-dna → Visual Creative DNA for winning ads.
 *
 * gpt-4o-mini vision over UNIQUE winning creatives (dedup by image/video hash),
 * then propagates the label to every ad sharing that hash (winners-only spend,
 * catalog-wide coverage). Extracts format_style (UGC vs studio), visual_style,
 * visual_scene, and on_screen_text (which recovers DNA for text-less DPA/video ads).
 *
 * Bounded per run (MAX_CREATIVES) to stay under Vercel's 300s. Auth mirrors /api/indexer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isCrawlPaused } from '@/lib/discovery/pause'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))
const MAX_CREATIVES = 400  // per-run cap (keeps under the 300s function limit)

const FORMAT_STYLE = ['UGC', 'Studio / Produced', 'Graphic / Text', 'Mixed']
const VISUAL_STYLE = ['Selfie / Handheld', 'Bathroom / Mirror', 'Kitchen / Home', 'Outdoor / Lifestyle',
  'Studio Product Shot', 'Before & After', 'Text Overlay Graphic', 'Unboxing', 'Talking Head',
  'Demo / How-to', 'Flat Lay', 'Lifestyle Person', 'Other']
const SCHEMA = {
  name: 'visual_dna', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['format_style', 'visual_style', 'visual_scene', 'on_screen_text'],
    properties: {
      format_style: { type: 'string', enum: FORMAT_STYLE },
      visual_style: { type: 'string', enum: VISUAL_STYLE },
      visual_scene: { type: 'string', description: 'one short phrase describing the shot, max 8 words' },
      on_screen_text: { type: 'string', description: 'prominent text overlaid on the image, verbatim; empty string if none' },
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

async function vision(thumb: string): Promise<any | null> {
  try {
    const r = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [{
        role: 'user', content: [
          { type: 'text', text: 'Analyze this ad creative. Is it UGC (authentic/phone-shot) vs studio-produced vs a text graphic? What is the dominant visual setting? Describe the shot in one short phrase, and transcribe any prominent text overlaid on the image verbatim.' },
          { type: 'image_url', image_url: { url: thumb, detail: 'low' } },
        ] as any,
      }],
    })
    return JSON.parse(r.choices[0]?.message?.content || '{}')
  } catch { return null }
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (await isCrawlPaused(admin)) return NextResponse.json({ ok: true, skipped: 'crawl_paused' })
  const started = Date.now()

  // 1. unclassified winning ads → unique creatives (dedup by hash)
  const uniq = new Map<string, { col: string; hash: string; thumb: string }>()
  let cursor = ''
  while (uniq.size < MAX_CREATIVES) {
    let q = admin.from('discovery_ads_index')
      .select('ad_id,image_hash,video_hash,thumbnail_url')
      .eq('performance_tier', 'winning').is('visual_classified', false)
      .order('ad_id', { ascending: true }).limit(1000)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: false, step: 'scan', error: error.message }, { status: 500 })
    if (!data || !data.length) break
    for (const a of data as any[]) {
      const thumb = a.thumbnail_url
      if (!thumb || !/r2\.dev/.test(thumb)) continue
      const col = a.image_hash ? 'image_hash' : (a.video_hash ? 'video_hash' : null)
      if (!col) continue
      const hash = a.image_hash || a.video_hash
      const key = col + ':' + hash
      if (!uniq.has(key)) uniq.set(key, { col, hash, thumb })
      if (uniq.size >= MAX_CREATIVES) break
    }
    cursor = (data[data.length - 1] as any).ad_id
    if (data.length < 1000) break
  }
  if (!uniq.size) return NextResponse.json({ ok: true, creatives: 0, wrote: 0, duration_ms: Date.now() - started })

  // 2. classify (concurrency pool) + propagate to all ads sharing the hash
  const items = Array.from(uniq.values())
  let i = 0, done = 0, wrote = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < items.length) {
      const it = items[i++]
      const dna = await vision(it.thumb); done++
      if (!dna) continue
      const body = {
        format_style: dna.format_style, visual_style: dna.visual_style,
        visual_scene: (dna.visual_scene || '').slice(0, 120),
        on_screen_text: (dna.on_screen_text || '').slice(0, 500), visual_classified: true,
      }
      const { error } = await admin.from('discovery_ads_index').update(body).eq(it.col as any, it.hash)
      if (!error) wrote++
    }
  }))

  return NextResponse.json({ ok: true, creatives: done, propagated: wrote, duration_ms: Date.now() - started })
}
