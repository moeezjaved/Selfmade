/**
 * Blog / Answer-content agent — the deep, Ryze-grade content engine. It grounds every article in TWO real
 * sources: the brand's understanding (describeBrand — what the products actually are, who they're for, the
 * real competitors) and the LIVE Shopify catalog (real product titles, prices, URLs). From that it writes a
 * buyer-intent article with Buy/Consider/Skip verdicts on REAL products, a deep FAQ, and clean structure —
 * then generates a hero image and (on approval) publishes to the store's Shopify blog.
 *
 * Draft-first + honest: drafts live in geo_assets (kind='blog'); nothing publishes until the founder approves.
 * The prompt forbids invented stats/prices/claims — verdicts must reference products we actually pulled.
 */
import { llm } from '@/lib/llm'
import { describeBrand } from '@/lib/geo/understand'
import { generateImage, geminiEnabled } from '@/lib/gemini/image'
import { uploadBufferToR2 } from '@/lib/r2'
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'

export type Pick = { product: string; verdict: 'Buy' | 'Consider' | 'Skip'; why: string; price?: string | null; url?: string | null }
export type Faq = { q: string; a: string }
export type Article = {
  title: string; dek: string; slug: string
  heroPrompt: string
  tldr: string[]
  sections: { heading: string; html: string }[]
  picks: Pick[]
  faq: Faq[]
  metaTitle: string; metaDescription: string; tags: string[]
}

type CatalogProduct = { title: string; type?: string | null; price?: string | null; url?: string | null; body?: string | null }

/** Real products from the synced catalog, with storefront URLs, to ground the article's picks. */
async function catalogForBlog(admin: any, store: StoreRow, limit = 24): Promise<CatalogProduct[]> {
  const { data } = await admin.from('shopify_products')
    .select('title, handle, product_type, price_min, body_html')
    .eq('store_id', store.id).eq('status', 'active').limit(limit)
  const base = store.shop_domain
  return (data || []).map((p: any) => ({
    title: p.title,
    type: p.product_type,
    price: p.price_min != null ? `${store.currency || ''} ${p.price_min}`.trim() : null,
    url: p.handle ? `https://${base}/products/${p.handle}` : null,
    body: p.body_html ? String(p.body_html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
  }))
}

function firstJson(text: string): any {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(t) } catch { /* noop */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)) } catch { /* noop */ } }
  return null
}

/** Suggest buyer-intent topics from what the brand actually sells (used when the founder doesn't give one). */
export async function suggestTopics(admin: any, store: StoreRow, userId: string): Promise<string[]> {
  const brand = await describeBrand(admin, userId, store.brand_id).catch(() => null)
  const cat = brand?.category || store.shop_name || 'the store'
  const sys = `Suggest 6 buyer-intent blog topics for a store in this category: "${cat}". Each should be a question or comparison a real buyer searches BEFORE purchasing (not brand-y). Return ONLY JSON: {"topics":["...","..."]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.7, messages: [{ role: 'user', content: sys }] })
    const j = firstJson(res.content?.[0]?.text || '')
    return Array.isArray(j?.topics) ? j.topics.map((t: any) => String(t)).slice(0, 6) : []
  } catch { return [] }
}

/** Write the deep article, grounded in brand understanding + the real catalog. */
export async function writeArticle(admin: any, store: StoreRow, userId: string, topic?: string, opts?: { keyword?: string }): Promise<Article | null> {
  const brand = await describeBrand(admin, userId, store.brand_id).catch(() => null)
  const products = await catalogForBlog(admin, store, 24)
  const category = brand?.category || store.shop_name || 'the store'
  const competitors = (brand?.competitors || []).slice(0, 6)
  const keyword = (opts?.keyword || '').trim()

  const seoBlock = keyword ? `
SEO TARGET KEYWORD: "${keyword}" — this article must be built to RANK for this exact keyword:
- Put the EXACT keyword in: the title (metaTitle), the article title, and the FIRST sentence of the opening answer.
- Use the keyword (and close variants) naturally 2-4 more times across the body — never stuffed.
- metaTitle ≤ 60 chars and leads with the keyword; metaDescription ≤ 155 chars, compelling, includes the keyword.
- The slug should be the keyword, hyphenated.` : ''

  const sys = `You are a senior DTC content strategist writing a buyer-intent article that ranks on Google AND gets cited by AI answer engines. You understand the product category deeply and write with real specificity — no fluff, no invented facts.

CATEGORY: ${category}
${brand?.description ? `WHAT THE BRAND DOES: ${brand.description}` : ''}
${competitors.length ? `REAL COMPETITORS: ${competitors.join(', ')}` : ''}
${seoBlock}

You will be given the store's REAL products (with prices and URLs). Rules:
- Target ONE specific buyer question${keyword ? ` — optimized to rank for "${keyword}"` : topic ? ` — the topic is: "${topic}"` : ' (pick the highest-intent question a buyer asks before purchasing)'}.
- Open with a direct, quotable one-paragraph answer (answer engines lift the first clear answer).
- Include a "TL;DR" of 3-4 sharp, scannable takeaways.
- 3-5 body sections with real substance — mechanisms, trade-offs, how to choose. Deep, not generic.
- "Top picks": recommend 2-4 of the REAL products given, each with a Buy / Consider / Skip verdict and a specific, honest reason. Use the product's real name, price, and URL. NEVER invent a product.
- A deep FAQ of 4-6 questions — the kind a knowledgeable buyer actually asks, answered specifically.
- HARD RULES: invent NO statistics, prices, study results, or product claims. Only use the prices/products given. Be fair to competitors — never trash them. Accuracy over impressiveness.
- Also write a hero image prompt: a clean, photographic scene that fits the article (no text in the image).

Return ONLY JSON:
{"title","dek","slug","heroPrompt","tldr":["..."],"sections":[{"heading","html"}],"picks":[{"product","verdict","why","price","url"}],"faq":[{"q","a"}],"metaTitle","metaDescription","tags":["..."]}
- html in sections is clean paragraph/list HTML (no headings inside — heading is separate). ~900-1400 words total.`

  const user = JSON.stringify({ real_products: products })
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 3200, temperature: 0.6, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: `${sys}\n\nREAL PRODUCTS (use these for picks; do not invent):\n${user}` }] })
    const j = firstJson(res.content?.[0]?.text || '')
    if (!j?.title || !Array.isArray(j?.sections)) return null
    return {
      title: String(j.title).slice(0, 180),
      dek: String(j.dek || '').slice(0, 300),
      slug: String(j.slug || j.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80),
      heroPrompt: String(j.heroPrompt || `Editorial photo for an article about ${category}`),
      tldr: (j.tldr || []).map((x: any) => String(x)).slice(0, 6),
      sections: (j.sections || []).map((s: any) => ({ heading: String(s.heading || ''), html: String(s.html || '') })).slice(0, 8),
      picks: (j.picks || []).map((p: any) => ({ product: String(p.product || ''), verdict: (['Buy', 'Consider', 'Skip'].includes(p.verdict) ? p.verdict : 'Consider') as Pick['verdict'], why: String(p.why || ''), price: p.price ? String(p.price) : null, url: p.url ? String(p.url) : null })).slice(0, 6),
      faq: (j.faq || []).map((f: any) => ({ q: String(f.q || ''), a: String(f.a || '') })).slice(0, 8),
      metaTitle: String(j.metaTitle || j.title).slice(0, 70),
      metaDescription: String(j.metaDescription || j.dek || '').slice(0, 320),
      tags: (j.tags || []).map((t: any) => String(t)).slice(0, 10),
    }
  } catch { return null }
}

/** Generate a hero image for the article and host it on R2. Returns a public URL or null. */
export async function generateHero(article: Article, brandName?: string): Promise<string | null> {
  if (!geminiEnabled) return null
  const prompt = `${article.heroPrompt}. Clean, modern editorial photography, natural light, high detail, no text, no logos, no watermark. Aspect 16:9.`
  try {
    const res = await generateImage(prompt, [], 'default', { aspectRatio: '16:9' })
    if (!res.ok) return null
    const buf = Buffer.from(res.dataB64, 'base64')
    const ext = res.mimeType.includes('png') ? 'png' : 'jpg'
    const key = `blog/${(brandName || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${article.slug}-${buf.length}.${ext}`
    return await uploadBufferToR2(buf, key, res.mimeType)
  } catch { return null }
}

/** Render the structured article to clean HTML for the Shopify blog body. */
export function renderArticleHtml(article: Article, heroUrl?: string | null): string {
  const parts: string[] = []
  if (heroUrl) parts.push(`<p><img src="${heroUrl}" alt="${esc(article.title)}" style="width:100%;border-radius:12px" /></p>`)
  if (article.dek) parts.push(`<p><strong>${esc(article.dek)}</strong></p>`)
  if (article.tldr.length) parts.push(`<h2>TL;DR</h2><ul>${article.tldr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)
  for (const s of article.sections) parts.push(`<h2>${esc(s.heading)}</h2>${s.html}`)
  if (article.picks.length) {
    parts.push('<h2>Top picks</h2>')
    for (const p of article.picks) {
      const name = p.url ? `<a href="${esc(p.url)}">${esc(p.product)}</a>` : esc(p.product)
      parts.push(`<p><strong>${esc(p.verdict)} — ${name}${p.price ? ` (${esc(p.price)})` : ''}.</strong> ${esc(p.why)}</p>`)
    }
  }
  if (article.faq.length) {
    parts.push('<h2>FAQ</h2>')
    for (const f of article.faq) parts.push(`<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`)
  }
  return parts.join('\n')
}

function esc(s: string): string { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

/** Publish an article to the store's Shopify blog (write_content). Creates a 'News' blog if none exists. */
export async function publishToShopifyBlog(store: StoreRow, opts: { title: string; bodyHtml: string; tags?: string[]; summaryHtml?: string; imageUrl?: string | null; author?: string }): Promise<{ articleId: number; url: string }> {
  const token = tokenFor(store)
  // Find or create a blog.
  let blog: any
  const blogs = await shopifyRest(store.shop_domain, token, 'blogs.json')
  if (blogs?.blogs?.length) blog = blogs.blogs[0]
  else blog = (await shopifyRest(store.shop_domain, token, 'blogs.json', { method: 'POST', body: { blog: { title: 'News' } } }))?.blog
  if (!blog?.id) throw new Error('Could not find or create a blog')

  const article: any = {
    title: opts.title,
    body_html: opts.bodyHtml,
    published: true,
    author: opts.author || store.shop_name || 'Editorial',
    tags: (opts.tags || []).join(', '),
  }
  if (opts.summaryHtml) article.summary_html = opts.summaryHtml
  if (opts.imageUrl) article.image = { src: opts.imageUrl }

  const created = await shopifyRest(store.shop_domain, token, `blogs/${blog.id}/articles.json`, { method: 'POST', body: { article } })
  const a = created?.article
  if (!a?.id) throw new Error('Shopify did not return the created article')
  const url = `https://${store.shop_domain}/blogs/${blog.handle}/${a.handle}`
  return { articleId: a.id, url }
}
