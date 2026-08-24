/**
 * GET /api/ads-studio/products?domain=… — the store's real catalog (crawled from the site) for the
 * ads workspace Products screen. Returns product cards (title, image, price, url).
 */
import { NextRequest, NextResponse } from 'next/server'
import { crawlStore } from '@/lib/ads-studio/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get('domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return NextResponse.json({ products: [], siteName: '' })
  try {
    const ctx = await crawlStore(domain)
    return NextResponse.json({ siteName: ctx.siteName, products: ctx.products })
  } catch (e: any) {
    return NextResponse.json({ products: [], error: String(e?.message || e).slice(0, 160) })
  }
}
