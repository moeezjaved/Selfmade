/**
 * MelloContext — the ONE structured snapshot of everything true about a Selfmade account, loaded
 * BEFORE Mello answers anything (Phase 2.2 — Mello State Truth). This is the fix for the whole class
 * of bugs where Mello answered questions about the company's OWN state from the language model instead
 * of the database ("you're on the Free plan" to a Creator, "Connecting Meta is a Creator (paid) feature"
 * to someone who already IS Creator, "no active ads" for competitors that have active ads).
 *
 * The rule this enforces: the LLM READS state, it never DETERMINES state. Anything here — plan,
 * integrations, brand, competitors — is authoritative application state. It is loaded from the canonical
 * source of truth for each fact (getEntitlements, scopedMetaAccounts, followed_brands, channel_identities)
 * and handed to the answer pipeline as (a) a structured object callers can branch on deterministically,
 * and (b) a prompt-ready block the agent must treat as fact. Every section is fail-soft: one broken read
 * degrades that field to "unknown", it never blocks the turn.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanEntitlements, PlanId } from '@/lib/plans'

export interface MelloContext {
  userId: string
  brandId: string | null
  brandName: string | null
  brands: { id: string; name: string }[]
  plan: { id: PlanId; label: string; isPaid: boolean; renewsAt: string | null; ent: PlanEntitlements }
  integrations: {
    meta: { connected: boolean; accountName: string | null; accountId: string | null; linkedToActiveBrand: boolean; count: number }
    slack: { connected: boolean }
    whatsapp: { connected: boolean }
  }
  competitors: { name: string; pageId: string | null }[]
  /** Prompt-ready authoritative state block for the LLM (authority order, never to be contradicted). */
  prompt: string
  /** Provenance tags for logging/observability ("plan:starter", "meta:connected", …). */
  provenance: string[]
}

/** The slice productHowTo / grounded answers branch on (kept small to avoid import cycles). */
export interface MelloStateLite {
  plan?: { isPaid: boolean; label: string }
  meta?: { connected: boolean; accountName?: string | null }
}

const PAID_PLANS: PlanId[] = ['starter', 'pro', 'business', 'enterprise']

export async function loadMelloContext(admin: SupabaseClient, userId: string, explicitBrand?: string | null): Promise<MelloContext> {
  // Resolve the active brand first (explicit switcher → sf_brand cookie → null = All brands). Fail-soft.
  let brandId: string | null = explicitBrand || null
  if (!brandId) {
    try { const { resolveActiveBrandId } = await import('@/lib/brand/active'); brandId = await resolveActiveBrandId(admin, userId).catch(() => null) } catch { /* channel context (Slack/WhatsApp) */ }
  }

  const [plan, brands, integrations, competitors] = await Promise.all([
    loadPlan(admin, userId),
    loadBrands(admin, userId),
    loadIntegrations(admin, userId, brandId),
    loadCompetitors(admin, userId, brandId),
  ])

  const brandName = brandId ? (brands.find(b => b.id === brandId)?.name ?? null) : null
  const provenance = [
    `plan:${plan.id}`,
    `meta:${integrations.meta.connected ? 'connected' : 'none'}`,
    `slack:${integrations.slack.connected ? 'connected' : 'none'}`,
    `whatsapp:${integrations.whatsapp.connected ? 'connected' : 'none'}`,
    `brand:${brandId || 'all'}`,
    `competitors:${competitors.length}`,
  ]

  return { userId, brandId, brandName, brands, plan, integrations, competitors, provenance, prompt: renderPrompt({ brandId, brandName, brands, plan, integrations, competitors }) }
}

/** L1 — subscription plan. Canonical: getEntitlements over the BILLING OWNER (org owner's wallet). */
async function loadPlan(admin: SupabaseClient, userId: string): Promise<MelloContext['plan']> {
  try {
    const { resolveBillingOwner } = await import('@/lib/org')
    const { getEntitlements } = await import('@/lib/entitlements')
    const owner = await resolveBillingOwner(admin, userId).catch(() => userId)
    const ent = await getEntitlements(admin, owner)
    // Renewal date is a nice-to-have; select defensively (column may not exist on older schemas) — a
    // caught error just omits the date, never fabricates one.
    let renewsAt: string | null = null
    try {
      const { data } = await (admin as any).from('subscriptions').select('current_period_end').eq('owner_id', owner).in('status', ['active', 'trialing']).maybeSingle()
      if (data?.current_period_end) renewsAt = String(data.current_period_end).slice(0, 10)
    } catch { /* column/table absent → no date */ }
    return { id: ent.planId, label: ent.label, isPaid: PAID_PLANS.includes(ent.planId), renewsAt, ent }
  } catch {
    const { planEntitlements } = await import('@/lib/plans')
    const ent = planEntitlements('free')
    return { id: 'free', label: ent.label, isPaid: false, renewsAt: null, ent }
  }
}

async function loadBrands(admin: SupabaseClient, userId: string): Promise<{ id: string; name: string }[]> {
  try {
    const { data } = await (admin as any).from('brands').select('id, name').eq('user_id', userId).order('created_at', { ascending: true }).limit(25)
    return (data || []).map((b: any) => ({ id: String(b.id), name: String(b.name || '').trim() })).filter((b: any) => b.name)
  } catch { return [] }
}

/** L1 — integration connection state, from the canonical tables (meta_accounts, channel_identities). */
async function loadIntegrations(admin: SupabaseClient, userId: string, brandId: string | null): Promise<MelloContext['integrations']> {
  const meta = await (async () => {
    try {
      const { scopedMetaAccounts, resolveBrandScopedAccount } = await import('@/lib/meta/scope')
      const rows = await scopedMetaAccounts(admin, userId)
      if (!rows.length) return { connected: false, accountName: null, accountId: null, linkedToActiveBrand: false, count: 0 }
      const active = await resolveBrandScopedAccount(admin, userId, brandId).catch(() => null)
      const chosen = active || rows[0]
      return {
        connected: true,
        accountName: chosen?.account_name ?? null,
        accountId: chosen?.account_id ?? null,
        linkedToActiveBrand: !!(brandId && chosen?.brand_id && String(chosen.brand_id) === String(brandId)),
        count: rows.length,
      }
    } catch { return { connected: false, accountName: null, accountId: null, linkedToActiveBrand: false, count: 0 } }
  })()

  // Slack / WhatsApp — an ACTIVE founder-tool channel identity for that provider (channel layer, mig 131).
  let slack = false, whatsapp = false
  try {
    const { data } = await (admin as any).from('channel_identities').select('provider, active, meta').eq('user_id', userId).eq('active', true)
    for (const r of (data || [])) {
      const isFounder = r?.meta?.founder_tool !== false // founder_tool undefined/true counts; explicit false = customer-only
      if (r.provider === 'slack' && isFounder) slack = true
      if (r.provider === 'whatsapp' && isFounder) whatsapp = true
    }
  } catch { /* channel table absent → both false */ }

  return { meta, slack: { connected: slack }, whatsapp: { connected: whatsapp } }
}

/** L2 — the competitors the founder watches for the active brand, WITH page_id (the reliable join key). */
async function loadCompetitors(admin: SupabaseClient, userId: string, brandId: string | null): Promise<{ name: string; pageId: string | null }[]> {
  try {
    let q = (admin as any).from('followed_brands').select('brand_name, page_id, brand_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(30)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    const out: { name: string; pageId: string | null }[] = []
    const seen = new Set<string>()
    for (const f of (data || [])) {
      const name = String(f.brand_name || '').trim()
      if (!name || /^\d+$/.test(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, pageId: f.page_id ? String(f.page_id) : null })
    }
    return out
  } catch { return [] }
}

function renderPrompt(c: Pick<MelloContext, 'brandId' | 'brandName' | 'brands' | 'plan' | 'integrations' | 'competitors'>): string {
  const L: string[] = []
  L.push('## Account state — AUTHORITATIVE FACTS from the database. Never contradict or guess any of these.')
  // Plan
  if (c.plan.isPaid) {
    L.push(`- Plan: ${c.plan.label}${c.plan.id === 'starter' ? ' ($49/mo)' : ''} — a PAID plan. Meta, all competitors, and the full daily work are unlocked${c.plan.renewsAt ? `; renews ${c.plan.renewsAt}` : ''}. NEVER tell this user to "upgrade to Creator" or call any feature a "paid feature they need to unlock" — they already have it.`)
  } else {
    L.push(`- Plan: ${c.plan.label} (free). Image ads work; connecting Meta, launching, and watching more than ${c.plan.ent.brandSpy} competitor need the Creator plan ($49/mo).`)
  }
  // Meta
  const m = c.integrations.meta
  if (m.connected) L.push(`- Meta ad account: CONNECTED — "${m.accountName || m.accountId}"${m.linkedToActiveBrand && c.brandName ? ` (linked to ${c.brandName})` : ''}. Do NOT tell this user how to connect Meta — it is already connected. If they ask, tell them which account is connected.`)
  else L.push(`- Meta ad account: NOT connected.`)
  // Slack / WhatsApp
  L.push(`- Slack: ${c.integrations.slack.connected ? 'connected' : 'not connected'} · WhatsApp: ${c.integrations.whatsapp.connected ? 'connected' : 'not connected'}.`)
  // Brand
  if (c.brandName) L.push(`- Active brand: ${c.brandName}${c.brands.length > 1 ? ` (of ${c.brands.length}: ${c.brands.map(b => b.name).join(', ')})` : ''}.`)
  else if (c.brands.length) L.push(`- Active brand: All brands (${c.brands.map(b => b.name).join(', ')}).`)
  // Competitors (with page_id — the model must query by id, not name)
  if (c.competitors.length) {
    const list = c.competitors.map(x => `${x.name}${x.pageId ? ` (page_id ${x.pageId})` : ''}`).join(', ')
    L.push(`- Watching ${c.competitors.length} competitor${c.competitors.length === 1 ? '' : 's'}${c.brandName ? ` for ${c.brandName}` : ''}: ${list}. When analyzing one of these, call get_competitor_ads with its page_id (NOT its name — names miss on spelling/diacritics). Their ads ARE in the crawled library; never say a watched competitor has no ads without checking by page_id.`)
  } else {
    L.push(`- Watching: no competitors configured${c.brandName ? ` for ${c.brandName}` : ''} yet.`)
  }
  return L.join('\n')
}

/** The small slice productHowTo / grounded branches consume. */
export function toStateLite(ctx: MelloContext | null | undefined): MelloStateLite | undefined {
  if (!ctx) return undefined
  return { plan: { isPaid: ctx.plan.isPaid, label: ctx.plan.label }, meta: { connected: ctx.integrations.meta.connected, accountName: ctx.integrations.meta.accountName } }
}
