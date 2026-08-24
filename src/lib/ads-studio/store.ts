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
const strip = (h: string) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const tag = (html: string, re: RegExp) => { const m = html.match(re); return m ? decode(m[1]).trim() : '' }
const abs = (l: string, domain: string) => (l.startsWith('http') ? l : `https://${domain}${l.startsWith('/') ? '' : '/'}${l}`)

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
  const priceRaw = tag(html, /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i) || tag(html, /property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([0-9.]+)/i)
  const cur = tag(html, /"priceCurrency"\s*:\s*"([A-Z]{3})"/i)
  const price = priceRaw ? `${cur ? cur + ' ' : ''}${priceRaw}` : null
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
    [/₺|\bTRY\b/i, 'currency: TRY (Turkey)'], [/R\$|\bBRL\b/i, 'currency: BRL (Brazil)'], [/\bMXN\b/i, 'currency: MXN (Mexico)'], [/¥|\bJPY\b/i, 'currency: JPY'], [/\bCNY\b|\bRMB\b/i, 'currency: CNY'],
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
