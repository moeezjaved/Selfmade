/**
 * GET /api/mello/journey — the retention engine. Reads REAL state across every agent we built and shapes it
 * into one connected quest: a momentum meter, staged tasks that unlock each other (Connect → Fix → Publish →
 * Grow), a single next-best-action, and a 12-month projected ladder. Every number is a fact from a table —
 * the "game" is honest. Brand-scoped, read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { revenueSummary } from '@/lib/shopify/orders'
import { winsSummary } from '@/lib/mello/wins'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Task = { key: string; label: string; done: boolean; value?: string; href: string; locked?: boolean }
type Stage = { key: string; name: string; tagline: string; status: 'done' | 'active' | 'locked'; tasks: Task[]; impact?: string }

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const uid = user.id
  const brandId = await resolveActiveBrandId(admin, uid).catch(() => null)
  const scope = (q: any) => (brandId ? q.eq('brand_id', brandId) : q)
  const count = async (fn: () => any): Promise<number> => { try { const { count } = await fn(); return count || 0 } catch { return 0 } }
  const one = async (fn: () => any): Promise<any> => { try { const { data } = await fn(); return data } catch { return null } }

  const [store, meta, health, catalogApplied, blogPub, pseoPub, pseoDraft, geoAnswers, geoAudit, seoAudit, keywords] = await Promise.all([
    one(() => scope(admin.from('shopify_stores').select('shop_name, shop_domain').eq('user_id', uid).eq('status', 'active').limit(1)).maybeSingle()),
    count(() => admin.from('meta_accounts').select('id', { count: 'exact', head: true }).eq('user_id', uid)),
    one(() => scope(admin.from('shopify_stores').select('id').eq('user_id', uid).limit(1)).maybeSingle()).then(async (s: any) => {
      if (!s?.id) return null
      const { data } = await admin.from('shopify_products').select('seo_title, images_missing_alt').eq('store_id', s.id).limit(5000)
      const rows: any[] = data || []
      return { products: rows.length, missingSeo: rows.filter((r) => !r.seo_title).length, missingAlt: rows.reduce((a, r) => a + (r.images_missing_alt || 0), 0) }
    }),
    count(() => scope(admin.from('shopify_catalog_drafts').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'applied'))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'blog').eq('status', 'published'))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'pseo').eq('status', 'published'))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'pseo').eq('status', 'draft'))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'answer_page'))),
    one(() => scope(admin.from('geo_audit').select('score, share_of_voice').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)).maybeSingle()),
    one(() => scope(admin.from('seo_audit').select('score').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)).maybeSingle()),
    count(() => scope(admin.from('seo_keywords').select('id', { count: 'exact', head: true }).eq('user_id', uid))),
  ])

  const storeConnected = !!store
  const metaConnected = meta > 0
  const sov = geoAudit?.share_of_voice != null ? Math.round(Number(geoAudit.share_of_voice) * 100) : null
  const contentLive = blogPub + pseoPub
  const gapsRemaining = health ? health.missingSeo + health.missingAlt : 0

  // ── Stages (each unlocks the next) ──────────────────────────────────────────────────────────
  const connect: Task[] = [
    { key: 'shopify', label: 'Connect your Shopify store', done: storeConnected, value: health ? `${health.products} products` : undefined, href: '/connect/shopify' },
    { key: 'meta', label: 'Connect Meta (ads)', done: metaConnected, href: '/connect-meta' },
    { key: 'gsc', label: 'Connect Google Search Console', done: false, href: '/mission/seo', locked: true, value: 'soon' },
  ]
  const fix: Task[] = [
    { key: 'catalog_seo', label: 'Fill missing product SEO', done: !!health && health.missingSeo === 0, value: health ? `${health.missingSeo} left` : undefined, href: '/mission/catalog' },
    { key: 'catalog_alt', label: 'Add alt text to product images', done: !!health && health.missingAlt === 0, value: health ? `${health.missingAlt} left` : undefined, href: '/mission/catalog' },
  ]
  const publish: Task[] = [
    { key: 'first_blog', label: 'Publish your first blog article', done: blogPub > 0, value: blogPub ? `${blogPub} live` : undefined, href: '/mission/blog' },
    { key: 'programmatic', label: 'Build pages at scale (programmatic SEO)', done: pseoPub > 0, value: pseoPub ? `${pseoPub} live` : (pseoDraft ? `${pseoDraft} drafted` : undefined), href: '/mission/programmatic' },
    { key: 'geo_answers', label: 'Write answer pages for AI search', done: geoAnswers > 0, value: geoAnswers ? `${geoAnswers} drafted` : undefined, href: '/mission/geo' },
  ]
  const grow: Task[] = [
    { key: 'geo_check', label: 'Check your AI visibility', done: !!geoAudit, value: sov != null ? `${sov}% share of voice` : undefined, href: '/mission/geo' },
    { key: 'seo_audit', label: 'Audit your site for SEO', done: !!seoAudit, value: seoAudit?.score != null ? `score ${seoAudit.score}/100` : undefined, href: '/mission/seo' },
    { key: 'keywords', label: 'Find the keywords worth winning', done: keywords > 0, value: keywords ? `${keywords} found` : undefined, href: '/mission/seo' },
  ]

  const rawStages: { key: string; name: string; tagline: string; tasks: Task[]; impact?: string }[] = [
    { key: 'connect', name: 'Connect', tagline: 'Plug in your store and channels', tasks: connect },
    { key: 'fix', name: 'Fix', tagline: 'Quick wins already in your catalog', tasks: fix, impact: gapsRemaining > 0 ? `${gapsRemaining} easy fixes waiting` : 'Catalog clean ✓' },
    { key: 'publish', name: 'Publish', tagline: 'Create the pages that pull traffic', tasks: publish, impact: contentLive > 0 ? `${contentLive} pages live` : undefined },
    { key: 'grow', name: 'Grow', tagline: 'Compounding search + AI visibility', tasks: grow },
  ]

  // status: a stage is done when all its non-locked tasks are done; the first not-done stage is active.
  let activeAssigned = false
  const stages: Stage[] = rawStages.map((s) => {
    const actionable = s.tasks.filter((t) => !t.locked)
    const allDone = actionable.length > 0 && actionable.every((t) => t.done)
    let status: Stage['status']
    if (allDone) status = 'done'
    else if (!activeAssigned) { status = 'active'; activeAssigned = true }
    else status = 'locked'
    return { ...s, status }
  })

  // momentum = share of all actionable tasks done
  const allTasks = stages.flatMap((s) => s.tasks.filter((t) => !t.locked))
  const doneTasks = allTasks.filter((t) => t.done).length
  const momentum = allTasks.length ? Math.round((doneTasks / allTasks.length) * 100) : 0

  // next best action = first not-done, unlocked task in the active stage (fallback: first anywhere)
  const activeStage = stages.find((s) => s.status === 'active')
  const nextTask = (activeStage?.tasks || allTasks).find((t) => !t.done && !t.locked) || allTasks.find((t) => !t.done)
  const nextAction = nextTask ? { label: nextTask.label, href: nextTask.href, stage: activeStage?.name || '' } : null

  // wins — the real ledger count (falls back to a derived estimate if the ledger is empty/not applied yet)
  let wins = 0, banked = 0, activeDays = 0
  try {
    const ws = await winsSummary(admin, uid, brandId, 365)
    wins = ws.moves; banked = ws.bankedTotal
    // active-days streak: consecutive calendar days (ending today or yesterday) with at least one move.
    const dayset = new Set((ws.recent || []).map((r) => new Date(r.created_at).toISOString().slice(0, 10)))
    let cursor = new Date(); const todayKey = cursor.toISOString().slice(0, 10)
    if (!dayset.has(todayKey)) cursor = new Date(Date.now() - 86400000)   // allow the streak to count through yesterday
    for (;;) {
      const key = cursor.toISOString().slice(0, 10)
      if (!dayset.has(key)) break
      activeDays++; cursor = new Date(cursor.getTime() - 86400000)
    }
  } catch { /* ledger optional */ }
  if (!wins) wins = catalogApplied + contentLive + (geoAudit ? 1 : 0) + (seoAudit ? 1 : 0)

  // forward ladder (honest framing — outcomes, not promises)
  const ladder = [
    { window: 'Weeks 1–4', title: 'Foundation', desc: 'Store connected, catalog fixed, first pages live', reached: storeConnected && gapsRemaining === 0 },
    { window: 'Months 1–3', title: 'First traffic', desc: 'Articles indexed, first AI citations, keywords tracked', reached: contentLive >= 5 },
    { window: 'Months 3–6', title: 'Moving up', desc: 'Programmatic pages ranking, share of voice climbing', reached: pseoPub >= 10 },
    { window: 'Months 6–12', title: 'Owning it', desc: 'Page-one presence and compounding organic traffic', reached: false },
  ]

  // Real revenue + the organic (SEO) contribution, straight from synced orders (best-effort).
  let revenue: any = null
  if (storeConnected) {
    try {
      const storeRow = await resolveStore(admin, uid, brandId)
      if (storeRow) {
        const rev = await revenueSummary(admin, storeRow, 30)
        if (rev.hasData) revenue = { total: rev.revenue, aov: rev.aov, orders: rev.orders, currency: rev.currency, organic: rev.organicRevenue, organicShare: rev.organicShare, windowDays: rev.windowDays }
      }
    } catch { /* orders may not be synced yet */ }
  }

  // ── Phase 3: revenue milestones (understated markers, real monthly revenue) ──
  const monthlyRev = revenue?.total ?? 0
  const hasOrders = (revenue?.orders ?? 0) > 0
  const MSTONES = [
    { amount: 1, label: 'First sale' }, { amount: 1000, label: '€1k/mo' }, { amount: 5000, label: '€5k/mo' },
    { amount: 10000, label: '€10k/mo' }, { amount: 50000, label: '€50k/mo' }, { amount: 100000, label: '€100k/mo' },
  ]
  const milestones = MSTONES.map((m) => ({ ...m, reached: m.amount === 1 ? hasOrders : monthlyRev >= m.amount }))
  const nextIdx = milestones.findIndex((m) => !m.reached)
  const nextMilestone = nextIdx >= 0 ? { label: MSTONES[nextIdx].label, amount: MSTONES[nextIdx].amount, remaining: Math.max(0, Math.round(MSTONES[nextIdx].amount - monthlyRev)) } : null

  // ── Phase 4: the day's THREAT (latest ads-health alert) — the opportunity is nextAction above ──
  let threat: { title: string } | null = null
  try {
    const { data: t } = await admin.from('brief_events').select('title').eq('user_id', uid).eq('kind', 'ads_health').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (t?.title) threat = { title: t.title }
  } catch { /* optional */ }

  return NextResponse.json({
    store: store ? { name: store.shop_name || store.shop_domain } : null,
    momentum, wins, banked, activeDays, nextAction, revenue,
    milestones, nextMilestone, threat,
    stages, ladder,
  })
}
