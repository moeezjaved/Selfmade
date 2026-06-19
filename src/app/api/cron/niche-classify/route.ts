/**
 * GET /api/cron/niche-classify → keeps `niche` at ~100% coverage as new ads crawl in.
 *
 * Niche is BRAND-level (GetHookd's 33-niche taxonomy). For ads missing a niche:
 *   1. if their brand is already classified → inherit it (FREE, no API call)
 *   2. only a genuinely-new advertiser triggers one gpt-4o-mini call (enum-locked)
 * Then stamps the niche on the brand's unlabelled ads. Cheap + durable.
 *
 * Auth mirrors /api/indexer. Runs daily (Vercel cron), before the rollup so
 * niche_counts is fresh.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isCrawlPaused } from '@/lib/discovery/pause'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))

const NICHES = [
  'Beauty', 'Skincare', 'Fashion', 'Accessories', 'Jewelry & Watches', 'Health & Wellness',
  'Supplements', 'Medical', 'Sports & Outdoors', 'Pets', 'Travel', 'Alcohol', 'App / Software',
  'Automotive', 'Book / Publishing', 'Business / Professional', 'CBD / Cannabis', 'Charity / Non-Profit',
  'Entertainment', 'Finance', 'Food & Drink', 'Games', 'Government', 'Home & Garden', 'Info Products',
  'Insurance', 'Kids & Baby', 'Media / News', 'Real Estate', 'Service Business', 'Subscription Box', 'Tech', 'Other',
]
const NICHE_SCHEMA = {
  name: 'niche', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['niche'], properties: { niche: { type: 'string', enum: NICHES } } },
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

async function classifyBrand(name: string, text: string): Promise<string> {
  try {
    const r = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0,
      response_format: { type: 'json_schema', json_schema: NICHE_SCHEMA },
      messages: [{ role: 'user', content: `Categorize this advertiser into exactly ONE niche from the allowed list. Pick the single best fit for the brand's core product.\n\nBrand: ${name}\nSample ad copy:\n${text || '(no text)'}` }],
    })
    return JSON.parse(r.choices[0]?.message?.content || '{}').niche || 'Other'
  } catch { return 'Other' }
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (await isCrawlPaused(admin)) return NextResponse.json({ ok: true, skipped: 'crawl_paused' })
  const started = Date.now()

  // 1. Collect ads missing a niche (+ a text sample per brand). Keyset, bounded.
  type Row = { ad_id: string; page_id: string; page_name: string | null; title: string | null; body: string | null }
  const nullAds: { ad_id: string; page_id: string }[] = []
  const sample = new Map<string, { name: string; texts: string[] }>()
  let cursor = ''
  const MAX = 30000
  for (;;) {
    let q = admin.from('discovery_ads_index')
      .select('ad_id,page_id,page_name,title,body').is('niche', null)
      .order('ad_id', { ascending: true }).limit(1000)
    if (cursor) q = q.gt('ad_id', cursor)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: false, step: 'scan', error: error.message }, { status: 500 })
    if (!data || !data.length) break
    for (const a of data as Row[]) {
      nullAds.push({ ad_id: a.ad_id, page_id: a.page_id })
      let s = sample.get(a.page_id); if (!s) { s = { name: a.page_name || '', texts: [] }; sample.set(a.page_id, s) }
      if (s.texts.length < 6) { const t = `${a.title || ''} ${a.body || ''}`.replace(/\s+/g, ' ').trim().slice(0, 240); if (t) s.texts.push(t) }
    }
    cursor = (data[data.length - 1] as Row).ad_id
    if (data.length < 1000 || nullAds.length >= MAX) break
  }
  if (!nullAds.length) return NextResponse.json({ ok: true, scanned: 0, classified: 0, inherited: 0, duration_ms: Date.now() - started })

  const pageIds = Array.from(sample.keys())

  // 2. Which of these brands already have a niche on their other ads? → inherit (free).
  const nicheByPage: Record<string, string> = {}
  for (let i = 0; i < pageIds.length; i += 200) {
    const chunk = pageIds.slice(i, i + 200)
    const { data } = await admin.from('discovery_ads_index')
      .select('page_id,niche').in('page_id', chunk).not('niche', 'is', null).limit(1000)
    for (const r of (data || []) as { page_id: string; niche: string }[]) if (!nicheByPage[r.page_id]) nicheByPage[r.page_id] = r.niche
  }
  const inheritedCount = Object.keys(nicheByPage).length

  // 3. Genuinely-new brands (no niche anywhere) → one gpt-4o-mini call each.
  const toClassify = pageIds.filter(pid => !nicheByPage[pid])
  let classifiedCount = 0
  for (let i = 0; i < toClassify.length; i += 6) {
    const batch = toClassify.slice(i, i + 6)
    await Promise.all(batch.map(async pid => {
      const s = sample.get(pid)!
      nicheByPage[pid] = await classifyBrand(s.name, s.texts.join('\n'))
      classifiedCount++
    }))
  }

  // 4. Stamp niche on the unlabelled ads (batched upsert).
  let wrote = 0
  for (let i = 0; i < nullAds.length; i += 500) {
    const batch = nullAds.slice(i, i + 500).map(a => ({ ad_id: a.ad_id, page_id: a.page_id, niche: nicheByPage[a.page_id] || 'Other' }))
    const { error } = await admin.from('discovery_ads_index').upsert(batch, { onConflict: 'ad_id' })
    if (error) return NextResponse.json({ ok: false, step: 'write', wrote, error: error.message }, { status: 500 })
    wrote += batch.length
  }

  return NextResponse.json({ ok: true, scanned: nullAds.length, brands: pageIds.length, inherited: inheritedCount, classified: classifiedCount, wrote, duration_ms: Date.now() - started })
}
