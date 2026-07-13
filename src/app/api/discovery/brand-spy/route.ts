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
import { requireUnder } from '@/lib/entitlements'
import { getUserOrg, resolveBillingOwner } from '@/lib/org'
import { logActivity } from '@/lib/activity'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

// All user_ids in the requester's org — spied brands are shared across the org's one workspace.
async function orgMemberIds(admin: any, userId: string): Promise<string[]> {
  try {
    const org = await getUserOrg(admin, userId)
    const { data } = await admin.from('org_members').select('user_id').eq('org_id', org.orgId)
    const ids = new Set<string>([userId, ...((data || []) as any[]).map((m: any) => String(m.user_id))])
    return Array.from(ids)
  } catch { return [userId] }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 20

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
    // "Spied" = the brands the ORG follows (followed_brands across all org members — one shared
    // workspace, so a team member sees every brand the owner/teammates spied, not just their own).
    const ids = await orgMemberIds(admin, user.id)
    // Only SPIED brands belong in Brand Spy (spied=true) — plain ❤️ follows live under Following.
    const { data: follows } = await admin.from('followed_brands').select('page_id').in('user_id', ids).eq('spied', true)
    myPageIds = Array.from(new Set<string>(((follows || []) as any[]).map((f: any) => String(f.page_id)).filter((x: string) => x && x !== 'null')))
    if (myPageIds.length === 0) return NextResponse.json({ brands: [], scope: 'mine' })
  }

  // scope=mine → the user's few spied brands: compute the REAL counts live from the index
  // (total / active / video / image), so the list never shows a stale crawl_state value like the
  // crawler's per-run count (the "27 ads" bug). Cheap: a handful of HEAD count queries per brand.
  if (myPageIds) {
    // Resolve real names across every source (crawl_state → directory → followed_brands → first ad),
    // so the list never shows a bare Meta page_id like "1544270769212882".
    const names = await resolveBrandNames(admin, myPageIds)

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
      const name = names.get(pid) || pid
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

  // scope=all (directory). When SEARCHING, MERGE two sources so the modal shows everything
  // spyable: (1) brands we've ALREADY crawled (discovery_brand_crawl_state — real counts, and
  // re-opening them is instant), and (2) the full 611K brand_directory (uncrawled brands like
  // "MOTION" that a first spy will crawl). Crawled brands rank first (richer data); directory
  // brands fill in the rest. Deduped by page_id. Plus the modal's "Add Manually" tab always
  // covers anything neither source knows (paste the Ad Library URL → POST extracts the page_id).
  if (q) {
    // Brands the org already tracks shouldn't appear in the "spy a NEW brand" modal (and clicking
    // one must never re-charge/re-add). Exclude them from the results.
    const orgIds = await orgMemberIds(admin, user.id)
    const { data: follows } = await admin.from('followed_brands').select('page_id').in('user_id', orgIds).eq('spied', true)
    const already = new Set<string>(((follows || []) as any[]).map((f: any) => String(f.page_id)))

    const [crawledRes, dirRes] = await Promise.all([
      admin.from('discovery_brand_crawl_state')
        .select('page_id, brand_name, ads_indexed, active_count, video_count, image_count, carousel_count')
        .ilike('brand_name', `%${q}%`)
        .order('ads_indexed', { ascending: false, nullsFirst: false })
        .limit(limit),
      admin.from('brand_directory')
        .select('page_id, name, source_ad_count')
        .ilike('name', `%${q}%`)
        .order('source_ad_count', { ascending: false, nullsFirst: false })
        .limit(limit),
    ])

    const seen = new Set<string>(already)   // treat already-tracked as "seen" → excluded
    const merged: any[] = []
    for (const b of (crawledRes.data || []) as any[]) {
      if (!b.page_id || seen.has(b.page_id)) continue
      seen.add(b.page_id)
      const total = b.ads_indexed || 0
      const active = b.active_count ?? null
      merged.push({
        pageId: b.page_id, name: b.brand_name || b.page_id, adCount: total, crawled: true,
        active, inactive: active != null ? Math.max(0, total - active) : null,
        video: b.video_count ?? null, image: b.image_count ?? null, carousel: b.carousel_count ?? null,
      })
    }
    for (const b of (dirRes.data || []) as any[]) {
      if (!b.page_id || seen.has(b.page_id)) continue
      seen.add(b.page_id)
      merged.push({
        pageId: b.page_id, name: b.name || b.page_id, adCount: b.source_ad_count || 0, crawled: false,
        active: null, inactive: null, video: null, image: null, carousel: null,
      })
    }
    if (merged.length) return NextResponse.json({ brands: merged.slice(0, limit) })
    // else fall through (both empty) — the generic crawl_state browse below still returns []
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
// Spying a brand also FOLLOWS it → the alert-worker (runs every ~30 min) sends "new ads"
// notifications for it, and the 6h spy re-crawl keeps its ad set fresh so those alerts fire.
// Idempotent: one follow per (user, brand). Non-fatal — a follow failure never blocks the spy.
async function ensureFollowed(admin: ReturnType<typeof createAdminClient>, userId: string, pageId: string, name: string) {
  try {
    const { data: ex } = await admin.from('followed_brands').select('id').eq('user_id', userId).eq('page_id', pageId).maybeSingle()
    // spied=true marks this as an explicit Brand Spy (vs a plain ❤️ Follow). If a ❤️ follow row
    // already exists, upgrade it to a spy so it appears in the Brand Spy list.
    if (!ex) await admin.from('followed_brands').insert({ user_id: userId, page_id: pageId, brand_name: name, spied: true })
    else await admin.from('followed_brands').update({ spied: true }).eq('id', (ex as any).id)
  } catch { /* non-fatal */ }
}

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

  // Wrap EVERYTHING so a thrown DB error (e.g. a statement timeout under crawl/rollup load) returns
  // JSON, not a Next 500 HTML page — the latter made the modal throw
  // "SyntaxError: Unexpected token 'A', 'A server e'… is not valid JSON" instead of showing the
  // plan-limit / upgrade message.
  try {
    const body = await req.json().catch(() => ({}))
    const pageId = extractPageId(body.url || body.pageId || '')
    if (!pageId) return NextResponse.json({ error: 'Paste a Meta Ad Library page URL (…view_all_page_id=123…) or a numeric page ID — not a keyword search.' }, { status: 400 })
    const name = (body.name || '').trim().toLowerCase() || pageId

    // crawlOnly = "pull this brand's ads into our catalog" WITHOUT tracking/following/charging the user
    // (used when someone opens a directory brand we haven't crawled). Just enqueues the crawl at tier 0
    // (priority 9, last_crawled_at null) — the droplet crawler picks it up next, IPRoyal-safe like all
    // crawls. No plan gate, no credits, no follow. Idempotent.
    if (body.crawlOnly) {
      await ensureTracked(admin, pageId, name, true)
      return NextResponse.json({ pageId, crawlOnly: true })
    }

    // Already SPYING this brand? Re-open is a no-op (refresh the crawl, keep the follow). A plain
    // ❤️ follow (spied=false) is NOT "already spying" — it falls through so the spy upgrades it.
    const { data: prior } = await admin
      .from('followed_brands').select('id')
      .eq('user_id', user.id).eq('page_id', pageId).eq('spied', true).limit(1).maybeSingle()
    if (prior) {
      await ensureTracked(admin, pageId, name, false)
      return NextResponse.json({ pageId, charged: false, alreadySpied: true })
    }

    // Plan gate: cap tracked brands by the plan's brandSpy entitlement. Resolve the ORG's BILLING
    // OWNER so the owner's plan (e.g. Business = 150) applies to every team member. Count org-wide.
    const billingOwner = await resolveBillingOwner(admin, user.id)
    const orgIds = await orgMemberIds(admin, user.id)
    const { count: trackedCount } = await admin
      .from('followed_brands').select('id', { count: 'exact', head: true }).in('user_id', orgIds).eq('spied', true)
    const gate = await requireUnder(admin, billingOwner, 'brandSpy', trackedCount || 0)
    if (gate) return NextResponse.json(gate, { status: 402 })

    // Within the cap → track it (fresh thorough re-crawl) + follow for new-ad alerts. No credits.
    await ensureTracked(admin, pageId, name, true)
    await ensureFollowed(admin, user.id, pageId, name)
    await logActivity(admin, user.id, 'BRAND_SPIED', `Started spying ${name}`)
    return NextResponse.json({ pageId, charged: false })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Something went wrong — please try again.' }, { status: 500 })
  }
}

// Stop spying a brand → remove it from the user's tracked list + stop its new-ad alerts by deleting
// the followed_brands row (the spied list intersects with followed_brands, so this drops it). The
// paid credit_transactions ledger is intentionally left intact so re-spying stays free. We do NOT
// touch discovery_crawl_terms here: it's a GLOBAL crawl row that other users (or the base crawl) may
// still rely on — deactivating it per-user could stop crawling a brand others are tracking.
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = extractPageId(req.nextUrl.searchParams.get('pageId') || req.nextUrl.searchParams.get('page_id') || '')
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('followed_brands').delete().eq('user_id', user.id).eq('page_id', pageId)
  await logActivity(admin, user.id, 'BRAND_UNSPIED', `Stopped spying ${pageId}`)
  return NextResponse.json({ ok: true, pageId })
}
