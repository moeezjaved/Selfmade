/**
 * Ads-studio store context — how we get Lapis-level accuracy ("they even detected we sell in Pakistan").
 * We crawl the real store (home + about/contact + a sample of product pages), pull hard SIGNALS
 * (currency, payment methods like cash-on-delivery, city/country mentions, language, phone code, prices),
 * then ground an LLM on those signals to produce the detected market + rich ICP audiences. Same recipe
 * behind Lapis's audiences — the geography isn't guessed, it's read off the site and handed to the model.
 */
import { fetchHtml } from '@/lib/seo/crawl-audit'
import { llm } from '@/lib/llm'

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', ndash: '–', mdash: '—' }
const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return _ } })
  .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)) } catch { return _ } })
  .replace(/&([a-z]+);/gi, (_, n) => NAMED[n.toLowerCase()] ?? _)
// Strip <script>/<style> FIRST — otherwise minified JS (the word "try", "classList.add", etc.)
// leaks into currency/geo signal detection and hallucinates the wrong market.
const strip = (h: string) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const tag = (html: string, re: RegExp) => { const m = html.match(re); return m ? decode(m[1]).trim() : '' }
const abs = (l: string, domain: string) => (l.startsWith('http') ? l : `https://${domain}${l.startsWith('/') ? '' : '/'}${l}`)

const RAW_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
// fetchHtml() gates on content-type:text/html, so it returns null for robots.txt (text/plain) and XML
// sitemaps — we need those to discover products on non-Shopify stores, so fetch their raw bodies here.
async function fetchRaw(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': RAW_UA, accept: '*/*' }, signal: AbortSignal.timeout(8000), redirect: 'follow' })
    if (!r.ok) return null
    return (await r.text()).slice(0, 600_000)
  } catch { return null }
}

// Cross-platform product discovery via the store's sitemap — the Shopify-only `/products/` link scrape
// finds nothing on BigCommerce / WooCommerce / Magento / custom builds, but nearly every real store
// publishes a sitemap. Prefer a product-named sub-sitemap; return up to `cap` product page URLs.
async function sitemapProductUrls(domain: string, cap = 14): Promise<string[]> {
  const root = domain.replace(/^www\./, '')
  const locs = (xml: string) => Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => decode(m[1]).trim())
  const BADSM = /(categor|collection|blog|image|static|page|post|policy|policies|brand|author|tag)/i
  // 1) Sitemap URLs: robots.txt `Sitemap:` lines win; else the conventional /sitemap.xml.
  let sitemaps: string[] = []
  const robots = await fetchRaw(`https://${domain}/robots.txt`)
  if (robots) sitemaps = Array.from(robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)).map((m) => m[1].trim())
  if (!sitemaps.length) sitemaps = [`https://${domain}/sitemap.xml`]
  // 2) Expand any sitemap INDEX into the child sitemaps most likely to hold products.
  const productSitemaps: string[] = []
  for (const sm of sitemaps.slice(0, 3)) {
    const xml = await fetchRaw(sm); if (!xml) continue
    if (/<sitemapindex/i.test(xml)) {
      const children = locs(xml)
      const named = children.filter((c) => /product/i.test(c))
      const good = named.length ? named : children.filter((c) => !BADSM.test(c))
      ;(good.length ? good : children).slice(0, 3).forEach((c) => productSitemaps.push(c))
    } else {
      productSitemaps.push(sm)   // a flat <urlset> — use it directly
    }
  }
  // 3) Collect product page URLs from those sitemaps (skip asset/non-page locs).
  const urls: string[] = []
  const seen = new Set<string>()
  for (const psm of productSitemaps.slice(0, 4)) {
    const xml = await fetchRaw(psm); if (!xml) continue
    for (const u of locs(xml)) {
      if (urls.length >= cap) break
      if (!u.includes(root) || seen.has(u)) continue
      if (/\.(xml|jpe?g|png|webp|gif|svg|pdf|css|js)(\?|#|$)/i.test(u)) continue
      seen.add(u); urls.push(u)
    }
    if (urls.length >= cap) break
  }
  return urls
}

export type StoreProduct = { title: string; image: string | null; price: string | null; url: string }
export type StoreContext = { domain: string; siteName: string; description: string; products: StoreProduct[]; signals: string[] }

function productLinks(html: string, domain: string): string[] {
  const root = domain.replace(/^www\./, '')
  const links = Array.from(html.matchAll(/href=["']([^"']*\/products\/[^"'?#]+)/gi)).map((m) => abs(m[1], domain)).filter((u) => u.includes(root))
  return Array.from(new Set(links))
}
const slugName = (url: string) => { try { const s = new URL(url).pathname.split('/').filter(Boolean).pop() || ''; return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) } catch { return '' } }

function parseProduct(url: string, html: string): StoreProduct {
  const title = strip(tag(html, /<title[^>]*>([^<]{0,140})/i)).replace(/\s*[|–—-].*$/, '').trim() || slugName(url) || 'Product'
  let image = tag(html, /property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || tag(html, /name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
  if (image && image.startsWith('//')) image = 'https:' + image
  const cur = tag(html, /"priceCurrency"\s*:\s*"([A-Z]{3})"/i)
  // Prefer the JSON-LD offer price — it's authoritative and ALWAYS in major units, integer ("619" = ₹619)
  // or decimal, so we must NOT treat its bare integers as cents. We match a "price" that sits with the
  // priceCurrency in the same offers block (either order) so a stray Shopify cents value elsewhere on the
  // page can't win. Only when there's no JSON-LD currency do we fall back to the Shopify JS-money reading,
  // where an integer with no decimal point IS cents (e.g. 994800 = 9948.00).
  const ld = html.match(/"priceCurrency"\s*:\s*"[A-Z]{3}"[\s\S]{0,240}?"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i)
    || html.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,240}?"priceCurrency"\s*:\s*"[A-Z]{3}"/i)
  const priceRaw = ld?.[1]
    || tag(html, /property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([0-9.]+)/i)
    || tag(html, /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i)
  const major = !!ld || /[.]/.test(priceRaw || '')   // JSON-LD or any decimal ⇒ already major units
  let price: string | null = null
  if (priceRaw) {
    const val = major ? parseFloat(priceRaw) : parseInt(priceRaw, 10) / 100
    const num = val % 1 === 0 ? String(val) : val.toFixed(2)
    price = `${cur ? cur + ' ' : ''}${num}`
  }
  return { title, image: image || null, price, url }
}

/** Hard signals for GLOBAL market detection — currency, payment, geography, language, contact.
 * Not region-specific: the LLM does the final geography, we just hand it the strongest cues + a raw
 * contact/about snippet so it can pin ANY market (Pakistan, Bangladesh, India, USA, Gulf, UK, EU, …). */
function extractSignals(pages: { url: string; html: string }[]): string[] {
  const blob = pages.map((p) => p.html).join(' ')
  const text = strip(blob).slice(0, 24000)
  const sig = new Set<string>()
  // Currency — the strongest single market cue. Symbols + ISO codes, worldwide.
  const curSyms: [RegExp, string][] = [
    [/৳|\bBDT\b|\bTk\.?\s?\d/i, 'currency: BDT (Bangladeshi Taka)'], [/₨|\bPKR\b|\bRs\.?\s?\d/i, 'currency: Rs/PKR'], [/₹|\bINR\b/i, 'currency: INR (India)'],
    [/\bAED\b|د\.إ/i, 'currency: AED (UAE)'], [/\bSAR\b|ر\.س|﷼/i, 'currency: SAR (Saudi)'], [/\bQAR\b/i, 'currency: QAR (Qatar)'],
    [/₦|\bNGN\b/i, 'currency: NGN (Nigeria)'], [/\bKES\b|KSh/i, 'currency: KES (Kenya)'], [/\bZAR\b|\bR\s?\d/i, 'currency: ZAR (South Africa)'],
    [/₱|\bPHP\b/i, 'currency: PHP (Philippines)'], [/Rp\s?\d|\bIDR\b/i, 'currency: IDR (Indonesia)'], [/\bMYR\b|RM\s?\d/i, 'currency: MYR (Malaysia)'], [/฿|\bTHB\b/i, 'currency: THB (Thailand)'], [/\bVND\b|₫/i, 'currency: VND (Vietnam)'],
    [/Rs\.?\s?\d|\bLKR\b/i, 'currency: LKR (Sri Lanka)'], [/\bNPR\b/i, 'currency: NPR (Nepal)'],
    [/£|\bGBP\b/i, 'currency: GBP (UK)'], [/€|\bEUR\b/i, 'currency: EUR (Eurozone)'], [/\bCAD\b|C\$/i, 'currency: CAD (Canada)'], [/\bAUD\b|A\$/i, 'currency: AUD (Australia)'], [/\bNZD\b/i, 'currency: NZD'],
    [/₺|\bTRY\b/, 'currency: TRY (Turkey)'], [/R\$|\bBRL\b/, 'currency: BRL (Brazil)'], [/\bMXN\b/, 'currency: MXN (Mexico)'], [/¥|\bJPY\b/, 'currency: JPY'], [/\bCNY\b|\bRMB\b/, 'currency: CNY'],
    [/\bUSD\b|(?<![A-Za-z])\$\s?\d/i, 'currency: USD'],
  ]
  const curs = curSyms.filter(([re]) => re.test(text)).map(([, l]) => l)
  if (curs.length) sig.add(curs.slice(0, 3).join(' / '))
  // Payment rails are strong country tells.
  const pay: [RegExp, string][] = [
    [/bkash|nagad|\brocket\b/i, 'payment: bKash/Nagad (Bangladesh)'], [/easypaisa|jazzcash/i, 'payment: Easypaisa/JazzCash (Pakistan)'],
    [/\bUPI\b|paytm|phonepe|razorpay|\bGPay\b/i, 'payment: UPI/Paytm (India)'], [/\bmada\b|tabby|tamara/i, 'payment: Mada/Tabby (Gulf)'], [/m-?pesa/i, 'payment: M-Pesa (East Africa)'],
    [/shop pay|stripe|afterpay|klarna/i, 'payment: Shop Pay/Stripe (US/global)'], [/cash[\s-]?on[\s-]?delivery|\bCOD\b/i, 'payment: cash on delivery'],
  ]
  for (const [re, l] of pay) if (re.test(text)) sig.add(l)
  const phone = text.match(/\+(\d{1,3})[\s-]?\d/); if (phone) sig.add('phone country code: +' + phone[1])
  const lang = tag(pages[0]?.html || '', /<html[^>]+lang=["']([a-z-]+)["']/i); if (lang && lang !== 'en') sig.add('site language: ' + lang)
  const ship = text.match(/ships?\s+(?:to|within|across|nationwide in)\s+([A-Za-z ,]{3,50})/i); if (ship) sig.add('shipping: ' + ship[1].trim())
  // Raw contact/about snippet — lets the LLM read the actual address/city/country for ANY market.
  const contactPage = pages.find((p) => /contact|about|shipping|policies/i.test(p.url)) || pages[0]
  const cText = strip(contactPage?.html || '')
  const addr = cText.match(/([A-Za-z0-9#,.\- ]{6,60}(?:street|st\.|road|rd\.|ave|block|sector|nagar|colony|floor|suite)[A-Za-z0-9#,.\- ]{0,50})/i)
  const near = cText.match(/(?:address|located|based|office|store)[:\s][A-Za-z0-9#,.\- ]{6,90}/i)
  const snip = (addr?.[1] || near?.[0] || '').trim()
  if (snip) sig.add('address text on site: “' + snip.slice(0, 90) + '”')
  return Array.from(sig)
}

export async function crawlStore(domain: string): Promise<StoreContext> {
  const home = (await fetchHtml(`https://${domain}/`)) || ''
  const siteName = strip(tag(home, /<title[^>]*>([^<|–-]{0,60})/i)) || domain
  const description = strip(tag(home, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i))
  let purls = productLinks(home, domain)
  if (purls.length < 4) { const coll = await fetchHtml(`https://${domain}/collections/all`); if (coll) purls = Array.from(new Set([...purls, ...productLinks(coll, domain)])) }
  // Non-Shopify stores (BigCommerce, WooCommerce, Magento, custom) expose no `/products/` links — fall
  // back to the sitemap so their catalog (and the real product photos our ads need) still gets crawled.
  if (purls.length < 4) { const sm = await sitemapProductUrls(domain); if (sm.length) purls = Array.from(new Set([...purls, ...sm])) }
  purls = purls.slice(0, 14)
  const extraPages = await Promise.all(['about', 'pages/about', 'pages/contact', 'contact', 'policies/shipping-policy'].map((p) => fetchHtml(`https://${domain}/${p}`).catch(() => null)))
  const productHtml = await Promise.all(purls.map(async (u) => ({ url: u, html: (await fetchHtml(u).catch(() => null)) || '' })))
  const products = productHtml.filter((p) => p.html).map((p) => parseProduct(p.url, p.html))
  const signalPages = [{ url: `https://${domain}/`, html: home }, ...extraPages.map((h, i) => ({ url: String(i), html: h || '' })).filter((p) => p.html), ...productHtml.slice(0, 4)]
  return { domain, siteName, description, products, signals: extractSignals(signalPages) }
}

export type Audience = { name: string; insights: string[] }
export async function generateAudiences(ctx: StoreContext): Promise<{ market: string; audiences: Audience[] }> {
  const productList = ctx.products.slice(0, 12).map((p) => p.title).join(' | ') || ctx.description
  const prompt = `You are a DTC growth strategist. Based ONLY on the real signals below from an online store, infer (1) the primary MARKET/country the store sells to, and (2) FIVE distinct target audiences.

STORE: ${ctx.siteName} (${ctx.domain})
DESCRIPTION: ${ctx.description || '(none)'}
PRODUCTS: ${productList}
HARD SIGNALS (read off the site — use these to pin the geography precisely): ${ctx.signals.join(' · ') || '(none detected)'}

Rules for MARKET: infer it from the hard signals only (currency, payment rails, phone code, address text, language, domain TLD). Could be ANY country — Bangladesh, Pakistan, India, USA, UK, UAE, Nigeria, etc. Do NOT default to any region. If signals are ambiguous or point to USD/English/Stripe with no local cues, treat it as US / global.
For each audience give a short name and EXACTLY 6 insight bullets covering: demographics (with specific geography/cities ONLY when signals support it), daily behavior, pain points, values, shopping habits (name the local payment methods you detected), and why THIS product fits them. Be concrete and grounded — never invent a market the signals contradict.
Return ONLY JSON: {"market":"...","audiences":[{"name":"...","insights":["...","...","...","...","...","..."]}]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1600, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const audiences: Audience[] = Array.isArray(j?.audiences) ? j.audiences.slice(0, 5).map((a: any) => ({ name: String(a.name || 'Audience').slice(0, 60), insights: (Array.isArray(a.insights) ? a.insights : []).map((s: any) => String(s)).slice(0, 6) })) : []
    return { market: String(j?.market || '').slice(0, 60), audiences }
  } catch { return { market: '', audiences: [] } }
}
