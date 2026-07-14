/**
 * Search cache-warmer. Cold keyword searches are slow on this storage tier (~7s) because the copy
 * arm de-TOASTs search_vector from disk; once those pages are in Postgres' shared_buffers the SAME
 * search is ~130ms. The crawl+drain write load steadily evicts them, so this cron re-runs the most
 * common niche searches every few minutes to keep their index+heap pages hot for real users.
 *
 * It calls search_ads_v2 directly (same function the app uses) with the same tag expansion the route
 * builds, so it warms exactly the pages a user search will touch. Best-effort; failures are ignored.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { expandQuery } from '@/lib/search/concepts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// The head of the search distribution — niches + the concept-map keys users actually type.
const TERMS = [
  'skin care', 'hair loss', 'hair fall', 'weight loss', 'men health', 'eye cream', 'face serum',
  'collagen', 'protein powder', 'activewear', 'leggings', 'supplements', 'testosterone', 'sleep',
  'gut health', 'anti aging', 'moisturizer', 'sunscreen', 'vitamins', 'pre workout', 'creatine',
  'shampoo', 'perfume', 'jewelry', 'sunglasses', 'pet food', 'dog supplements', 'baby care',
  'meal replacement', 'greens powder',
]

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  let warmed = 0
  // Sequential (not parallel) — the point is to keep pages resident without spiking write-contended I/O.
  for (const q of TERMS) {
    const lc = q.toLowerCase()
    const exp = expandQuery(q)
    const tags = Array.from(new Set([lc, lc.replace(/\s+/g, ''), ...Array.from(exp.synonymTags), ...Array.from(exp.relatedTags)].filter(Boolean)))
    try {
      const { error } = await admin.rpc('search_ads_v2', { p_q: lc, p_tags: tags, p_sort: 'recommended', p_lim: 120, p_off: 0 })
      if (!error) warmed++
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true, warmed, total: TERMS.length })
}
