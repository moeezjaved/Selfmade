/**
 * GET /api/ads-studio/audiences?domain=… — detected market + AI target audiences for the ads workspace.
 * Crawls the store for hard signals (currency, payment, cities, language) and grounds an LLM on them so
 * the geography is READ off the site, not guessed (this is the "they knew we sell in Pakistan" accuracy).
 */
import { NextRequest, NextResponse } from 'next/server'
import { crawlStore, generateAudiences } from '@/lib/ads-studio/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get('domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return NextResponse.json({ market: '', audiences: [], signals: [] })
  try {
    const ctx = await crawlStore(domain)
    const { market, audiences } = await generateAudiences(ctx)
    return NextResponse.json({ siteName: ctx.siteName, market, audiences, signals: ctx.signals })
  } catch (e: any) {
    return NextResponse.json({ market: '', audiences: [], signals: [], error: String(e?.message || e).slice(0, 160) })
  }
}
