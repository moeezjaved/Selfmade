/**
 * Brand Spy list + track.
 *
 * GET  /api/discovery/brand-spy?q=          → fast brand directory (reads the per-brand
 *      summary discovery_brand_crawl_state — one row per brand — instead of aggregating the
 *      1.4M-row discovery_ads_index, which made the page hang).
 *
 * POST /api/discovery/brand-spy  { url|pageId, name? }  → start spying on a NEW brand:
 *      extract the page_id from a Meta Ad Library URL, charge `brand_spy` credits, and add
 *      it to the crawl queue (discovery_crawl_terms). Already-tracked brands are free.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { reserveCredits, commitCredits, refundCredits, getActionCost, InsufficientCreditsError } from '@/lib/credits'
import { requireUnder } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'
export const maxDuration = 20
const ACTION = 'brand_spy'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  // scope=mine (default) → only THIS user's spied brands (the tracked list). scope=all →
  // the full directory (used by the add-modal's search to find new brands to spy).
  const scope = req.nextUrl.searchParams.get('scope') || 'mine'
  const limit = q ? 60 : 200

  let myPageIds: string[] | null = null
  if (scope === 'mine') {
    const { data: txs } = await admin
      .from('credit_transactions')
      .select('reference_id')
      .eq('user_id', user.id).eq('action_type', ACTION).eq('status', 'committed')
    myPageIds = Array.from(new Set((txs || []).map((t: any) => t.reference_id).filter(Boolean)))
    if (myPageIds.length === 0) return NextResponse.json({ brands: [], scope: 'mine' })
  }

  // scope=mine → the user's few spied brands: compute the REAL counts live from the index
  // (total / active / video / image), so the list never shows a stale crawl_state value like the
  // crawler's per-run count (the "27 ads" bug). Cheap: a handful of HEAD count queries per brand.
  if (myPageIds) {
    const names = new Map<string, string>()
    const { data: st } = await admin.from('discovery_brand_crawl_state').select('page_id, brand_name').in('page_id', myPageIds)
    for (const r of (st || []) as any[]) if (r.brand_name) names.set(r.page_id, r.brand_name)

    const cnt = (pid: string, extra?: (q: any) => any) => {
      let qq = admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pid)
      if (extra) qq = extra(qq)
      return qq.then((r: any) => r.count || 0)
    }
    const brands = await Promise.all(myPageIds.map(async (pid) => {
      const [total, active, video, image] = await Promise.all([
        cnt(pid),
        cnt(pid, (q) => q.eq('is_active', true)),
        cnt(pid, (q) => q.ilike('format', '%video%')),
        cnt(pid, (q) => q.ilike('format', '%image%')),
      ])
      // Fall back to an ad's page_name if crawl_state has no brand_name yet.
      let name = names.get(pid)
      if (!name) {
        const { data: one } = await admin.from('discovery_ads_index').select('page_name').eq('page_id', pid).not('page_name', 'is', null).limit(1).maybeSingle()
        name = (one as any)?.page_name || pid
      }
      return {
        pageId: pid, name: name || pid, adCount: total,
        active, inactive: Math.max(0, total - active),
        video, image, carousel: Math.max(0, total - video - image),
      }
    }))
    brands.sort((a, b) => b.adCount - a.adCount)
    const filtered = q ? brands.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())) : brands
    return NextResponse.json({ brands: filtered, scope: 'mine' })
  }

  // scope=all (directory). When SEARCHING, try the full 611K brand_directory first so uncrawled
  // brands (e.g. "MOTION") are findable+spyable — crawl_state only holds brands we've already
  // crawled. Falls back to crawl_state if the directory is empty (not yet imported) or errors.
  if (q) {
    const { data: dir, error: dirErr } = await admin
      .from('brand_directory')
      .select('page_id, name, source_ad_count')
      .ilike('name', `%${q}%`)
      .order('source_ad_count', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (!dirErr && dir && dir.length) {
      return NextResponse.json({
        brands: dir.map((b: any) => ({
          pageId: b.page_id, name: b.name || b.page_id, adCount: b.source_ad_count || 0,
          active: null, inactive: null, video: null, image: null, carousel: null,
        })),
      })
    }
    // else fall through to the crawl_state search below
  }

  // fast crawl_state read (approximate counts; used by the add-modal + as directory fallback).
  const build = (cols: string) => {
    let qq = admin.from('discovery_brand_crawl_state').select(cols).order('ads_indexed', { ascending: false, nullsFirst: false }).limit(limit)
    // When SEARCHING a specific brand, show name matches even if ads_indexed is 0/stale (e.g. "hims"
    // had ads in the index but a 0 summary count → it was invisible). Spying re-crawls + fixes the count.
    // For BROWSE (no query), keep the >0 filter so junk brands don't fill the directory.
    if (q) qq = qq.ilike('brand_name', `%${q}%`)
    else qq = qq.gt('ads_indexed', 0)
    return qq
  }
  let { data, error } = await build('page_id, brand_name, ads_indexed, active_count, video_count, image_count, carousel_count')
  if (error) ({ data, error } = await build('page_id, brand_name, ads_indexed'))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const brands = (data || []).map((b: any) => {
    const total = b.ads_indexed || 0
    const active = b.active_count ?? null
    return {
      pageId: b.page_id, name: b.brand_name || b.page_id, adCount: total,
      active, inactive: active != null ? Math.max(0, total - active) : null,
      video: b.video_count ?? null, image: b.image_count ?? null, carousel: b.carousel_count ?? null,
    }
  })
  return NextResponse.json({ brands })
}

const extractPageId = (s: string): string | null => {
  const t = (s || '').trim()
  if (/^\d+$/.test(t)) return t
  const m = t.match(/view_all_page_id=(\d+)/) || t.match(/\/(\d{6,})(?:\/|\?|$)/)
  return m ? m[1] : null
}

const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'MX', 'BR', 'IN', 'JP', 'SG', 'AE', 'ZA']

// Add the brand to the crawl queue if missing, reactivate if deactivated, and (when
// forceFresh) reset last_crawled_at so it re-crawls as top priority — a paid spy should
// pull current, complete data, not whatever stale snapshot we happen to have.
async function ensureTracked(admin: ReturnType<typeof createAdminClient>, pageId: string, name: string, forceFresh: boolean) {
  const { data: ex } = await admin.from('discovery_crawl_terms').select('page_id, is_active').eq('page_id', pageId).maybeSingle()
  if (ex) {
    const upd: Record<string, any> = {}
    if (ex.is_active === false) upd.is_active = true
    if (forceFresh) { upd.last_crawled_at = null; upd.priority = 9 }   // priority 9 → crawler does a FULL archive crawl
    if (Object.keys(upd).length) await admin.from('discovery_crawl_terms').update(upd).eq('page_id', pageId)
  } else {
    await admin.from('discovery_crawl_terms').insert({ term: name, page_id: pageId, term_type: 'brand', category: 'General', is_active: true, priority: 9, last_crawled_at: null, countries: COUNTRIES })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const body = await req.json().catch(() => ({}))
  const pageId = extractPageId(body.url || body.pageId || '')
  if (!pageId) return NextResponse.json({ error: 'Paste a Meta Ad Library page URL (…view_all_page_id=123…) or a numeric page ID — not a keyword search.' }, { status: 400 })
  const name = (body.name || '').trim().toLowerCase() || pageId

  // Has THIS user already paid to spy THIS brand? (credit_transactions ledger, ref = pageId).
  // If so it's free to re-open — we charge once per user per brand, not per click.
  const { data: prior } = await admin
    .from('credit_transactions')
    .select('id')
    .eq('user_id', user.id).eq('action_type', ACTION).eq('reference_id', pageId).eq('status', 'committed')
    .limit(1).maybeSingle()
  if (prior) {
    await ensureTracked(admin, pageId, name, false)
    return NextResponse.json({ pageId, charged: false, alreadySpied: true })
  }

  // Plan gate (spec §4.2): cap the number of tracked brands by the plan's brandSpy entitlement.
  const { data: tracked } = await admin
    .from('credit_transactions').select('reference_id')
    .eq('user_id', user.id).eq('action_type', ACTION).eq('status', 'committed')
  const trackedCount = new Set((tracked || []).map((t: any) => t.reference_id).filter(Boolean)).size
  const gate = await requireUnder(admin, user.id, 'brandSpy', trackedCount)
  if (gate) return NextResponse.json(gate, { status: 402 })

  // First time this user spies this brand (directory OR manual) → charge, queue a fresh
  // thorough re-crawl, commit. Reserve→commit→refund on failure.
  const cost = await getActionCost(admin, ACTION)
  let txId: string | null = null
  try {
    if (cost && cost > 0) { const tx = await reserveCredits(admin, user.id, ACTION, pageId); txId = tx.id }
    await ensureTracked(admin, pageId, name, true)
    if (txId) await commitCredits(admin, txId, { page_id: pageId })
    return NextResponse.json({ pageId, charged: !!txId, cost: cost || 0 })
  } catch (e) {
    if (txId) await refundCredits(admin, txId).catch(() => {})
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: `Not enough credits — Brand Spy costs ${e.need}, you have ${e.have}.` }, { status: 402 })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to start spying' }, { status: 400 })
  }
}
