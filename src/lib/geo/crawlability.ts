/**
 * GEO Crawlability & Entity (Phase C) — generate the files + markup that make a brand readable + citable
 * by AI answer engines:
 *   • llms.txt      — the plain-text brief AI crawlers read (who you are, what you sell, key links)
 *   • schema        — JSON-LD Organization/Product structured data for the site <head>
 *   • fact_sheet    — the canonical facts AI should know + cite (the Entity/Authority anchor)
 *
 * Built from the REAL brand understanding (describeBrand — Meta ads/site/competitors, or the founder's
 * override) + the brand's products. LLMs.txt + schema are DETERMINISTIC (no LLM, no invented facts); the
 * fact sheet uses one LLM call with a template fallback. Stored as drafts in geo_assets (kind), copy-to-apply
 * now; auto-apply to the Shopify theme later. Honest: only uses data we actually have.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeBrand } from './understand'
import type { GeoAsset } from './content'

export type CrawlKind = 'llms_txt' | 'schema' | 'fact_sheet'

type Product = { name: string; description: string; price?: string }

export async function buildCrawlAsset(admin: SupabaseClient, userId: string, brandId: string | null, kind: CrawlKind): Promise<GeoAsset> {
  const u = await describeBrand(admin, userId, brandId)
  const brandName = u?.brandName || 'Your brand'
  const website = (u?.website || '').replace(/\/+$/, '')
  const category = u?.category || ''
  const description = u?.description || category || ''
  const competitors = u?.competitors || []

  // Prefer the CONNECTED Shopify catalog (real products) — brand_products is often empty for Shopify-door
  // brands, which is why llms.txt/schema/fact-sheet came out with just the brand name and no products.
  let products: Product[] = []
  try {
    const { resolveStore } = await import('@/lib/shopify/client')
    const store = await resolveStore(admin as any, userId, brandId).catch(() => null)
    if (store) {
      const { data } = await (admin as any).from('shopify_products')
        .select('title, body_html, price_min, product_type').eq('store_id', store.id).limit(20)
      const cur = (store as any).currency ? String((store as any).currency) : ''
      products = ((data || []) as any[]).map((p) => ({
        name: p.title || '',
        description: String(p.body_html || p.product_type || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
        price: p.price_min != null ? `${cur ? cur + ' ' : ''}${p.price_min}`.trim() : '',
      })).filter((p) => p.name)
    }
  } catch { /* Shopify optional */ }
  // Fallback: brand_products (funnel/onboarding brands with no Shopify connection).
  if (!products.length) {
    try {
      if (brandId) { const { data } = await (admin as any).from('brand_products').select('name, description, price').eq('brand_id', brandId).limit(12); products = ((data || []) as any[]).map((p) => ({ name: p.name || '', description: (p.description || '').slice(0, 200), price: p.price || '' })).filter((p) => p.name) }
    } catch { /* ignore */ }
  }

  let title = '', body = ''
  if (kind === 'llms_txt') { title = 'llms.txt'; body = buildLlmsTxt(brandName, description, category, website, products) }
  else if (kind === 'schema') { title = 'Organization schema (JSON-LD)'; body = buildSchema(brandName, description, website, products) }
  else { title = `${brandName} — AI fact sheet`; body = await buildFactSheet(brandName, description, category, website, competitors, products) }

  let id: string | null = null
  try {
    const { data } = await (admin as any).from('geo_assets').insert({ brand_id: brandId, user_id: userId, kind, title, target_prompt: kind, body_markdown: body, status: body ? 'draft' : 'failed' }).select('id').maybeSingle()
    id = data?.id ? String(data.id) : null
  } catch { /* best-effort */ }
  return { id, kind, title, target_prompt: kind, body_markdown: body, status: body ? 'draft' : 'failed', published_url: null }
}

// ── llms.txt — the file AI crawlers read to understand your site ──
function buildLlmsTxt(brand: string, description: string, category: string, website: string, products: Product[]): string {
  const lines: string[] = []
  lines.push(`# ${brand}`, '')
  if (description) lines.push(`> ${description}`, '')
  if (category) lines.push(`${brand} is a ${category} brand.`, '')
  if (products.length) {
    lines.push('## Products', '')
    for (const p of products.slice(0, 10)) lines.push(`- **${p.name}**${p.description ? ` — ${p.description}` : ''}${p.price ? ` (${p.price})` : ''}`)
    lines.push('')
  }
  if (website) lines.push('## Links', '', `- Website: ${website}`, '')
  lines.push(`<!-- Place this file at ${website || 'https://yourdomain.com'}/llms.txt so AI answer engines (ChatGPT, Perplexity, Gemini) can read and cite ${brand}. -->`)
  return lines.join('\n')
}

// ── JSON-LD Organization (+ Product) schema for the site <head> ──
function buildSchema(brand: string, description: string, website: string, products: Product[]): string {
  const org: any = { '@context': 'https://schema.org', '@type': 'Organization', name: brand }
  if (website) org.url = website
  if (description) org.description = description
  if (products.length) {
    org.makesOffer = products.slice(0, 10).map((p) => ({ '@type': 'Offer', itemOffered: { '@type': 'Product', name: p.name, ...(p.description ? { description: p.description } : {}) }, ...(p.price ? { price: p.price } : {}) }))
  }
  const json = JSON.stringify(org, null, 2)
  return `Paste this into your site's <head> (or Shopify theme.liquid) so search + AI engines read your brand as structured data:\n\n<script type="application/ld+json">\n${json}\n</script>`
}

// ── brand fact sheet — the canonical facts AI should cite ──
async function buildFactSheet(brand: string, description: string, category: string, website: string, competitors: string[], products: Product[]): Promise<string> {
  try {
    const { llm } = await import('@/lib/llm')
    const sys = `Write a concise "AI fact sheet" for this brand — the canonical facts an AI answer engine should know and cite when recommending it. Clean Markdown, ~300–450 words: a one-line definition, who it's for, 4–6 factual bullet points about the product/category, and a short "why it's a good answer" paragraph. HARD RULE: use ONLY the facts provided — do NOT invent statistics, prices, awards, or claims. Where a precise fact isn't given, stay general and truthful.`
    const facts = JSON.stringify({ brand, category, description, website: website || undefined, products: products.length ? products : undefined, competitors: competitors.length ? competitors : undefined })
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 900, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\nFACTS:\n${facts}` }] })
    const txt = res?.content?.[0]?.text || ''
    if (txt.trim()) return txt.trim()
  } catch { /* fall through to template */ }
  // deterministic fallback
  const lines = [`# ${brand} — AI Fact Sheet`, '']
  if (description) lines.push(`**What it is:** ${description}`)
  if (category) lines.push(`**Category:** ${category}`)
  if (website) lines.push(`**Website:** ${website}`)
  if (products.length) { lines.push('', '## Products'); for (const p of products.slice(0, 8)) lines.push(`- **${p.name}**${p.description ? ` — ${p.description}` : ''}`) }
  return lines.join('\n')
}
