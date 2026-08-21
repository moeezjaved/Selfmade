/**
 * GET /api/scan/brands?q=  — PUBLIC brand picker for the /scan audit. Searches the 611K brand_directory
 * by name and returns page_id (the key we audit ads by). No auth: /scan is a top-of-funnel tool.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('brand_directory')
      .select('page_id, name, source_ad_count, industry')
      .ilike('name', `%${q}%`).order('source_ad_count', { ascending: false }).limit(20)
    const rows = (data || []) as { page_id: string; name: string; source_ad_count: number; industry: string | null }[]
    // Prefix matches first, then by ad volume.
    const ql = q.toLowerCase()
    rows.sort((a, b) => (a.name.toLowerCase().startsWith(ql) ? 0 : 1) - (b.name.toLowerCase().startsWith(ql) ? 0 : 1) || (b.source_ad_count || 0) - (a.source_ad_count || 0))
    return NextResponse.json({
      results: rows.map((b) => ({ pageId: b.page_id, name: b.name, adCount: b.source_ad_count || 0, industry: b.industry || null })),
    })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
