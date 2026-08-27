/**
 * CRO Phase 1 — Apply a fix.
 *   POST { action:'preview' }              → generate a rewritten product description (charges credits)
 *   POST { action:'apply', gid, html }     → push it live to Shopify (reversible; stores undo)
 *   POST { action:'undo', gid }            → restore the previous description
 * Paid feature (modifies the live store); free → upgrade. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { generatePdpRewrite, applyPdpRewrite, undoPdpRewrite } from '@/lib/cro/apply'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { getPlanId } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'
import type { CroReport } from '@/lib/cro/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const body = await req.json().catch(() => ({} as any))
  const action = body?.action

  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return NextResponse.json({ error: 'no_store', reason: 'Connect your Shopify store first — applying fixes writes to your store.' }, { status: 400 })

  // Applying anything to the live store is a paid feature (like publishing). Free → upgrade wall.
  const owner = await resolveBillingOwner(admin, user.id).catch(() => user.id)
  if ((await getPlanId(admin, owner).catch(() => 'free' as const)) === 'free') {
    return NextResponse.json({ error: 'upgrade_required', reason: 'Applying fixes to your live store is a paid feature — audits stay free. Upgrade to apply.' }, { status: 402 })
  }

  if (action === 'preview') {
    // Load the cached audit for grounding context.
    let report: CroReport | null = null
    if (brandId) {
      const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
      const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
      report = kit.croAudit || null
    }
    // Generating the rewrite is one LLM write → charge blog_draft. Refunded if it fails.
    let txId: string | null = null
    try { txId = (await reserveCredits(admin, user.id, 'blog_draft')).id }
    catch (e) {
      if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Rewriting a page costs credits — top up to continue.' }, { status: 402 })
      return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
    }
    try {
      const rw = await generatePdpRewrite(admin, store as any, report)
      if (!rw) { await refundCredits(admin, txId).catch(() => {}); return NextResponse.json({ error: 'no_product', reason: 'Couldn’t find a product to rewrite — sync your catalog and try again.' }, { status: 400 }) }
      await commitCredits(admin, txId, { kind: 'blog_draft', via: 'cro_pdp_rewrite' }).catch(() => {})
      return NextResponse.json({ ok: true, ...rw })
    } catch (e) { await refundCredits(admin, txId).catch(() => {}); return NextResponse.json({ error: 'rewrite_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
  }

  if (action === 'apply') {
    const gid = String(body?.gid || '').trim()
    const html = String(body?.html || '')
    if (!gid || !html) return NextResponse.json({ error: 'Missing gid or html' }, { status: 400 })
    try {
      const res = await applyPdpRewrite(admin, store as any, brandId, gid, html)
      try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin, { userId: user.id, brandId: (store as any).brand_id, category: 'site', title: 'Applied a CRO fix (product page)', detail: 'Rewrote the product description', currency: (store as any).currency, meta: { gid, url: res.url } }) } catch { /* optional */ }
      return NextResponse.json(res)
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      const scopeHint = /403|scope|access/i.test(msg) ? ' — your Shopify app may be missing write_products. Add it in the app’s API scopes and reconnect.' : ''
      return NextResponse.json({ error: 'apply_failed', detail: (msg.slice(0, 160) + scopeHint) }, { status: 500 })
    }
  }

  if (action === 'undo') {
    const gid = String(body?.gid || '').trim()
    if (!gid) return NextResponse.json({ error: 'Missing gid' }, { status: 400 })
    try { const res = await undoPdpRewrite(admin, store as any, brandId, gid); return NextResponse.json(res) }
    catch (e) { return NextResponse.json({ error: 'undo_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
