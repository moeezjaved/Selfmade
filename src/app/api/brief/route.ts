/**
 * Morning Brief — "I worked while you were sleeping."
 * GET  → assembles the personalized brief for the signed-in user, heaviest news first.
 *        Sources (all fail-soft — a slow/broken source just drops its item, never 500s the brief):
 *          1. brief_events rows (the spine — mig 108; workers will write here over time)
 *          2. competitor drops     ← notifications (type new_ad) from the alert worker
 *          3. creatives ready      ← creative_generations in the last 36h (incl. autopilot output)
 *          4. market trend         ← top topics among the freshest ads in the niches the user watches
 *          5. global counters      ← ads indexed in the last 24h (Mello's "overnight work")
 * PATCH → { id } marks a brief_events row acted_on (CTA clicked).
 *
 * The Brief is a RENDERING layer: it never writes domain data, so it can't corrupt anything and it
 * stays fast (every query is small + index-backed; dai created_at is indexed — dai_created_at_idx).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

// The alert-worker sometimes stores a page_id (or nothing) as brand_name → resolve to a real name at
// read time so the brief says "Country Delight" not "1544270769212882". All-digits counts as blank.
const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type BriefItem = {
  id?: string                 // brief_events id (only spine rows — enables acted_on)
  kind: string                // competitor_ads | creative_ready | trend | insight | system
  importance: number          // 0-100
  title: string               // Mello-voiced one-liner
  body?: string               // the evidence (expanded state)
  why?: string                // "why you care" — every card must answer it
  cta_label?: string
  cta_href?: string
  thumbs?: string[]           // small image urls for a visual row
  at?: string                 // ISO timestamp of the underlying event
}

const soft = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p } catch { return fallback } }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  // First name for the greeting — metadata full_name, else the email local-part. Never a wrong guess.
  const rawName = String((user.user_metadata as any)?.full_name || (user.user_metadata as any)?.name || '').trim()
  const firstName = rawName ? rawName.split(/\s+/)[0] : (user.email ? user.email.split('@')[0].replace(/[._-].*$/, '') : '')
  const items: BriefItem[] = []
  const H48 = new Date(Date.now() - 48 * 3600e3).toISOString()
  const H36 = new Date(Date.now() - 36 * 3600e3).toISOString()
  const H24 = new Date(Date.now() - 24 * 3600e3).toISOString()
  const D7 = new Date(Date.now() - 7 * 86400e3).toISOString()

  // Fire everything in parallel; each source degrades to "absent", never breaks the brief.
  const [spine, notifs, creatives, follows, adsScanned, observations] = await Promise.all([
    // 1. Spine rows (mig 108) — the durable event feed workers write into.
    soft<any[]>(admin.from('brief_events').select('id, kind, importance, title, body, cta_label, cta_href, payload, created_at')
      .eq('user_id', user.id).gte('created_at', H48).order('importance', { ascending: false }).limit(20)
      .then((r: any) => r.data || []), []),
    // 2. Competitor new-ad alerts (alert worker → notifications).
    soft<any[]>(admin.from('notifications').select('id, brand_name, page_id, ad_count, sample_ad_id, created_at')
      .eq('user_id', user.id).eq('type', 'new_ad').gte('created_at', H48).order('created_at', { ascending: false }).limit(8)
      .then((r: any) => r.data || []), []),
    // 3. Fresh creatives (manual clones, edits, autopilot output all land in creative_generations).
    soft<any[]>(admin.from('creative_generations').select('id, image_url, type, created_at')
      .eq('user_id', user.id).gte('created_at', H36).order('created_at', { ascending: false }).limit(6)
      .then((r: any) => r.data || []), []),
    // 4. What the user watches (spied + followed) — powers the trend item + the "watching N" stat.
    soft<any[]>(admin.from('followed_brands').select('page_id, brand_name, spied')
      .eq('user_id', user.id).limit(200).then((r: any) => r.data || []), []),
    // 5. Mello's overnight sweep: ads indexed in the last 24h (dai_created_at_idx → fast).
    soft<number>(admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true })
      .gte('created_at', H24).then((r: any) => r.count || 0), 0),
    // 6. Mello's nightly observations (mig 110, L7) — his own notes about the business.
    soft<any[]>(admin.from('daily_observations').select('id, observation, action, confidence, created_at')
      .eq('user_id', user.id).gte('created_at', H48).order('created_at', { ascending: false }).limit(3)
      .then((r: any) => r.data || []), []),
  ])

  // ── 1. Spine rows pass straight through (already Mello-voiced by their writers) ──
  for (const e of spine) {
    items.push({ id: e.id, kind: e.kind, importance: e.importance ?? 50, title: e.title, body: e.body || undefined, cta_label: e.cta_label || undefined, cta_href: e.cta_href || undefined, at: e.created_at })
  }
  // best-effort: stamp surfaced_at on what we're about to show
  if (spine.length) admin.from('brief_events').update({ surfaced_at: new Date().toISOString() }).in('id', spine.map((e: any) => e.id)).is('surfaced_at', null).then(() => {}, () => {})

  // Resolve any page-id-as-name into a real brand name (shared helper, same as the notifications bell).
  const needIds = notifs.filter((n: any) => isBlankName(n.brand_name)).map((n: any) => n.page_id).filter(Boolean)
  if (needIds.length) {
    const names = await soft(resolveBrandNames(admin, needIds), new Map<string, string>())
    for (const n of notifs as any[]) if (isBlankName(n.brand_name)) n.brand_name = names.get(String(n.page_id)) || null
  }

  // ── 2. Competitor drops → one item per brand, each with a "why you care" ──
  for (const n of notifs) {
    const brand = (!isBlankName(n.brand_name) && n.brand_name) || 'A brand you watch'
    const c = Math.max(1, Number(n.ad_count) || 1)
    items.push({
      kind: 'competitor_ads', importance: Math.min(85, 55 + c * 5), at: n.created_at,
      title: `${brand} launched ${c === 1 ? 'a new ad' : `${c} new ads`}.`,
      body: c > 2 ? `That's a real push, not routine rotation — worth reading what angle they're betting on before it compounds.` : `A single fresh creative — I'll flag if it turns into a burst.`,
      why: `You watch ${brand} — a launch like this usually means they found something working.`,
      cta_label: 'See the ads', cta_href: `/discovery/brand-spy`,
    })
  }

  // ── 3. Creatives ready → this is the HEADLINE (today's one decision), not a list item.
  //       0 or 1 decision per brief, never more: a forced daily "decision" manufactures urgency and
  //       burns trust. No numeric confidence until we have real outcome data — evidence, not theater. ──
  let headline: BriefItem | null = null
  if (creatives.length) {
    headline = {
      kind: 'creative_ready', importance: 100, at: creatives[0].created_at,
      title: creatives.length === 1 ? `I finished a new creative for you.` : `I finished ${creatives.length} new creatives — this is the strongest.`,
      body: `Built from what's currently winning in your market. Strong signal — the format and angle match this week's top performers in your niche. Nothing launches without your approval.`,
      why: `Fresh work waiting on your call — approving or killing it today keeps your pipeline moving.`,
      cta_label: 'Review & approve', cta_href: '/creative-studio',
      thumbs: creatives.map((c: any) => c.image_url).filter(Boolean).slice(0, 4),
    }
  }

  // ── 4. Market trend: top topics among the freshest ads from the pages the user watches;
  //       if they watch nothing yet, fall back to the newest slice of the whole market. ──
  const pageIds = follows.map((f: any) => f.page_id).filter(Boolean).slice(0, 60)
  const [trendAds, globalAds] = await Promise.all([
    soft((async () => {
      let q = admin.from('discovery_ads_index').select('topics').gte('created_at', D7).order('created_at', { ascending: false }).limit(300)
      if (pageIds.length) q = q.in('page_id', pageIds)
      const { data } = await q
      return data || []
    })(), [] as any[]),
    // Global slice powers the daily lesson (kept separate from the user-scoped trend).
    soft((async () => {
      const { data } = await admin.from('discovery_ads_index').select('topics').gte('created_at', H48).order('created_at', { ascending: false }).limit(200)
      return data || []
    })(), [] as any[]),
  ])
  const tally = (rows: any[]) => {
    const m = new Map<string, number>()
    for (const a of rows) for (const t of (a.topics || [])) m.set(t, (m.get(t) || 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }
  const top = tally(trendAds).slice(0, 3).filter(([, n]) => n >= 3)
  if (top.length) {
    const scope = pageIds.length ? 'across the brands you watch' : 'across the market'
    items.push({
      kind: 'trend', importance: 65,
      title: `The angle gaining ground ${scope}: “${top[0][0]}”.`,
      body: `${top[0][1]} fresh ads lean on it this week${top.length > 1 ? `; also rising: ${top.slice(1).map(([t]) => `“${t}”`).join(' and ')}` : ''}.`,
      why: pageIds.length ? `Your competitors are converging on it — early movers get the cheap clicks.` : `When a whole market converges on one angle, testing it early is the discount window.`,
      cta_label: 'Explore these ads', cta_href: `/discovery?q=${encodeURIComponent(top[0][0])}`,
    })
  }

  // ── 5. One lesson a day (Learning slot): the market-wide angle of the day + where to study it.
  //       Cheap, real, and habit-forming — the brief should make you slightly smarter every morning. ──
  const gTop = tally(globalAds).filter(([t]) => !top.length || t !== top[0][0]).slice(0, 1)
  const learning: BriefItem | null = gTop.length ? {
    kind: 'learning', importance: 30,
    title: `Today's lesson: study “${gTop[0][0]}”.`,
    body: `${gTop[0][1]} of the freshest ads market-wide use this angle right now. Read five of them and you'll see the pattern — then you own it.`,
    cta_label: 'Open the examples', cta_href: `/discovery?q=${encodeURIComponent(gTop[0][0])}`,
  } : null

  // ── 5b. Mello's own nightly observations (mig 110, L7) → spoken as insights in the standup. ──
  for (const o of observations) {
    items.push({
      kind: 'insight', importance: 55, at: o.created_at,
      title: o.observation,
      why: o.action || undefined,
      ...(o.action ? { cta_label: 'Act on this', cta_href: '/discovery' } : {}),
    })
  }

  // ── 6. The brief is a DOCUMENT, not a feed: hard cap, heaviest first, and it ENDS (sign-off).
  //       Quiet days say so out loud — an employee who can say "do nothing" is one you trust. ──
  items.sort((a, b) => b.importance - a.importance)

  return NextResponse.json({
    summary: {
      adsScanned: adsScanned,                     // Mello's overnight sweep, market-wide
      brandsWatched: follows.length,
      spiedBrands: follows.filter((f: any) => f.spied).length,
      creativesReady: creatives.length,
    },
    firstName: firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : null,
    headline,                                     // today's ONE decision (or null — quiet is honest)
    items: items.slice(0, 6),                     // finite by design
    learning,
    quiet: items.length === 0 && !headline,
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // RLS owner-update policy scopes this to the user's own rows.
  const { error } = await supabase.from('brief_events').update({ acted_on: true }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
