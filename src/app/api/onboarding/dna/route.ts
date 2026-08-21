/**
 * POST /api/onboarding/dna — the DNA Engine's onboarding face.
 * Given the brand + the competitors onboarding already detected, returns the winning-ad DNA,
 * the gap vs the visitor, and a prescription of ads to make. Cached in R2 per competitor-set.
 *
 * SCOPE: wired only into onboarding for now. Auth-gated (a signed-in user during the interview).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runDnaEngine } from '@/lib/dna/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { brandName?: string; competitorPageIds?: string[]; ownPageId?: string | null; niche?: string | null; force?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const competitorPageIds = (body.competitorPageIds || []).filter((s): s is string => typeof s === 'string' && /^\d{5,}$/.test(s)).slice(0, 12)
  if (!competitorPageIds.length && !body.niche) {
    return NextResponse.json({ error: 'need competitorPageIds or niche' }, { status: 400 })
  }

  try {
    const result = await runDnaEngine({
      brandName: (body.brandName || 'your brand').slice(0, 120),
      competitorPageIds,
      ownPageId: body.ownPageId || null,
      niche: body.niche || null,
      force: body.force === true,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: 'DNA engine failed', detail: String(e).slice(0, 200) }, { status: 500 })
  }
}
