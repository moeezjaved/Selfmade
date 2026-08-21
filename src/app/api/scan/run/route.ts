/**
 * POST /api/scan/run — PUBLIC ad audit (no login). This is an AUDIT of YOUR ads first; spying on rivals
 * is one part of it. Input: { pageId } (your brand, from the picker) or { adLibraryUrl } (your Meta Ad
 * Library link). We resolve your page, read YOUR ads (ownDna), pull same-niche rivals from the 611K
 * directory, and run the DNA engine (winners + gaps + score + prescriptions). Best-effort IP rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runDnaEngine } from '@/lib/dna/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Best-effort in-memory IP limiter (no Redis in this stack). Per warm instance; fine for a top-of-funnel
// audit — abuse is bounded and the heavy spend (LLM) is cached in R2 by the engine anyway.
const HITS = new Map<string, { n: number; t: number }>()
const WINDOW = 3600_000, MAX = 30
function limited(ip: string): boolean {
  const now = Date.now(); const h = HITS.get(ip)
  if (!h || now - h.t > WINDOW) { HITS.set(ip, { n: 1, t: now }); return false }
  h.n++; return h.n > MAX
}

// Pull a Meta page id out of an Ad Library link (view_all_page_id=… / page_id=… / …/<id>) or a bare id.
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  if (m) return m[1]
  if (/^\d{7,}$/.test(t)) return t
  return null
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon'
  if (limited(ip)) return NextResponse.json({ error: 'Too many scans — try again in a bit.' }, { status: 429 })

  let body: { pageId?: string; adLibraryUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const pageId = (body.pageId && /^\d{5,}$/.test(body.pageId)) ? body.pageId : extractPageId(body.adLibraryUrl || '')
  if (!pageId) return NextResponse.json({ error: 'Pick your brand or paste your Meta Ad Library link.' }, { status: 400 })

  try {
    const admin = createAdminClient()
    // Resolve the brand + its niche (for competitor selection + the engine's niche fallback).
    const { data: brand } = await admin.from('brand_directory').select('name, industry').eq('page_id', pageId).maybeSingle()
    const brandName = (brand?.name as string) || 'your brand'
    const niche = (brand?.industry as string) || null

    // Rivals = the highest-volume OTHER brands in the same niche (they're the ones running the most ads).
    let competitorPageIds: string[] = []
    if (niche) {
      const { data: rivals } = await admin.from('brand_directory')
        .select('page_id').eq('industry', niche).neq('page_id', pageId)
        .gt('source_ad_count', 0).order('source_ad_count', { ascending: false }).limit(10)
      competitorPageIds = (rivals || []).map((r: any) => String(r.page_id))
    }

    const result = await runDnaEngine({ brandName, competitorPageIds, ownPageId: pageId, niche })
    return NextResponse.json({ brand: { pageId, name: brandName, niche }, competitors: competitorPageIds.length, ...result })
  } catch (e) {
    return NextResponse.json({ error: 'Scan failed', detail: String(e).slice(0, 200) }, { status: 500 })
  }
}
