import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { getPlanId } from '@/lib/entitlements'
import { PLANS } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const userId = params.id

  const [authRes, profileRes, campaignsRes, draftsRes, scaleRes, errorsRes, followsRes, creativesRes, brandsRes, m4Res,
         storesRes, productsRes, catalogRes, ordersRes, geoRes, winsRes, docsRes, metaRes, loginRes, walletRes] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('user_profiles').select('*').eq('user_id', userId).single(),
    admin.from('campaigns').select('id, name, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('campaign_drafts').select('id, created_at').eq('user_id', userId).limit(1),
    admin.from('activity_logs').select('id').eq('user_id', userId).ilike('action_type', '%scale%').limit(1),
    admin.from('error_logs').select('id, error_message, page_url, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    // Brands this user follows (spy/alerts) + their AI creatives.
    admin.from('followed_brands').select('page_id, brand_name, email_alerts, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('creative_generations').select('id, type, tier, media_type, status, prompt, image_url, brand_id, source_ad_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
    // website + brand_kit so the admin can see each workspace's site, knowledge base, templates + audiences.
    admin.from('brands').select('id, name, website, brand_kit, created_at, brand_type').eq('user_id', userId).order('created_at', { ascending: false }),
    // Did they engage the M4 launch flow at all (even a failed attempt)? Newly tracked as an activity.
    admin.from('activity_logs').select('id').eq('user_id', userId).ilike('action_type', 'M4%').limit(1),
    // Connections + commerce + SEO activity, all for the per-brand workspace view.
    admin.from('shopify_stores').select('id, brand_id, shop_domain, shop_name, status').eq('user_id', userId),
    admin.from('shopify_products').select('brand_id, status').eq('user_id', userId),
    admin.from('shopify_catalog_drafts').select('store_id, status'),
    admin.from('shopify_orders').select('store_id, brand_id, total_price, currency, channel, processed_at').eq('user_id', userId),
    admin.from('geo_assets').select('brand_id, kind, status').eq('user_id', userId),
    admin.from('wins').select('brand_id, category, projected_value, banked_value, created_at').eq('user_id', userId),
    // Facebook / competitor reports Mello has authored for this user.
    admin.from('mello_documents').select('id, kind, title, subject, model, meta, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(40),
    admin.from('meta_accounts').select('brand_id, account_name, status, is_primary').eq('user_id', userId),
    // Login history (SECURITY DEFINER over auth.audit_log_entries — mig 170).
    admin.rpc('admin_login_stats', { p_user: userId }),
    admin.from('credit_wallets').select('plan_credits_balance, topup_credits_balance').eq('owner_id', userId).maybeSingle(),
  ])

  const authUser = authRes.data?.user
  const profile = profileRes.data

  // The REAL plan the app grants (subscriptions.plan / user_profiles.plan_id, most-generous) — NOT the
  // raw `subscription_status` string, which is a status (trialing/active), not a plan. A user comped to
  // Creator kept showing "Trialing" because the admin read the status field instead of the entitlement.
  const planId = await getPlanId(admin, userId).catch(() => 'free' as const)
  const planLabel = PLANS[planId]?.label || 'Free'

  const campaigns = campaignsRes.data || []
  const launched = campaigns.some((c: any) => c.status === 'ACTIVE' || c.status === 'PAUSED')
  const scaleClicked = (scaleRes.data?.length || 0) > 0
  // "Clicked Ad Plan (M4)" = engaged the M4 launch flow at all: a saved draft, a tracked M4 attempt,
  // OR (for attempts before we tracked them) an M4-launch error in their logs. A user who tried to
  // launch — even one that failed on a missing creative — has clearly reached M4.
  const errs = errorsRes.data || []
  const m4Attempted = (m4Res.data?.length || 0) > 0 || errs.some((e: any) => /^M4 Launch/i.test(e.error_message || '') || String(e.page_url || '') === '/m4')
  const adPlanClicked = (draftsRes.data?.length || 0) > 0 || m4Attempted

  // Map brand_id → name so each creative shows which brand it belongs to.
  const brandNames = new Map<string, string>((brandsRes.data || []).map((b: any) => [b.id, b.name]))
  const creatives = (creativesRes.data || []).map((c: any) => ({
    ...c,
    brand_name: c.brand_id ? brandNames.get(c.brand_id) || null : null,
  }))
  const follows = followsRes.data || []

  // ── Per-brand workspace: website, connections, KB, products, templates, audiences, SEO activity ──
  const brandsFull = brandsRes.data || []
  const stores = storesRes.data || []
  const products = productsRes.data || []
  const orders = ordersRes.data || []
  const geo = geoRes.data || []
  const wins = winsRes.data || []
  const metaAccts = metaRes.data || []
  const catalogDrafts = catalogRes.data || []
  const storeIds = new Set(stores.map((s: any) => s.id))
  // catalog drafts are global (no user filter on that table) → keep only this user's stores.
  const myCatalog = catalogDrafts.filter((d: any) => storeIds.has(d.store_id))

  const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v)) || 0
  const brands_workspace = brandsFull.map((b: any) => {
    const kit = (b.brand_kit && typeof b.brand_kit === 'object') ? b.brand_kit : {}
    const ads = kit.adsStudio || {}
    const store = stores.find((s: any) => s.brand_id === b.id) || null
    const brandOrders = orders.filter((o: any) => o.brand_id === b.id || (store && o.store_id === store.id))
    const brandCatalog = store ? myCatalog.filter((d: any) => d.store_id === store.id) : []
    const brandGeo = geo.filter((g: any) => g.brand_id === b.id)
    const brandWins = wins.filter((w: any) => w.brand_id === b.id)
    const meta = metaAccts.filter((m: any) => m.brand_id === b.id)
    return {
      id: b.id,
      name: b.name,
      website: b.website || null,
      brand_type: b.brand_type || null,
      created_at: b.created_at || null,
      // connections
      shopify: store ? { connected: true, shop_domain: store.shop_domain, shop_name: store.shop_name, status: store.status } : { connected: false },
      meta: meta.length ? { connected: true, accounts: meta.map((m: any) => ({ name: m.account_name, status: m.status, primary: m.is_primary })) } : { connected: false },
      // knowledge base + studio assets
      kb_present: !!(kit.knowledge || kit.brandVoice || kit.about || ads.warmedAt || Object.keys(kit).length > 1),
      kb_keys: Object.keys(kit).filter((k) => k !== 'adsStudio'),
      products_count: products.filter((p: any) => p.brand_id === b.id).length,
      templates_count: Array.isArray(ads.templates) ? ads.templates.length : 0,
      audiences: Array.isArray(ads.audiences) ? ads.audiences.slice(0, 8) : [],
      // SEO / storefront activity — is this user actually pushing SEO on Shopify?
      seo: {
        catalog_applied: brandCatalog.filter((d: any) => d.status === 'applied').length,
        catalog_drafts: brandCatalog.filter((d: any) => d.status === 'draft').length,
        blogs_published: brandGeo.filter((g: any) => g.status === 'published').length,
        blogs_drafts: brandGeo.filter((g: any) => g.status === 'draft').length,
        wins: brandWins.length,
      },
      // real revenue (from synced Shopify orders)
      revenue: {
        total: brandOrders.reduce((s: number, o: any) => s + num(o.total_price), 0),
        organic: brandOrders.filter((o: any) => o.channel === 'organic').reduce((s: number, o: any) => s + num(o.total_price), 0),
        orders: brandOrders.length,
        currency: brandOrders[0]?.currency || 'USD',
      },
    }
  })

  // Account-wide revenue roll-up across every store.
  const revenue = {
    total: orders.reduce((s: number, o: any) => s + num(o.total_price), 0),
    organic: orders.filter((o: any) => o.channel === 'organic').reduce((s: number, o: any) => s + num(o.total_price), 0),
    orders: orders.length,
    currency: orders[0]?.currency || 'USD',
  }

  // Facebook / competitor reports Mello has written.
  const reports = (docsRes.data || []).map((d: any) => ({
    id: d.id, kind: d.kind, title: d.title, subject: d.subject || null, model: d.model || null,
    ad_count: (d.meta && (d.meta.adCount ?? d.meta.ad_count)) || null,
    created_at: d.created_at,
  }))

  const logins = (loginRes as any)?.data || { d7: 0, d30: 0, total: 0, recent: [] }
  const wallet = walletRes.data || null
  const credit_balance = wallet ? (Number(wallet.plan_credits_balance) || 0) + (Number(wallet.topup_credits_balance) || 0) : null

  // "Last active" — auth.last_sign_in_at only updates on a FRESH sign-in, so a user with a long-lived
  // session shows a stale "last login" while creating things daily. Derive real activity from the most
  // recent thing they actually did (newest creative / campaign / follow / error) OR their last sign-in.
  const lastActiveAt = [
    creatives[0]?.created_at,
    campaigns[0]?.created_at,
    follows[0]?.created_at,
    (errorsRes.data || [])[0]?.created_at,
    (logins.recent || [])[0],
    authUser?.last_sign_in_at,
  ].filter(Boolean).sort().pop() || null

  return NextResponse.json({
    id: userId,
    email: authUser?.email || '',
    full_name: profile?.full_name || '',
    subscription_status: profile?.subscription_status || 'trialing',
    plan: planId,            // resolved entitlement id (e.g. 'starter')
    plan_label: planLabel,   // human label (e.g. 'Creator') — the true plan, for the admin "Plan" row
    created_at: profile?.created_at || authUser?.created_at,
    last_sign_in_at: authUser?.last_sign_in_at || null,
    last_active_at: lastActiveAt,
    business_type: profile?.business_type || '',
    niche: profile?.niche || '',
    experience_level: profile?.experience_level || '',
    trial_ends_at: profile?.trial_ends_at || null,
    // Funnel
    ad_plan_clicked: adPlanClicked,
    campaign_launched: launched,
    scale_clicked: scaleClicked,
    campaigns_count: campaigns.length,
    campaigns,
    // Credits, logins, revenue, reports, and the full per-brand workspace.
    credit_balance,
    logins,
    revenue,
    reports,
    brands_workspace,
    // Brands (projects) this user created — count + list for the admin.
    brands_count: (brandsRes.data || []).length,
    brands_created: (brandsRes.data || []).map((b: any) => ({ id: b.id, name: b.name, brand_type: b.brand_type || null, created_at: b.created_at || null })),
    errors: errorsRes.data || [],
    follows,
    creatives,
  })
}

// PATCH — admin actions on a user. Currently: extend trial.
//   body: { action: 'extend_trial', days: number }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const userId = params.id
  const body = await request.json().catch(() => ({}))

  if (body.action === 'extend_trial') {
    const days = parseInt(String(body.days), 10)
    if (!days || days < 1 || days > 365) {
      return NextResponse.json({ error: 'days must be between 1 and 365' }, { status: 400 })
    }
    // Extend from the LATER of now or the current trial end, so extending an
    // active trial adds time, and extending an expired one starts fresh from now.
    const { data: prof } = await admin
      .from('user_profiles').select('trial_ends_at').eq('user_id', userId).single()
    const now = Date.now()
    const currentEnd = prof?.trial_ends_at ? new Date(prof.trial_ends_at).getTime() : now
    const base = Math.max(now, currentEnd)
    const newEnd = new Date(base + days * 86_400_000).toISOString()

    const { error } = await admin
      .from('user_profiles')
      .update({ trial_ends_at: newEnd, subscription_status: 'trialing' })
      .eq('user_id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, trial_ends_at: newEnd, days_added: days })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
