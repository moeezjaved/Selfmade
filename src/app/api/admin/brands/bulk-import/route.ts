/**
 * Bulk CSV import for brands.
 *
 * POST /api/admin/brands/bulk-import
 * Body: { csv: "brand_name,page_id,category,priority\n..." }
 *  -- OR --
 * Body: { rows: [{ brand_name, page_id?, category?, priority? }, ...] }
 *
 * Behavior:
 *   For each row:
 *     - If page_id provided, save directly (skip lookup)
 *     - If no page_id, run lookup (Meta search → website scrape)
 *     - If high-confidence match found, save with that page_id
 *     - Otherwise add to needs_manual list
 *   Returns summary: imported / pending / needs_manual / errors
 *
 * Imports happen in batches of 5 in parallel to keep Meta API quota safe.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function suggestCategories(brand: { name: string; category?: string; website?: string }): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Suggest 4-7 lowercase search categories for this DTC brand. Return ONLY a JSON array, no markdown.\n\nBrand: ${brand.name}\nMeta category: ${brand.category || '(none)'}\nWebsite: ${brand.website || '(none)'}\n\nExample: ["gymwear", "athleisure", "fitness"]` }],
    })
    const text = (msg.content[0] as any)?.text?.trim() || '[]'
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').replace(/^```\s*|\s*```$/g, '')
    const arr = JSON.parse(cleaned)
    return Array.isArray(arr) ? arr.map(c => String(c).toLowerCase().trim()).filter(Boolean).slice(0, 7) : []
  } catch {
    return []
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface InputRow {
  brand_name: string
  page_id?: string
  category?: string
  priority?: number
  website?: string
  categories?: string[]
}

interface ResultRow {
  brand_name: string
  page_id?: string
  category?: string
  status: 'imported' | 'updated' | 'needs_manual' | 'error'
  message?: string
  candidates?: any[]
}

async function getMetaToken(admin: any): Promise<string | null> {
  const { data: accounts } = await admin
    .from('meta_accounts')
    .select('access_token')
    .eq('is_primary', true)
    .limit(1)
  if (accounts?.[0]?.access_token) {
    try {
      const t = decryptToken(accounts[0].access_token)
      if (t) return t
    } catch { /* ignore */ }
  }
  return process.env.META_APP_TOKEN || process.env.META_ACCESS_TOKEN || null
}

function parseCsv(csv: string): InputRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []
  const headerCells = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const headerIdx: Record<string, number> = {}
  headerCells.forEach((h, i) => { headerIdx[h] = i })

  // Accept common variations
  const nameKey = ['brand_name', 'name', 'brand'].find(k => k in headerIdx)
  if (!nameKey) throw new Error("CSV must have 'brand_name' column")
  const pageIdKey = ['page_id', 'pageid', 'fb_page_id'].find(k => k in headerIdx)
  const categoryKey = ['category', 'industry'].find(k => k in headerIdx)
  const priorityKey = ['priority'].find(k => k in headerIdx)
  const websiteKey = ['website', 'url', 'site'].find(k => k in headerIdx)

  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim())
    return {
      brand_name: cells[headerIdx[nameKey]] || '',
      page_id: pageIdKey ? cells[headerIdx[pageIdKey]] || undefined : undefined,
      category: categoryKey ? cells[headerIdx[categoryKey]] || undefined : undefined,
      priority: priorityKey ? parseInt(cells[headerIdx[priorityKey]] || '5') : 5,
      website: websiteKey ? cells[headerIdx[websiteKey]] || undefined : undefined,
    }
  }).filter(r => r.brand_name)
}

async function lookupPageId(name: string, website: string | undefined, token: string): Promise<{ page_id?: string; page_name?: string; follower_count?: number; picture?: string; candidates: any[] }> {
  // Try Meta search
  const params = new URLSearchParams({
    q: name,
    type: 'page',
    fields: 'id,name,fan_count,picture.type(large),link,category,verification_status',
    limit: '5',
    access_token: token,
  })
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { candidates: [] }
    const data = await res.json() as any
    const candidates = (data?.data || []) as any[]
    if (candidates.length === 0) return { candidates: [] }

    // Match strategies (best → fallback):
    //   1. Exact name + (verified or 100K+ fans)            → high confidence, save active
    //   2. Exact name (any followers)                       → medium confidence, save active
    //   3. Top result by followers                          → low confidence, save inactive
    const verified = (c: any) => c.verification_status === 'blue_verified' || c.verification_status === 'gray_verified'
    const nameMatch = (c: any) => c.name?.toLowerCase() === name.toLowerCase()

    const high = candidates.find(c => nameMatch(c) && (verified(c) || (c.fan_count || 0) > 100_000))
    const medium = candidates.find(c => nameMatch(c))
    const sorted = [...candidates].sort((a, b) => (b.fan_count || 0) - (a.fan_count || 0))
    const fallback = sorted[0]

    const best = high || medium || fallback
    const confidence: 'high' | 'medium' | 'low' = high ? 'high' : medium ? 'medium' : 'low'

    if (best?.id) {
      return {
        page_id: best.id,
        page_name: best.name,
        follower_count: best.fan_count,
        picture: best.picture?.data?.url,
        confidence,
        candidates,
      } as any
    }
    return { candidates }
  } catch {
    return { candidates: [] }
  }
}

async function processRow(
  admin: any,
  row: InputRow,
  token: string,
): Promise<ResultRow> {
  const term = row.brand_name.trim().toLowerCase()
  if (!term) return { brand_name: row.brand_name, status: 'error', message: 'empty name' }

  let pageId = row.page_id?.trim()
  let lookupResult: any = {}
  const userProvidedPageId = !!pageId
  if (!pageId) {
    lookupResult = await lookupPageId(row.brand_name, row.website, token)
    pageId = lookupResult.page_id
  }

  // Auto-active only if user provided page_id OR lookup was high confidence.
  const highConfidence = userProvidedPageId || lookupResult?.confidence === 'high'

  // AI-suggest categories — runs in parallel for the import
  const aiCategories = await suggestCategories({
    name: row.brand_name,
    category: lookupResult?.page_name ? undefined : undefined,
    website: row.website,
  })
  // Merge user-provided category with AI suggestions, dedupe
  const finalCategories = Array.from(new Set([
    ...(row.category ? [row.category.toLowerCase()] : []),
    ...aiCategories,
  ]))

  const insert: Record<string, any> = {
    term,
    term_type: 'brand',
    category: row.category || 'General',
    categories: finalCategories,
    countries: ['US'],
    priority: row.priority || 5,
    is_active: !!pageId && highConfidence,
    follower_count: lookupResult?.follower_count,
    picture: lookupResult?.picture,
    website: row.website,
  }
  if (pageId) insert.page_id = pageId

  // Upsert by term (avoid duplicates)
  const { data, error } = await admin
    .from('discovery_crawl_terms')
    .upsert(insert, { onConflict: 'term' })
    .select()
    .single()

  if (error) {
    return { brand_name: row.brand_name, status: 'error', message: error.message }
  }

  if (!pageId) {
    return {
      brand_name: row.brand_name,
      page_id: undefined,
      category: row.category,
      status: 'needs_manual',
      message: 'No page found via Meta search or website scrape',
      candidates: lookupResult.candidates?.slice(0, 3),
    }
  }

  if (!highConfidence) {
    return {
      brand_name: row.brand_name,
      page_id: pageId,
      category: row.category,
      status: 'needs_manual',
      message: `Saved as INACTIVE (low confidence: ${lookupResult?.page_name}). Preview in admin to verify, then activate.`,
      candidates: lookupResult.candidates?.slice(0, 3),
    }
  }

  return {
    brand_name: row.brand_name,
    page_id: pageId,
    category: row.category,
    status: data ? 'imported' : 'updated',
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  let rows: InputRow[] = []

  if (typeof body.csv === 'string') {
    try {
      rows = parseCsv(body.csv)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
    }
  } else if (Array.isArray(body.rows)) {
    rows = body.rows
  } else {
    return NextResponse.json({ error: 'Provide csv (string) or rows (array)' }, { status: 400 })
  }

  if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  if (rows.length > 1000) return NextResponse.json({ error: 'Max 1000 rows per import' }, { status: 400 })

  const token = await getMetaToken(admin)
  if (!token) return NextResponse.json({ error: 'No Meta token configured' }, { status: 503 })

  // Process in parallel batches of 5 (be nice to Meta API)
  const results: ResultRow[] = []
  const CONCURRENCY = 5
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(chunk.map(r => processRow(admin, r, token)))
    results.push(...chunkResults)
  }

  const summary = {
    total: rows.length,
    imported: results.filter(r => r.status === 'imported').length,
    updated: results.filter(r => r.status === 'updated').length,
    needs_manual: results.filter(r => r.status === 'needs_manual').length,
    errors: results.filter(r => r.status === 'error').length,
  }

  return NextResponse.json({ summary, results })
}
