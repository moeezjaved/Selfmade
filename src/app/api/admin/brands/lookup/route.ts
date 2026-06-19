/**
 * Brand Page-ID Lookup — find Facebook page_id from a brand name.
 * Hybrid:
 *   1. Try Meta Graph search (fast, structured)
 *   2. If no high-confidence match, try website scrape
 *   3. Returns top 3 candidates so user can pick
 *
 * GET /api/admin/brands/lookup?name=Gymshark
 * GET /api/admin/brands/lookup?name=Gymshark&website=https://gymshark.com
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Candidate {
  page_id: string
  page_name: string
  follower_count?: number
  picture?: string
  category?: string
  website?: string
  source: 'meta_search' | 'website_scrape' | 'manual'
  confidence: 'high' | 'medium' | 'low'
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

/**
 * Strategy 1 — Meta Graph API search.
 * Returns up to 5 page candidates matching the name.
 */
async function metaSearch(name: string, token: string): Promise<Candidate[]> {
  try {
    const params = new URLSearchParams({
      q: name,
      type: 'page',
      fields: 'id,name,fan_count,picture.type(large),link,category,website,verification_status',
      limit: '5',
      access_token: token,
    })
    const res = await fetch(`https://graph.facebook.com/v19.0/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json() as any
    if (!Array.isArray(data?.data)) return []
    return data.data.map((p: any): Candidate => {
      const nameMatch = p.name?.toLowerCase() === name.toLowerCase()
      const fans = p.fan_count || 0
      const verified = p.verification_status === 'blue_verified' || p.verification_status === 'gray_verified'
      // Confidence heuristic
      let confidence: 'high' | 'medium' | 'low' = 'low'
      if (nameMatch && (verified || fans > 100_000)) confidence = 'high'
      else if (nameMatch || verified || fans > 50_000) confidence = 'medium'
      return {
        page_id: p.id,
        page_name: p.name,
        follower_count: fans,
        picture: p.picture?.data?.url,
        category: p.category,
        website: p.website,
        source: 'meta_search',
        confidence,
      }
    })
  } catch (err) {
    console.warn('Meta search failed:', err)
    return []
  }
}

/**
 * Strategy 2 — scrape brand's website looking for facebook.com link.
 * Then resolve the FB URL to a page_id via Graph API.
 */
async function websiteScrape(website: string, token: string | null): Promise<Candidate[]> {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (!res.ok) return []
    const html = await res.text()
    // Find the first facebook.com link that's not /sharer or /tr
    const match = html.match(/https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]+)(?:\/|"|'|\?|$)/i)
    if (!match) return []
    const slug = match[1]
    if (['sharer', 'tr', 'pages', 'plugins', 'login', 'profile.php'].includes(slug)) return []
    if (!token) {
      return [{
        page_id: slug,
        page_name: slug,
        source: 'website_scrape',
        confidence: 'medium',
      }]
    }
    // Resolve slug → page_id via Graph API
    const params = new URLSearchParams({
      fields: 'id,name,fan_count,picture.type(large),link,category,website',
      access_token: token,
    })
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${slug}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!fbRes.ok) return []
    const p = await fbRes.json() as any
    if (!p?.id) return []
    return [{
      page_id: p.id,
      page_name: p.name || slug,
      follower_count: p.fan_count,
      picture: p.picture?.data?.url,
      category: p.category,
      website: p.website || url,
      source: 'website_scrape',
      confidence: 'high', // came from official site
    }]
  } catch (err) {
    return []
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name')?.trim()
  const website = req.nextUrl.searchParams.get('website')?.trim()
  if (!name && !website) {
    return NextResponse.json({ error: 'name or website required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const token = await getMetaToken(admin)
  if (!token) {
    return NextResponse.json({ error: 'No Meta token available' }, { status: 503 })
  }

  // 1. Meta search (if name provided)
  let candidates: Candidate[] = []
  if (name) {
    candidates = await metaSearch(name, token)
  }

  // 2. Website scrape if no high-confidence match yet
  const hasHigh = candidates.some(c => c.confidence === 'high')
  if (!hasHigh && website) {
    const fromSite = await websiteScrape(website, token)
    candidates = [...fromSite, ...candidates]
  }

  // Dedupe by page_id, keep highest confidence
  const byId = new Map<string, Candidate>()
  for (const c of candidates) {
    const ex = byId.get(c.page_id)
    if (!ex || (c.confidence === 'high' && ex.confidence !== 'high')) {
      byId.set(c.page_id, c)
    }
  }
  const final = Array.from(byId.values())
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      const cmp = order[a.confidence] - order[b.confidence]
      if (cmp !== 0) return cmp
      return (b.follower_count || 0) - (a.follower_count || 0)
    })
    .slice(0, 3)

  return NextResponse.json({
    name,
    website,
    candidates: final,
    best_match: final[0] || null,
    needs_manual: final.length === 0 || final[0].confidence === 'low',
  })
}
