/**
 * Understand the brand DEEPLY before doing anything GEO — and remember it in the Company Brain.
 *
 * The old path guessed the category from a generic brand_type ('physical') → it asked about "vitamin
 * gummies" for a nicotine-free vape. This reads the REAL signals:
 *   • the brand's own products (name + description)
 *   • the brand's own ad copy + niche (from the crawl)
 *   • the brand's LANDING PAGE — we follow the ad's destination URL and actually read the page
 *   • its watched competitors (a strong category anchor)
 * then has the model state the true category + the exact terms buyers search.
 *
 * PERSISTENCE: the understanding is written to the Company Brain (company_dna, source='brand_identity')
 * so it's computed ONCE and reused by GEO, content, the strategist — anything. `fresh:true` (regenerate)
 * busts the cache and re-reads the site.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwnPageId } from '@/lib/mello/own-brand'

export type BrandUnderstanding = {
  brandName: string
  category: string          // plain-words product category, e.g. "nicotine-free vape / quit-vaping aid"
  description: string       // one line: what it is + who it's for
  buyerTerms: string[]      // the words buyers actually search
  competitors: string[]
  website?: string | null
}

export async function describeBrand(admin: SupabaseClient, userId: string, brandId: string | null, opts?: { fresh?: boolean }): Promise<BrandUnderstanding | null> {
  // ── brand row + brand_kit ──
  let brandName = '', kitCategory = '', kitWebsite = ''
  try {
    let q = (admin as any).from('brands').select('name, brand_type, brand_kit')
    q = brandId ? q.eq('id', brandId) : q.eq('user_id', userId).order('created_at', { ascending: false })
    const { data } = await q.limit(1).maybeSingle()
    if (!data?.name) return null
    brandName = String(data.name)
    kitCategory = data.brand_kit?.category ? String(data.brand_kit.category) : ''
    kitWebsite = data.brand_kit?.website || data.brand_kit?.url || ''
  } catch { return null }

  // competitors are cheap + can change → always fetched fresh (a strong category anchor)
  const competitors = await loadCompetitors(admin, userId, brandId)

  // reuse the remembered understanding unless asked for a fresh read
  if (!opts?.fresh) {
    const cached = await readCache(admin, userId, brandId)
    if (cached) return { brandName, ...cached, competitors }
  }

  // ── products (a strong signal — "nicotine-free vape" lives here) ──
  let products: { name: string; description: string }[] = []
  try {
    if (brandId) { const { data } = await (admin as any).from('brand_products').select('name, description').eq('brand_id', brandId).limit(6); products = ((data || []) as any[]).map((p) => ({ name: p.name || '', description: (p.description || '').slice(0, 300) })).filter((p) => p.name || p.description) }
  } catch { /* ignore */ }

  // ── own ads/site found by matching the brand NAME — UNVERIFIED (a common name like "Aura" matches many
  //    different brands), so we label them and let the competitors/products (brand-scoped truth) override. ──
  let adCopy: string[] = [], nameResolvedUrl = ''
  try {
    const ownPageId = await resolveOwnPageId(admin, brandName)
    if (ownPageId) {
      const { data } = await (admin as any).from('discovery_ads_index')
        .select('title, link_url, performance_score').eq('page_id', ownPageId)
        .order('performance_score', { ascending: false, nullsFirst: false }).limit(20)
      const ads = (data || []) as any[]
      adCopy = ads.map((a) => a.title).filter(Boolean).slice(0, 6)
      nameResolvedUrl = mostCommonUrl(ads.map((a) => a.link_url).filter(Boolean))
    }
  } catch { /* ignore */ }

  // ── READ THE LANDING PAGE — prefer the founder-set URL (verified); else the name-matched one (unverified). ──
  const verifiedSite = kitWebsite ? await readLanding(kitWebsite) : null
  const unverifiedSite = !verifiedSite && nameResolvedUrl ? await readLanding(nameResolvedUrl) : null
  const landingUrl = kitWebsite || nameResolvedUrl || null

  // ── have the model state the TRUE category — trusting the brand-scoped signals over name-matched ones ──
  const signals = {
    brand: brandName, category_hint: kitCategory || undefined,
    products: products.length ? products : undefined,                                  // TRUSTED (brand-scoped)
    competitor_brands: competitors.length ? competitors : undefined,                   // MOST TRUSTED (brand-scoped)
    verified_website: verifiedSite ? { title: verifiedSite.title, text: verifiedSite.text } : undefined,
    unverified_website_matched_by_name: unverifiedSite ? { title: unverifiedSite.title, text: unverifiedSite.text } : undefined,
    unverified_ad_headlines_matched_by_name: adCopy.length ? adCopy : undefined,
  }
  let category = kitCategory || '', description = '', buyerTerms: string[] = []
  try {
    const { llm } = await import('@/lib/llm')
    const sys = `Identify what this brand ACTUALLY sells. Signal reliability, HIGH → LOW:
1) competitor_brands and products — the founder's OWN confirmed data. TRUST THESE MOST.
2) verified_website, category_hint.
3) anything prefixed "unverified" was found by matching the brand NAME and may belong to a DIFFERENT company with the same name — if it conflicts with the competitors/products, IGNORE it entirely.
If the competitors are nicotine/vaping brands, the category is nicotine/vaping — do NOT say "supplements" or "vitamins". Return ONLY JSON:
{"category":"plain-words product category (e.g. 'nicotine-free vape / quit-vaping aid')","description":"one line: what it is and who buys it","buyer_terms":["the exact words/phrases a buyer types — 5-8 of them"]}`
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.2, messages: [{ role: 'user', content: `${sys}\n\nSIGNALS:\n${JSON.stringify(signals)}` }] })
    const txt = res?.content?.[0]?.text || ''
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    if (parsed?.category) category = String(parsed.category)
    if (parsed?.description) description = String(parsed.description)
    if (Array.isArray(parsed?.buyer_terms)) buyerTerms = parsed.buyer_terms.map((t: any) => String(t)).filter(Boolean).slice(0, 8)
  } catch { /* keep whatever we resolved from signals */ }

  const understanding: Omit<BrandUnderstanding, 'brandName' | 'competitors'> = { category: category || 'this product', description, buyerTerms, website: landingUrl || null }
  await writeCache(admin, userId, brandId, understanding)   // remember it in the Company Brain
  return { brandName, competitors, ...understanding }
}

// ── landing page reader ──
async function readLanding(url: string): Promise<{ text: string; title: string; description: string } | null> {
  try {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const r = await fetch(full, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) })
    const html = (await r.text()).slice(0, 300_000)
    const grab = (re: RegExp) => re.exec(html)?.[1]?.trim() || ''
    const title = grab(/<title[^>]*>([^<]{0,200})/i)
    const description = grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})/i) || grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500)
    if (!text && !description && !title) return null
    return { text, title, description }
  } catch { return null }
}

function mostCommonUrl(urls: string[]): string {
  if (!urls.length) return ''
  const byDomain = new Map<string, string>()
  const count = new Map<string, number>()
  for (const u of urls) {
    try { const d = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); count.set(d, (count.get(d) || 0) + 1); if (!byDomain.has(d)) byDomain.set(d, u) } catch { /* skip */ }
  }
  let best = '', top = 0
  count.forEach((n, d) => { if (n > top) { top = n; best = d } })
  return byDomain.get(best) || urls[0]
}

async function loadCompetitors(admin: SupabaseClient, userId: string, brandId: string | null): Promise<string[]> {
  try {
    const { data } = await (admin as any).from('followed_brands').select('brand_name, brand_id').eq('user_id', userId)
    const names = ((data || []) as any[])
      .filter((r) => r.brand_name && (!brandId || !r.brand_id || String(r.brand_id) === brandId))
      .map((r) => String(r.brand_name)).filter((n) => n && !/^\d+$/.test(n))
    return Array.from(new Set(names)).slice(0, 12)
  } catch { return [] }
}

// ── Company Brain cache (company_dna, source='brand_identity') ──
type Cached = { category: string; description: string; buyerTerms: string[]; website?: string | null }

async function readCache(admin: SupabaseClient, userId: string, brandId: string | null): Promise<Cached | null> {
  try {
    let q = (admin as any).from('company_dna').select('rule').eq('user_id', userId).eq('source', 'brand_identity').eq('active', true)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!data?.rule) return null
    const j = JSON.parse(data.rule)
    return { category: j.c || 'this product', description: j.d || '', buyerTerms: Array.isArray(j.t) ? j.t : [], website: j.w || null }
  } catch { return null }
}

async function writeCache(admin: SupabaseClient, userId: string, brandId: string | null, u: Cached): Promise<void> {
  try {
    // dedupe: drop prior identity rows for this brand before writing the fresh one
    let del = (admin as any).from('company_dna').delete().eq('user_id', userId).in('source', ['brand_identity', 'brand_identity_readable'])
    if (brandId) del = del.eq('brand_id', brandId)
    await del
  } catch { /* ignore */ }
  const compact = JSON.stringify({ c: u.category, d: (u.description || '').slice(0, 160), t: u.buyerTerms.slice(0, 6), w: u.website || undefined })
  try {
    await (admin as any).from('company_dna').insert([
      { user_id: userId, brand_id: brandId, rule: compact.slice(0, 400), source: 'brand_identity', created_by: 'mello', active: true, priority: 'normal' },
      { user_id: userId, brand_id: brandId, rule: `This brand sells ${u.description || u.category}. Category: ${u.category}.`.slice(0, 400), source: 'brand_identity_readable', created_by: 'mello', active: true, priority: 'high' },
    ])
  } catch { /* best-effort — understanding still returns; it just isn't remembered */ }
}
