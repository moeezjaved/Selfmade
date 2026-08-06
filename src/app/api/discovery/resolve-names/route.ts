/**
 * POST /api/discovery/resolve-names { pageIds: string[] } → { names: { [pageId]: realName } }
 * Turns raw Facebook page ids (e.g. from a pasted Meta Ad Library link) into the real brand name using
 * our index (brand_directory / crawl page_name). Powers onboarding so a competitor added by id shows its
 * name — not "Facebook page 244668702070242" — everywhere it's persisted (follow, brand-spy, report).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageIds } = await req.json().catch(() => ({ pageIds: [] }))
  const ids = Array.isArray(pageIds) ? pageIds.map((x: any) => String(x || '')).filter(Boolean).slice(0, 25) : []
  if (!ids.length) return NextResponse.json({ names: {} })
  try {
    const admin = createAdminClient()
    const map = await resolveBrandNames(admin, ids)
    const names: Record<string, string> = {}
    map.forEach((v, k) => { if (v) names[k] = v })
    return NextResponse.json({ names })
  } catch { return NextResponse.json({ names: {} }) }
}
