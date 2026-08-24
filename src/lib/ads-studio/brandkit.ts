/**
 * Brand Kit engine — Lapis-pattern: everything derived from the WEBSITE alone (no Shopify needed).
 *  1. Knowledge Base: crawl home/about/FAQ/policies/product pages → LLM distills ~25 atomic facts
 *     ("what we know about you") + brand voice (tone / energy / audience).
 *  2. Visual language: brand COLORS parsed from the site's real CSS (frequency-ranked, deduped,
 *     primary = most-used saturated) + TYPEFACES from font-family declarations / Google Fonts links.
 *  3. Logo: apple-touch-icon / logo <img> / favicon service fallback.
 *  4. Visual world: key page URLs the UI screenshots (mshots) — the site's own sections as reference.
 * These facts feed ad generation decisions — and later get persisted into Company Brain.
 */
import { fetchHtml } from '@/lib/seo/crawl-audit'
import { llm } from '@/lib/llm'

const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;|&apos;/gi, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/gi, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const strip = (h: string) => dec(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const tag = (html: string, re: RegExp) => { const m = html.match(re); return m ? m[1].trim() : '' }
const abs = (l: string, domain: string) => (l.startsWith('http') ? l : l.startsWith('//') ? 'https:' + l : `https://${domain}${l.startsWith('/') ? '' : '/'}${l}`)

export type BrandKitData = {
  siteName: string
  logo: string | null
  colors: { hex: string; primary: boolean }[]
  fonts: string[]
  facts: string[]
  voice: { tone: string; energy: string; audience: string } | null
  visualPages: string[]
}

/* ── colors ── */
const hex6 = (h: string) => { h = h.replace('#', '').toLowerCase(); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return h.length >= 6 ? '#' + h.slice(0, 6) : null }
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const dist = (a: string, b: string) => { const [r1, g1, b1] = rgbOf(a), [r2, g2, b2] = rgbOf(b); return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) }
const saturated = (hex: string) => { const [r, g, b] = rgbOf(hex); return Math.max(r, g, b) - Math.min(r, g, b) > 40 }

function extractColors(cssBlobs: string[]): { hex: string; primary: boolean }[] {
  const count = new Map<string, number>()
  for (const css of cssBlobs) {
    Array.from(css.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)).forEach((m) => { const h = hex6(m[0]); if (h) count.set(h, (count.get(h) || 0) + 1) })
    Array.from(css.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)).forEach((m) => {
      const h = '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')
      count.set(h, (count.get(h) || 0) + 1)
    })
  }
  const ranked = Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([h]) => h)
  const kept: string[] = []
  for (const h of ranked) { if (kept.every((k) => dist(k, h) > 60)) kept.push(h); if (kept.length >= 5) break }
  const primary = kept.find(saturated) || kept[0]
  return kept.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0)).map((hex) => ({ hex, primary: hex === primary }))
}

/* ── fonts ── */
const GENERIC = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'var'])
function extractFonts(cssBlobs: string[], html: string): string[] {
  const count = new Map<string, number>()
  const add = (name: string, w = 1) => { const n = name.trim().replace(/^["']|["']$/g, ''); if (n && n.length < 40 && !GENERIC.has(n.toLowerCase()) && !n.startsWith('--') && !/^\d/.test(n)) count.set(n, (count.get(n) || 0) + w) }
  for (const css of cssBlobs) Array.from(css.matchAll(/font-family\s*:\s*([^;}"]+)/gi)).forEach((m) => add(m[1].split(',')[0]))
  Array.from(html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([A-Za-z+%0-9]+)/gi)).forEach((m) => add(decodeURIComponent(m[1].split(':')[0]).replace(/\+/g, ' '), 5))
  Array.from(html.matchAll(/@font-face[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi)).forEach((m) => add(m[1], 3))
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)
}

/* ── logo ── */
function extractLogo(html: string, domain: string): string | null {
  const touch = tag(html, /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i) || tag(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i)
  if (touch) return abs(touch, domain)
  const imgTags = html.match(/<img[^>]*>/gi) || []
  const logoImg = imgTags.find((t) => /logo/i.test(t))
  if (logoImg) { const src = tag(logoImg, /src=["']([^"']+)["']/i); if (src && !src.startsWith('data:')) return abs(src, domain) }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
}

/* ── knowledge base (LLM over the real site text) ── */
async function generateKnowledge(siteName: string, domain: string, sections: { label: string; text: string }[]): Promise<{ facts: string[]; voice: BrandKitData['voice'] }> {
  const corpus = sections.filter((s) => s.text).map((s) => `[${s.label}]\n${s.text.slice(0, 3200)}`).join('\n\n').slice(0, 14000)
  const prompt = `You are building a brand knowledge base by reading a store's real website content. Extract what the site ACTUALLY says — never invent.

STORE: ${siteName} (${domain})
SITE CONTENT:
${corpus}

Produce:
1. "facts": 18-28 atomic facts, one sentence each, covering: positioning & what the product is, how it physically works, product variants & materials, offers/bundles/subscriptions, pricing angles, platform/checkout, use cases & who it's for, pain points it addresses, differentiation vs alternatives, marketing claims & proof (report claims as claims), brand language/mindset, outcomes promised, and anything geographic. Each fact must be traceable to the content above.
2. "voice": {"tone": one-or-two-word brand tone (e.g. "Modern", "Playful premium"), "energy": "Low"|"Medium"|"High", "audience": a short phrase naming the core audience}.

Return ONLY JSON: {"facts":["..."],"voice":{"tone":"...","energy":"...","audience":"..."}}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 2200, temperature: 0.3, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const facts = Array.isArray(j?.facts) ? j.facts.map((f: any) => String(f).trim()).filter(Boolean).slice(0, 30) : []
    const voice = j?.voice ? { tone: String(j.voice.tone || '').slice(0, 40), energy: String(j.voice.energy || '').slice(0, 12), audience: String(j.voice.audience || '').slice(0, 80) } : null
    return { facts, voice }
  } catch { return { facts: [], voice: null } }
}

export async function buildBrandKit(domain: string): Promise<BrandKitData> {
  const home = (await fetchHtml(`https://${domain}/`)) || ''
  const siteName = strip(tag(home, /<title[^>]*>([^<|–-]{0,60})/i)) || domain

  // Pages: fixed candidates + first product links off the homepage.
  const root = domain.replace(/^www\./, '')
  const prodLinks = Array.from(new Set(Array.from(home.matchAll(/href=["']([^"']*\/products\/[^"'?#]+)/gi)).map((m) => abs(m[1], domain)).filter((u) => u.includes(root)))).slice(0, 3)
  const candidates = ['pages/about', 'about', 'pages/faq', 'pages/faqs', 'pages/contact', 'policies/shipping-policy', 'pages/how-it-works']
  const extras = await Promise.all(candidates.map((p) => fetchHtml(`https://${domain}/${p}`).catch(() => null)))
  const prodHtmls = await Promise.all(prodLinks.map((u) => fetchHtml(u).catch(() => null)))

  // CSS: inline <style> blocks + up to 3 linked stylesheets.
  const cssBlobs: string[] = Array.from(home.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1].slice(0, 200000))
  const cssLinks = Array.from(home.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)).map((m) => abs(m[1], domain)).slice(0, 3)
  const linked = await Promise.all(cssLinks.map((u) => fetchHtml(u).catch(() => null)))
  linked.forEach((c) => c && cssBlobs.push(c.slice(0, 300000)))
  cssBlobs.push(home)   // style attrs + meta theme-color live in the html itself

  const sections = [
    { label: 'HOME', text: strip(home) },
    ...extras.map((h, i) => ({ label: candidates[i].toUpperCase(), text: h ? strip(h) : '' })),
    ...prodHtmls.map((h, i) => ({ label: `PRODUCT ${i + 1}`, text: h ? strip(h) : '' })),
  ]
  const { facts, voice } = await generateKnowledge(siteName, domain, sections)

  return {
    siteName,
    logo: extractLogo(home, domain),
    colors: extractColors(cssBlobs),
    fonts: extractFonts(cssBlobs, home),
    facts,
    voice,
    visualPages: [`https://${domain}/`, ...(prodLinks[0] ? [prodLinks[0]] : []), ...(extras[0] ? [`https://${domain}/${candidates[0]}`] : extras[6] ? [`https://${domain}/${candidates[6]}`] : [])].slice(0, 3),
  }
}
