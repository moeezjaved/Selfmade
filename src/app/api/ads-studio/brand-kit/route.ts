/**
 * GET /api/ads-studio/brand-kit?domain=… — derives the whole Brand Kit from the WEBSITE alone
 * (no Shopify needed): logo, brand colors + typefaces from the real CSS, a Knowledge Base of atomic
 * facts, and brand voice — the same pattern Lapis uses. Feeds ad-generation decisions.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildBrandKit } from '@/lib/ads-studio/brandkit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get('domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return NextResponse.json({ empty: true })
  try {
    return NextResponse.json(await buildBrandKit(domain))
  } catch (e: any) {
    return NextResponse.json({ empty: true, error: String(e?.message || e).slice(0, 160) })
  }
}
