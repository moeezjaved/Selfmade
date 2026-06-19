/**
 * Add brand from Meta Ads Library URL.
 *
 * POST /api/admin/brands/from-url
 * Body: { url: "https://www.facebook.com/ads/library/?...view_all_page_id=355136938262536..." }
 *  OR  : { url: "https://www.facebook.com/forhims" }       — slug form
 *  OR  : { url: "355136938262536" }                        — raw page_id
 *
 * Returns: brand info + suggested categories (Claude AI), without saving anywhere.
 * User reviews then clicks "Add" which calls the existing POST /api/admin/brands.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { llm } from '@/lib/llm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const anthropic = llm

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

/**
 * Extract page_id from various URL formats:
 *   https://www.facebook.com/ads/library/?...view_all_page_id=12345...
 *   https://www.facebook.com/12345
 *   https://www.facebook.com/somebrand
 *   12345 (raw ID)
 */
function parseInput(input: string): { page_id?: string; slug?: string } {
  const trimmed = input.trim()
  if (!trimmed) return {}

  // Raw numeric id
  if (/^\d+$/.test(trimmed)) return { page_id: trimmed }

  // view_all_page_id query param
  const m1 = trimmed.match(/view_all_page_id=(\d+)/)
  if (m1) return { page_id: m1[1] }

  // facebook.com/12345
  const m2 = trimmed.match(/facebook\.com\/(\d+)(?:\/|\?|$)/)
  if (m2) return { page_id: m2[1] }

  // facebook.com/slug or facebook.com/somebrand
  const m3 = trimmed.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:\/|\?|$)/)
  if (m3 && !['ads', 'sharer', 'pages', 'plugins'].includes(m3[1])) {
    return { slug: m3[1] }
  }

  return {}
}

async function fetchPageInfo(idOrSlug: string, token: string): Promise<any> {
  // Try full fields first, fall back to basic fields if API rejects (some
  // pages restrict metadata access)
  const fullFields = 'id,name,fan_count,picture.type(large),link,category,verification_status,website,about,description'
  const basicFields = 'id,name,picture.type(large)'

  for (const fields of [fullFields, basicFields]) {
    const params = new URLSearchParams({ fields, access_token: token })
    const res = await fetch(`https://graph.facebook.com/v19.0/${idOrSlug}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return await res.json()
    // Continue to next attempt with fewer fields
  }
  return null
}

/**
 * Use Claude to suggest 4-7 search categories for this brand.
 * Categories should be lowercase, single-word or short phrases that users
 * are likely to search (e.g. "gymwear", "skincare", "protein powder").
 */
async function suggestCategories(brand: { name: string; category?: string; website?: string; about?: string }): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return []

  const prompt = `You are categorizing a DTC brand for a search engine.

Brand: ${brand.name}
Meta category: ${brand.category || '(none)'}
Website: ${brand.website || '(none)'}
About: ${(brand.about || '').slice(0, 500)}

Suggest 4-7 lowercase search categories that users would type to find this brand's ads.

Examples:
  - Gymshark → ["gymwear", "athleisure", "fitness", "activewear", "workout clothes"]
  - Hims → ["hair growth", "mens health", "ed treatment", "skincare for men"]
  - Casper → ["mattress", "bedding", "sleep"]
  - Nike → ["sneakers", "sportswear", "running", "athletic wear"]
  - Glossier → ["skincare", "makeup", "beauty"]

Return ONLY a JSON array of strings. No prose, no markdown, no code fences.

Example output: ["gymwear", "athleisure", "fitness"]`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (msg.content[0] as any)?.text?.trim() || '[]'
    // Strip code fences if Claude added them
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').replace(/^```\s*|\s*```$/g, '')
    const arr = JSON.parse(cleaned)
    if (!Array.isArray(arr)) return []
    return arr
      .map(c => String(c).toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 7)
  } catch (err) {
    console.warn('Category suggestion failed:', err)
    return []
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const url = body.url?.trim()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const parsed = parseInput(url)
  if (!parsed.page_id && !parsed.slug) {
    return NextResponse.json({ error: 'Could not extract page_id from URL. Use a Meta Ads Library URL or facebook.com/brand link.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const token = await getMetaToken(admin)
  if (!token) return NextResponse.json({ error: 'No Meta token configured' }, { status: 503 })

  const idOrSlug = parsed.page_id || parsed.slug!
  const page = await fetchPageInfo(idOrSlug, token)

  // If Meta won't return metadata BUT we have a numeric page_id from the
  // URL, allow user to add it anyway (they'll verify via Preview later)
  if (!page?.id) {
    if (parsed.page_id) {
      return NextResponse.json({
        page_id: parsed.page_id,
        name: `Brand ${parsed.page_id}`,
        follower_count: null,
        picture: null,
        category: null,
        verified: false,
        website: null,
        about: null,
        link: null,
        suggested_categories: [],
        warning: 'Meta did not return brand metadata (private/restricted page). The page_id is extracted — click Preview after adding to verify it has real ads.',
      })
    }
    return NextResponse.json({ error: `Could not fetch page info for "${idOrSlug}". Page may not exist, be private, or token lacks access.` }, { status: 404 })
  }

  // Suggest categories via Claude (in parallel — non-blocking)
  const suggestedCategories = await suggestCategories({
    name: page.name,
    category: page.category,
    website: page.website,
    about: page.about || page.description,
  })

  return NextResponse.json({
    page_id: page.id,
    name: page.name,
    follower_count: page.fan_count,
    picture: page.picture?.data?.url,
    category: page.category,
    verified: page.verification_status === 'blue_verified' || page.verification_status === 'gray_verified',
    website: page.website,
    about: page.about,
    link: page.link,
    suggested_categories: suggestedCategories,
  })
}
