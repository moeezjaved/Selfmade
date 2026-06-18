/**
 * GET /api/cron/disable-dead-terms → auto-pause crawl terms whose page_id is wrong
 * (or the advertiser genuinely has no ads), so they stop being re-crawled every
 * ~15 min and wasting IPRoyal for zero return.
 *
 * Rule: a term that was CRAWLED at least GRACE_HOURS ago and still has 0 ads in the
 * index is dead → set is_active=false. Never-crawled terms are left alone (they
 * deserve a first shot); recently-crawled terms get the grace window in case of a
 * transient gate. Reversible — re-activate via admin → Brands.
 *
 * Auth mirrors /api/indexer. Cheap: one ad-count HEAD per candidate term.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const GRACE_HOURS = 4   // give a crawled brand this long (covers gate-retries) before declaring it dead

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
  const started = Date.now()
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString()

  // Candidate terms: active brands, crawled, past the grace window.
  const { data: terms, error } = await admin.from('discovery_crawl_terms')
    .select('id, term, page_id, last_crawled_at')
    .eq('is_active', true).eq('term_type', 'brand')
    .not('last_crawled_at', 'is', null).lt('last_crawled_at', cutoff)
    .limit(3000)
  if (error) return NextResponse.json({ ok: false, step: 'scan', error: error.message }, { status: 500 })

  const adCount = async (pid: string | null): Promise<number> => {
    if (!pid) return 0
    const { count } = await admin.from('discovery_ads_index')
      .select('ad_id', { count: 'exact', head: true }).eq('page_id', pid)
    return count || 0
  }

  // Find the dead ones (0 ads) — concurrency-limited.
  const candidates = (terms || []) as { id: string; term: string; page_id: string | null }[]
  const dead: { id: string; term: string }[] = []
  let i = 0
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (i < candidates.length) {
      const t = candidates[i++]
      if ((await adCount(t.page_id)) === 0) dead.push({ id: t.id, term: t.term })
    }
  }))

  // Disable them in one update.
  let disabled = 0
  if (dead.length) {
    const ids = dead.map(d => d.id)
    const { error: uerr } = await admin.from('discovery_crawl_terms').update({ is_active: false }).in('id', ids)
    if (uerr) return NextResponse.json({ ok: false, step: 'disable', error: uerr.message }, { status: 500 })
    disabled = dead.length
  }

  return NextResponse.json({
    ok: true, scanned: candidates.length, disabled,
    terms: dead.map(d => d.term).slice(0, 50), duration_ms: Date.now() - started,
  })
}
