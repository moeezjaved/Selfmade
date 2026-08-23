/**
 * The Catalog cluster. Three agents that read the synced catalog, DRAFT improvements with the LLM, and —
 * only after the founder approves — write them back to Shopify. Approve-mode throughout: draftX() never
 * touches the store; applyDrafts() does, one product at a time, then refreshes the cache row.
 *
 *   seo         → productUpdate(seo:{title,description})        — fills missing search-result copy
 *   description → productUpdate(descriptionHtml)                — richer PDP body from the product's own facts
 *   alt         → fileUpdate(alt) per image                     — accessibility + image SEO
 *
 * proposal jsonb shapes (shopify_catalog_drafts.proposal):
 *   seo:         { title: {current, proposed}, description: {current, proposed} }
 *   description: { current, proposed }                          // proposed is HTML
 *   alt:         { images: [{ mediaId, url, current, proposed }] }
 */
import { llm } from '@/lib/llm'
import { shopifyGraphql, tokenFor, type StoreRow } from '@/lib/shopify/client'

export type Agent = 'seo' | 'description' | 'alt'

function stripHtml(html: string, max = 600): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function firstJson(text: string): any {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)) } catch { /* noop */ } }
  return null
}

/** Products in the cache that have the gap this agent fixes. */
export async function catalogTargets(admin: any, storeId: string, agent: Agent, limit = 50): Promise<any[]> {
  let q = admin.from('shopify_products').select('*').eq('store_id', storeId).eq('status', 'active').limit(limit)
  if (agent === 'seo') q = q.or('seo_title.is.null,seo_description.is.null')
  else if (agent === 'alt') q = q.gt('images_missing_alt', 0)
  // description: everything is a candidate (we rewrite thin/empty bodies); order by shortest body first
  const { data } = await q
  let rows: any[] = data || []
  if (agent === 'description') rows = rows.sort((a, b) => (a.body_html?.length || 0) - (b.body_html?.length || 0))
  return rows
}

/* ── Drafters (no writes) ─────────────────────────────────────────────────────────────────────── */

export async function draftSeo(p: any): Promise<{ title: { current: string | null; proposed: string }; description: { current: string | null; proposed: string } } | null> {
  const sys = 'You are a Shopify SEO copywriter. Write a search-result title and meta description for this product. Rules: title ≤ 60 characters, compelling, front-load the product name + primary benefit; meta description 140-158 characters, active voice, one concrete benefit + a soft nudge to click. No quotes, no emoji, no ALL CAPS. Return ONLY JSON: {"title":"...","description":"..."}'
  const facts = { title: p.title, type: p.product_type, vendor: p.vendor, tags: p.tags, body: stripHtml(p.body_html, 500), price: p.price_min }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\nPRODUCT:\n${JSON.stringify(facts)}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    if (!j?.title || !j?.description) return null
    return { title: { current: p.seo_title || null, proposed: String(j.title).slice(0, 70) }, description: { current: p.seo_description || null, proposed: String(j.description).slice(0, 320) } }
  } catch { return null }
}

export async function draftDescription(p: any): Promise<{ current: string | null; proposed: string } | null> {
  const sys = 'You are a DTC product copywriter. Write a Shopify product description as clean HTML: one short opening paragraph (hook + what it is + who it is for), then a <ul> of 3-5 concrete benefit bullets, then one short closing line. Ground every claim in the facts given — do NOT invent ingredients, certifications, or numbers. No headings, no emoji. Return ONLY JSON: {"html":"..."}'
  const facts = { title: p.title, type: p.product_type, vendor: p.vendor, tags: p.tags, currentBody: stripHtml(p.body_html, 800), price: p.price_min }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 700, temperature: 0.6, messages: [{ role: 'user', content: `${sys}\n\nPRODUCT:\n${JSON.stringify(facts)}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    if (!j?.html) return null
    return { current: p.body_html || null, proposed: String(j.html) }
  } catch { return null }
}

/** Alt-text needs live media (ids + urls); the sync doesn't store media ids, so fetch them per product. */
const PRODUCT_MEDIA_QUERY = /* GraphQL */ `
  query($id: ID!) {
    product(id: $id) {
      title
      media(first: 30) { nodes { ... on MediaImage { id alt image { url } } } }
    }
  }
`

export async function draftAlt(shop: string, token: string, p: any): Promise<{ images: { mediaId: string; url: string; current: string | null; proposed: string }[] } | null> {
  let media: any[] = []
  let title = p.title
  try {
    const data: any = await shopifyGraphql(shop, token, PRODUCT_MEDIA_QUERY, { id: p.gid })
    title = data?.product?.title || title
    media = (data?.product?.media?.nodes || []).filter((m: any) => m?.id && m?.image?.url)
  } catch { return null }
  const missing = media.filter((m) => !m.alt || !String(m.alt).trim())
  if (!missing.length) return { images: [] }

  const sys = `You are writing image alt text for the Shopify product "${title}". For each image index, write descriptive alt text (≤ 125 chars) that names what's shown and includes the product name naturally. Factual, no "image of", no keyword stuffing. Return ONLY JSON: {"alts":{"0":"...","1":"..."}} keyed by the index given.`
  const list = missing.map((m, i) => ({ i, url: m.image.url }))
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 500, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\nPRODUCT: ${JSON.stringify({ title, type: p.product_type, tags: p.tags })}\nIMAGES: ${JSON.stringify(list)}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    const alts = j?.alts || {}
    const images = missing.map((m, i) => ({ mediaId: m.id, url: m.image.url, current: m.alt || null, proposed: String(alts[String(i)] || `${title}`).slice(0, 125) })).filter((x) => x.proposed)
    return { images }
  } catch { return null }
}

/* ── Draft persistence ────────────────────────────────────────────────────────────────────────── */

export async function generateDrafts(admin: any, store: StoreRow, agent: Agent, limit = 25): Promise<{ created: number; scanned: number }> {
  const targets = await catalogTargets(admin, store.id, agent, limit)
  const token = agent === 'alt' ? tokenFor(store) : ''
  let created = 0
  for (const p of targets) {
    let proposal: any = null
    if (agent === 'seo') proposal = await draftSeo(p)
    else if (agent === 'description') proposal = await draftDescription(p)
    else if (agent === 'alt') { const a = await draftAlt(store.shop_domain, token, p); proposal = a && a.images.length ? a : null }
    if (!proposal) continue
    // replace any prior open draft for this (product, agent)
    await admin.from('shopify_catalog_drafts').delete().eq('store_id', store.id).eq('product_gid', p.gid).eq('agent', agent).eq('status', 'draft')
    await admin.from('shopify_catalog_drafts').insert({
      store_id: store.id, brand_id: store.brand_id, user_id: store.user_id,
      product_gid: p.gid, product_title: p.title, agent, proposal, status: 'draft',
    })
    created++
  }
  return { created, scanned: targets.length }
}

/* ── Write-back (only after approval) ─────────────────────────────────────────────────────────── */

const PRODUCT_UPDATE = /* GraphQL */ `
  mutation($input: ProductInput!) {
    productUpdate(input: $input) { product { id } userErrors { field message } }
  }
`
const FILE_UPDATE = /* GraphQL */ `
  mutation($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) { files { id alt } userErrors { field message } }
  }
`

async function applyOne(shop: string, token: string, row: any): Promise<void> {
  const pr = row.proposal || {}
  if (row.agent === 'seo') {
    const input: any = { id: row.product_gid, seo: { title: pr.title?.proposed, description: pr.description?.proposed } }
    const d = await shopifyGraphql(shop, token, PRODUCT_UPDATE, { input })
    const errs = d?.productUpdate?.userErrors || []
    if (errs.length) throw new Error(errs.map((e: any) => e.message).join('; '))
  } else if (row.agent === 'description') {
    const input: any = { id: row.product_gid, descriptionHtml: pr.proposed }
    const d = await shopifyGraphql(shop, token, PRODUCT_UPDATE, { input })
    const errs = d?.productUpdate?.userErrors || []
    if (errs.length) throw new Error(errs.map((e: any) => e.message).join('; '))
  } else if (row.agent === 'alt') {
    const files = (pr.images || []).map((im: any) => ({ id: im.mediaId, alt: im.proposed }))
    if (!files.length) return
    const d = await shopifyGraphql(shop, token, FILE_UPDATE, { files })
    const errs = d?.fileUpdate?.userErrors || []
    if (errs.length) throw new Error(errs.map((e: any) => e.message).join('; '))
  }
}

/** Apply approved drafts to Shopify, mark each applied/failed, and refresh the affected cache rows. */
export async function applyDrafts(admin: any, store: StoreRow, draftIds: string[]): Promise<{ applied: number; failed: number }> {
  const token = tokenFor(store)
  const { data } = await admin.from('shopify_catalog_drafts').select('*').in('id', draftIds).eq('store_id', store.id).eq('status', 'draft')
  const rows: any[] = data || []
  let applied = 0, failed = 0
  const touched = new Set<string>()
  for (const row of rows) {
    try {
      await applyOne(store.shop_domain, token, row)
      await admin.from('shopify_catalog_drafts').update({ status: 'applied', applied_at: new Date().toISOString(), error: null }).eq('id', row.id)
      touched.add(row.product_gid)
      applied++
    } catch (e: any) {
      await admin.from('shopify_catalog_drafts').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', row.id)
      failed++
    }
  }
  // Refresh the cache columns we changed so the health numbers move.
  for (const gid of Array.from(touched)) {
    const applies = rows.filter((r) => r.product_gid === gid && r.status !== 'failed')
    const patch: any = {}
    for (const r of applies) {
      if (r.agent === 'seo') { patch.seo_title = r.proposal?.title?.proposed; patch.seo_description = r.proposal?.description?.proposed }
      else if (r.agent === 'description') patch.body_html = r.proposal?.proposed
      else if (r.agent === 'alt') patch.images_missing_alt = 0
    }
    if (Object.keys(patch).length) await admin.from('shopify_products').update(patch).eq('store_id', store.id).eq('gid', gid)
  }
  return { applied, failed }
}
