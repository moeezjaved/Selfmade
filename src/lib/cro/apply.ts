/**
 * CRO Phase 1 — APPLY a fix. The safe, reversible slice: rewrite the top product's description (body_html)
 * grounded in the CRO audit's findings, and push it to Shopify via the products API. Product-level only
 * (no risky theme edits), and every apply stashes the previous HTML so it's one-click reversible.
 */
import { llm } from '@/lib/llm'
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'
import type { CroReport } from '@/lib/cro/audit'

export type PdpRewrite = { gid: string; title: string; before: string; after: string; handle?: string }

const numericId = (gid: string) => (gid.match(/(\d+)\s*$/)?.[1] || '')

/** Pick the product the audit was about (by the productUrl handle), else the priciest active product. */
async function pickProduct(admin: any, store: StoreRow, report?: CroReport | null): Promise<any | null> {
  const handle = report?.productUrl ? String(report.productUrl).replace(/[?#].*$/, '').replace(/\/$/, '').split('/products/')[1]?.split('/')[0] : ''
  if (handle) {
    const { data } = await admin.from('shopify_products').select('gid, handle, title, body_html, product_type, price_min, price_max').eq('store_id', store.id).eq('handle', handle).maybeSingle()
    if (data?.gid) return data
  }
  const { data } = await admin.from('shopify_products').select('gid, handle, title, body_html, product_type, price_min, price_max')
    .eq('store_id', store.id).eq('status', 'active').order('price_max', { ascending: false, nullsFirst: false }).limit(1)
  return (data && data[0]) || null
}

/** Generate a conversion-optimized product description grounded in the product + the CRO findings. */
export async function generatePdpRewrite(admin: any, store: StoreRow, report: CroReport | null): Promise<PdpRewrite | null> {
  const p = await pickProduct(admin, store, report)
  if (!p?.gid) return null
  const currentText = String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
  const pdpLeaks = (report?.leaks || []).filter((l) => l.screen === 'pdp').map((l) => `${l.title}: ${l.fix}`)
  const pdpChanges = (report?.productPage || []).map((c) => c.change)

  const sys = `You are a world-class DTC copywriter + CRO expert. Rewrite the PRODUCT DESCRIPTION for a Shopify product page to convert more visitors into buyers. Return clean HTML for the product body (headings h2/h3, short paragraphs, bullet lists) — NO inline styles, NO <script>, NO <h1> (the theme renders the product title as H1).

Structure the description to fix the conversion leaks:
- Open with a benefit-led, quotable one-liner (what it does for the buyer, not features).
- "Why it works" / how it works — specific, honest.
- Scannable benefit bullets.
- Trust/reassurance (guarantee, what's included) — only if TRUE for this product; never invent stats, awards, or claims.
- A gentle urgency/next-step nudge.

HARD RULES: use ONLY facts implied by the current copy + product name; invent NO statistics, prices, ingredients, or certifications. Keep the real product identity. British/neutral tone, confident, not hypey.

PRODUCT: ${p.title}${p.product_type ? ` (${p.product_type})` : ''}
CURRENT DESCRIPTION (for facts — do not copy the weaknesses): ${currentText || '(none)'}
${pdpLeaks.length ? `CRO LEAKS TO FIX ON THIS PAGE:\n- ${pdpLeaks.join('\n- ')}` : ''}
${pdpChanges.length ? `EXACT PRODUCT-PAGE CHANGES REQUESTED:\n- ${pdpChanges.join('\n- ')}` : ''}

Return ONLY JSON: {"html":"<the new product description as clean HTML>"}`

  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1800, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: sys }] })
    const txt = res?.content?.[0]?.text || ''
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    const after = String(j?.html || '').trim()
    if (!after) return null
    return { gid: p.gid, title: p.title || 'Product', before: String(p.body_html || ''), after, handle: p.handle }
  } catch { return null }
}

/** Push the new description to Shopify AND stash the previous HTML on the brand for one-click undo. */
export async function applyPdpRewrite(admin: any, store: StoreRow, brandId: string | null, gid: string, newHtml: string): Promise<{ ok: true; url: string }> {
  const id = numericId(gid)
  if (!id) throw new Error('Bad product id')
  // Read the CURRENT description straight from Shopify (source of truth) so undo restores exactly.
  const token = tokenFor(store)
  const cur = await shopifyRest(store.shop_domain, token, `products/${id}.json`).catch(() => null)
  const previous = cur?.product?.body_html || ''

  await shopifyRest(store.shop_domain, token, `products/${id}.json`, { method: 'PUT', body: { product: { id: Number(id), body_html: newHtml } } })

  // Stash undo on the brand (keyed by gid) + keep our local copy in sync.
  if (brandId) {
    const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
    const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
    const undo = (kit.croUndo && typeof kit.croUndo === 'object') ? kit.croUndo : {}
    undo[gid] = { previous, appliedAt: new Date().toISOString() }
    await admin.from('brands').update({ brand_kit: { ...kit, croUndo: undo } }).eq('id', brandId).then(() => {}, () => {})
  }
  await admin.from('shopify_products').update({ body_html: newHtml }).eq('store_id', store.id).eq('gid', gid).then(() => {}, () => {})

  const handle = cur?.product?.handle || ''
  return { ok: true, url: `https://${store.shop_domain}/products/${handle}` }
}

/** Restore the description we replaced (from the brand's stashed undo). */
export async function undoPdpRewrite(admin: any, store: StoreRow, brandId: string | null, gid: string): Promise<{ ok: true } > {
  const id = numericId(gid)
  if (!id || !brandId) throw new Error('Nothing to undo')
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  const rec = kit.croUndo?.[gid]
  if (!rec) throw new Error('No previous version stored')
  const token = tokenFor(store)
  await shopifyRest(store.shop_domain, token, `products/${id}.json`, { method: 'PUT', body: { product: { id: Number(id), body_html: rec.previous || '' } } })
  await admin.from('shopify_products').update({ body_html: rec.previous || '' }).eq('store_id', store.id).eq('gid', gid).then(() => {}, () => {})
  // clear the undo record
  const undo = { ...(kit.croUndo || {}) }; delete undo[gid]
  await admin.from('brands').update({ brand_kit: { ...kit, croUndo: undo } }).eq('id', brandId).then(() => {}, () => {})
  return { ok: true }
}
