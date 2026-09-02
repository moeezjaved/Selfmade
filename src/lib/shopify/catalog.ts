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

export type Agent = 'seo' | 'description' | 'alt' | 'title' | 'tags' | 'collection' | 'page'

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

/** Products in the cache that have the gap this agent fixes. (Collections are fetched live in generateDrafts.) */
export async function catalogTargets(admin: any, storeId: string, agent: Agent, limit = 50): Promise<any[]> {
  if (agent === 'collection') return []
  let q = admin.from('shopify_products').select('*').eq('store_id', storeId).eq('status', 'active').limit(limit)
  if (agent === 'seo') q = q.or('seo_title.is.null,seo_description.is.null')
  else if (agent === 'alt') q = q.gt('images_missing_alt', 0)
  else if (agent === 'tags') q = q.or('tags.is.null,tags.eq.')
  // description + title: every product is a candidate; order by weakest first
  const { data } = await q
  let rows: any[] = data || []
  if (agent === 'description') rows = rows.sort((a, b) => (a.body_html?.length || 0) - (b.body_html?.length || 0))
  else if (agent === 'title') rows = rows.sort((a, b) => (a.title?.length || 0) - (b.title?.length || 0))
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

export async function draftTitle(p: any): Promise<{ current: string | null; proposed: string } | null> {
  const sys = 'You are a Shopify merchandiser. Rewrite this product\'s STOREFRONT title so a shopper instantly knows what it is and searches find it. Keep the brand\'s voice, keep it concise (≤ 70 chars), no ALL CAPS, no gimmicks, no price. Do NOT change what the product fundamentally is. If the current title is already strong, return it unchanged. Return ONLY JSON: {"title":"..."}'
  const facts = { title: p.title, type: p.product_type, vendor: p.vendor, tags: p.tags, body: stripHtml(p.body_html, 300) }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 120, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\nPRODUCT:\n${JSON.stringify(facts)}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    const proposed = String(j?.title || '').trim().slice(0, 80)
    if (!proposed || proposed === p.title) return null
    return { current: p.title || null, proposed }
  } catch { return null }
}

export async function draftTags(p: any): Promise<{ current: string | null; proposed: string; added: string[] } | null> {
  const sys = 'You are a Shopify catalog taxonomist. Suggest storefront filter/discovery tags for this product — attributes a shopper would filter or search by (material, use-case, format, scent/flavor, category, audience). 6-12 short lowercase tags. Reuse the existing ones and add what is missing; invent nothing not supported by the facts. Return ONLY JSON: {"tags":["...","..."]}'
  const existing = String(p.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean)
  const facts = { title: p.title, type: p.product_type, vendor: p.vendor, existingTags: existing, body: stripHtml(p.body_html, 400) }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\nPRODUCT:\n${JSON.stringify(facts)}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    const suggested: string[] = Array.isArray(j?.tags) ? j.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : []
    if (!suggested.length) return null
    const merged = Array.from(new Set([...existing.map((t: string) => t.toLowerCase()), ...suggested]))
    const added = suggested.filter((t) => !existing.map((e: string) => e.toLowerCase()).includes(t))
    if (!added.length) return null
    return { current: existing.join(', ') || null, proposed: merged.join(', '), added }
  } catch { return null }
}

/* ── Collections (fetched live; not in the product cache) ─────────────────────────────────────── */
const COLLECTIONS_QUERY = /* GraphQL */ `
  query($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title descriptionHtml seo { title description } }
    }
  }
`
export async function fetchCollections(shop: string, token: string, limit = 30): Promise<any[]> {
  const out: any[] = []
  let cursor: string | null = null
  while (out.length < limit) {
    const data: any = await shopifyGraphql(shop, token, COLLECTIONS_QUERY, { cursor })
    const conn = data?.collections
    out.push(...(conn?.nodes || []))
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  return out.slice(0, limit)
}

export async function draftCollection(c: any): Promise<{ title: { current: string | null; proposed: string }; description: { current: string | null; proposed: string }; body: { current: string | null; proposed: string } } | null> {
  const sys = 'You are a Shopify SEO copywriter working on a COLLECTION page. Write: (1) an SEO title ≤ 60 chars, (2) a meta description 140-158 chars, (3) a short intro paragraph as HTML (2-3 sentences) that tells shoppers what\'s in this collection and who it\'s for. Ground everything in the collection name — invent no products. Return ONLY JSON: {"seoTitle":"...","metaDescription":"...","bodyHtml":"..."}'
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 400, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\nCOLLECTION: ${JSON.stringify({ title: c.title, currentBody: stripHtml(c.descriptionHtml, 400) })}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    if (!j?.seoTitle || !j?.metaDescription) return null
    return {
      title: { current: c.seo?.title || null, proposed: String(j.seoTitle).slice(0, 70) },
      description: { current: c.seo?.description || null, proposed: String(j.metaDescription).slice(0, 320) },
      body: { current: c.descriptionHtml || null, proposed: String(j.bodyHtml || '') },
    }
  } catch { return null }
}

/* ── Online-store pages (About, FAQ, etc.) — fetched live; SEO written via metafields ──────────── */
const PAGES_QUERY = /* GraphQL */ `
  query($cursor: String) {
    pages(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle bodySummary
        t: metafield(namespace: "global", key: "title_tag") { value }
        d: metafield(namespace: "global", key: "description_tag") { value }
      }
    }
  }
`
export async function fetchPages(shop: string, token: string, limit = 30): Promise<any[]> {
  const out: any[] = []
  let cursor: string | null = null
  while (out.length < limit) {
    const data: any = await shopifyGraphql(shop, token, PAGES_QUERY, { cursor })
    const conn = data?.pages
    out.push(...(conn?.nodes || []))
    if (!conn?.pageInfo?.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  // Only pages that are actually missing an SEO title or meta description.
  return out.filter((p) => !p.t?.value || !p.d?.value).slice(0, limit)
}

export async function draftPage(p: any): Promise<{ title: { current: string | null; proposed: string }; description: { current: string | null; proposed: string } } | null> {
  const sys = 'You are a Shopify SEO copywriter writing the search-result snippet for an online-store PAGE (e.g. About, FAQ, Contact). Write (1) an SEO title ≤ 60 chars and (2) a meta description 140-158 chars. Ground everything in the page title + content — invent no facts, prices or claims. Return ONLY JSON: {"seoTitle":"...","metaDescription":"..."}'
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\nPAGE: ${JSON.stringify({ title: p.title, handle: p.handle, content: String(p.bodySummary || '').slice(0, 500) })}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    if (!j?.seoTitle || !j?.metaDescription) return null
    return {
      title: { current: p.t?.value || null, proposed: String(j.seoTitle).slice(0, 70) },
      description: { current: p.d?.value || null, proposed: String(j.metaDescription).slice(0, 320) },
    }
  } catch { return null }
}

/* ── Draft persistence ────────────────────────────────────────────────────────────────────────── */

export async function generateDrafts(admin: any, store: StoreRow, agent: Agent, limit = 25): Promise<{ created: number; scanned: number }> {
  // Pages aren't in the product cache — fetch them live and draft SEO title + meta (never touch the body).
  if (agent === 'page') {
    const token = tokenFor(store)
    const pages = await fetchPages(store.shop_domain, token, limit)
    let created = 0
    for (const pg of pages) {
      const proposal = await draftPage(pg)
      if (!proposal) continue
      await admin.from('shopify_catalog_drafts').delete().eq('store_id', store.id).eq('product_gid', pg.id).eq('agent', agent).eq('status', 'draft')
      await admin.from('shopify_catalog_drafts').insert({
        store_id: store.id, brand_id: store.brand_id, user_id: store.user_id,
        product_gid: pg.id, product_title: pg.title, agent, proposal, status: 'draft',
      })
      created++
    }
    return { created, scanned: pages.length }
  }
  // Collections aren't in the product cache — fetch them live and draft against them.
  if (agent === 'collection') {
    const token = tokenFor(store)
    const cols = await fetchCollections(store.shop_domain, token, limit)
    let created = 0
    for (const c of cols) {
      const proposal = await draftCollection(c)
      if (!proposal) continue
      await admin.from('shopify_catalog_drafts').delete().eq('store_id', store.id).eq('product_gid', c.id).eq('agent', agent).eq('status', 'draft')
      await admin.from('shopify_catalog_drafts').insert({
        store_id: store.id, brand_id: store.brand_id, user_id: store.user_id,
        product_gid: c.id, product_title: c.title, agent, proposal, status: 'draft',
      })
      created++
    }
    return { created, scanned: cols.length }
  }

  const targets = await catalogTargets(admin, store.id, agent, limit)
  const token = agent === 'alt' ? tokenFor(store) : ''
  let created = 0
  for (const p of targets) {
    let proposal: any = null
    if (agent === 'seo') proposal = await draftSeo(p)
    else if (agent === 'description') proposal = await draftDescription(p)
    else if (agent === 'title') proposal = await draftTitle(p)
    else if (agent === 'tags') proposal = await draftTags(p)
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

const PRODUCT_IMAGES_QUERY = /* GraphQL */ `
  query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id featuredImage { url } } } }
`

/**
 * The REAL products just drafted for (store, agent), each with its live featured image and a
 * before → after summary — so Mello can present grounded, image-rich changes in chat (never
 * inventing products). Images are best-effort; a missing image just omits the thumbnail.
 */
export async function listDraftedProducts(
  admin: any, store: StoreRow, agent: Agent, limit = 8,
): Promise<{ title: string; image: string | null; before: string | null; after: string | null }[]> {
  const { data } = await admin.from('shopify_catalog_drafts')
    .select('product_gid, product_title, proposal')
    .eq('store_id', store.id).eq('agent', agent).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(limit)
  const rows: any[] = data || []
  if (!rows.length) return []
  const images: Record<string, string> = {}
  try {
    const ids = rows.map((r) => r.product_gid).filter(Boolean)
    const d: any = await shopifyGraphql(store.shop_domain, tokenFor(store), PRODUCT_IMAGES_QUERY, { ids })
    for (const n of (d?.nodes || [])) if (n?.id && n?.featuredImage?.url) images[n.id] = n.featuredImage.url
  } catch { /* images optional */ }
  const ba = (p: any): { before: string | null; after: string | null } => {
    if (!p) return { before: null, after: null }
    if (p.title && p.description) return { before: stripHtml(p.title.current, 80) || null, after: stripHtml(p.title.proposed, 80) }  // seo → show the title change
    return { before: stripHtml(p.current, 120) || null, after: stripHtml(p.proposed, 120) || null }
  }
  return rows.map((r) => ({ title: r.product_title, image: images[r.product_gid] || null, ...ba(r.proposal) }))
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
const COLLECTION_UPDATE = /* GraphQL */ `
  mutation($input: CollectionInput!) {
    collectionUpdate(input: $input) { collection { id } userErrors { field message } }
  }
`
// Pages have no native `seo` input — SEO title/description live in the global.title_tag / description_tag
// metafields, which Shopify reads for the page's search snippet. metafieldsSet works for any owner gid.
const METAFIELDS_SET = /* GraphQL */ `
  mutation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }
`

async function productUpdate(shop: string, token: string, input: any): Promise<void> {
  const d = await shopifyGraphql(shop, token, PRODUCT_UPDATE, { input })
  const errs = d?.productUpdate?.userErrors || []
  if (errs.length) throw new Error(errs.map((e: any) => e.message).join('; '))
}

async function applyOne(shop: string, token: string, row: any): Promise<void> {
  const pr = row.proposal || {}
  if (row.agent === 'seo') {
    await productUpdate(shop, token, { id: row.product_gid, seo: { title: pr.title?.proposed, description: pr.description?.proposed } })
  } else if (row.agent === 'description') {
    await productUpdate(shop, token, { id: row.product_gid, descriptionHtml: pr.proposed })
  } else if (row.agent === 'title') {
    await productUpdate(shop, token, { id: row.product_gid, title: pr.proposed })
  } else if (row.agent === 'tags') {
    await productUpdate(shop, token, { id: row.product_gid, tags: String(pr.proposed || '').split(',').map((t: string) => t.trim()).filter(Boolean) })
  } else if (row.agent === 'collection') {
    const input: any = { id: row.product_gid, descriptionHtml: pr.body?.proposed, seo: { title: pr.title?.proposed, description: pr.description?.proposed } }
    const d = await shopifyGraphql(shop, token, COLLECTION_UPDATE, { input })
    const errs = d?.collectionUpdate?.userErrors || []
    if (errs.length) throw new Error(errs.map((e: any) => e.message).join('; '))
  } else if (row.agent === 'page') {
    // Set the page's SEO title + meta description via global metafields (never touch the page body).
    const metafields = [
      pr.title?.proposed && { ownerId: row.product_gid, namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: String(pr.title.proposed).slice(0, 70) },
      pr.description?.proposed && { ownerId: row.product_gid, namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: String(pr.description.proposed).slice(0, 320) },
    ].filter(Boolean)
    if (!metafields.length) return
    const d = await shopifyGraphql(shop, token, METAFIELDS_SET, { metafields })
    const errs = d?.metafieldsSet?.userErrors || []
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
      else if (r.agent === 'title') patch.title = r.proposal?.proposed
      else if (r.agent === 'tags') patch.tags = r.proposal?.proposed
      else if (r.agent === 'alt') patch.images_missing_alt = 0
    }
    // collection drafts have no product-cache row (product_gid is a Collection gid) — skip the update.
    if (Object.keys(patch).length && String(gid).includes('/Product/')) await admin.from('shopify_products').update(patch).eq('store_id', store.id).eq('gid', gid)
  }
  // Log the move to the Wins Ledger (the revenue game's record). Projected € stays null — catalog fixes
  // compound into organic revenue, which the proof loop banks later from real order attribution.
  if (applied > 0) {
    try {
      const { recordWin } = await import('@/lib/mello/wins')
      await recordWin(admin, { userId: store.user_id, brandId: store.brand_id, category: 'catalog', title: `Fixed ${applied} catalog ${applied === 1 ? 'gap' : 'gaps'}`, detail: 'Product SEO / titles / alt text / collections', currency: store.currency, meta: { store_id: store.id, applied } })
    } catch { /* ledger optional */ }
  }
  return { applied, failed }
}

/**
 * Undo applied catalog fixes: for every draft (user, agent) still marked 'applied', write the ORIGINAL
 * value (proposal.current) back to Shopify. Works from the drafts' own store_id — NOT the active brand
 * — so an undo always targets the exact store the change landed on, even if brand resolution is off.
 */
export async function revertAppliedDrafts(admin: any, userId: string, agent: Agent): Promise<{ reverted: number; failed: number; stores: { name: string; domain: string }[] }> {
  const { data } = await admin.from('shopify_catalog_drafts').select('*').eq('user_id', userId).eq('agent', agent).eq('status', 'applied')
  const rows: any[] = data || []
  if (!rows.length) return { reverted: 0, failed: 0, stores: [] }
  const byStore = new Map<string, any[]>()
  for (const r of rows) { if (!byStore.has(r.store_id)) byStore.set(r.store_id, []); byStore.get(r.store_id)!.push(r) }
  let reverted = 0, failed = 0
  const stores: { name: string; domain: string }[] = []
  for (const [storeId, group] of Array.from(byStore.entries())) {
    const { data: st } = await admin.from('shopify_stores').select('*').eq('id', storeId).maybeSingle()
    if (!st) { failed += group.length; continue }
    const token = tokenFor(st)
    stores.push({ name: st.shop_name || st.shop_domain, domain: st.shop_domain })
    for (const row of group) {
      try {
        const pr = row.proposal || {}
        if (agent === 'description') await productUpdate(st.shop_domain, token, { id: row.product_gid, descriptionHtml: pr.current || '' })
        else if (agent === 'title') await productUpdate(st.shop_domain, token, { id: row.product_gid, title: pr.current || '' })
        else if (agent === 'tags') await productUpdate(st.shop_domain, token, { id: row.product_gid, tags: String(pr.current || '').split(',').map((t: string) => t.trim()).filter(Boolean) })
        else if (agent === 'seo') await productUpdate(st.shop_domain, token, { id: row.product_gid, seo: { title: pr.title?.current || null, description: pr.description?.current || null } })
        else continue
        await admin.from('shopify_catalog_drafts').update({ status: 'reverted' }).eq('id', row.id)
        reverted++
      } catch { failed++ }
    }
  }
  return { reverted, failed, stores }
}
