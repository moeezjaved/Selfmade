/**
 * GET /api/cron/enrich-categories → AI-expand search categories for brands that
 * have thin (≤1) categories, OUT of the import path (which timed out calling OpenAI
 * for 700 brands at once). Updates the crawl term's `categories` AND stamps the
 * merged set onto the brand's ads' `brand_categories` so search finds them.
 *
 * Bounded per run; runs daily. Auth mirrors /api/indexer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isCrawlPaused } from '@/lib/discovery/pause'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))
const MAX_BRANDS = 120  // per run

const SCHEMA = {
  name: 'categories', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['categories'], properties: { categories: { type: 'array', items: { type: 'string' }, description: '4-7 lowercase search categories a buyer would use to find this brand (product types, niche, use-cases)' } } },
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

async function suggest(name: string, category?: string): Promise<string[]> {
  try {
    const r = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [{ role: 'user', content: `Suggest 4-7 lowercase search categories for this DTC brand (product types, niche, use-cases buyers search).\n\nBrand: ${name}\nKnown category: ${category || '(none)'}` }],
    })
    const arr = JSON.parse(r.choices[0]?.message?.content || '{}').categories
    return Array.isArray(arr) ? arr.map((s: string) => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 7) : []
  } catch { return [] }
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (await isCrawlPaused(admin)) return NextResponse.json({ ok: true, skipped: 'crawl_paused' })
  const started = Date.now()

  const { data: terms, error } = await admin.from('discovery_crawl_terms')
    .select('id, term, page_id, category, categories').eq('term_type', 'brand').limit(3000)
  if (error) return NextResponse.json({ ok: false, step: 'scan', error: error.message }, { status: 500 })

  // Thin = 0 or 1 category. Bounded per run.
  const thin = (terms || [] as any[])
    .filter((t: any) => !t.categories || t.categories.length <= 1)
    .slice(0, MAX_BRANDS) as { id: string; term: string; page_id: string | null; category: string | null; categories: string[] | null }[]
  if (!thin.length) return NextResponse.json({ ok: true, enriched: 0, duration_ms: Date.now() - started })

  let i = 0, enriched = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < thin.length) {
      const t = thin[i++]
      const ai = await suggest(t.term, t.category || undefined)
      const merged = Array.from(new Set([...(t.categories || []).map(c => c.toLowerCase()), ...(t.category ? [t.category.toLowerCase()] : []), ...ai]))
      if (merged.length <= (t.categories?.length || 0)) continue
      await admin.from('discovery_crawl_terms').update({ categories: merged }).eq('id', t.id)
      // stamp onto the brand's ads so search matches them
      if (t.page_id) await admin.from('discovery_ads_index').update({ brand_categories: merged }).eq('page_id', t.page_id)
      enriched++
    }
  }))

  return NextResponse.json({ ok: true, scanned: thin.length, enriched, duration_ms: Date.now() - started })
}
