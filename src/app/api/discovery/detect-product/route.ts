/**
 * Product + Brand Kit auto-detect from a website URL — the "paste your site, we figure out your
 * brand" input for Clone. Fetches the homepage for the brand name, palette, and fonts, AND (for
 * Shopify stores) the store's /products.json for ALL product images — so we don't miss products
 * that aren't on the homepage. Best-effort; the user can still upload / edit.
 * POST { url } → { brandName, images:[url], colors:[hex], fonts:{heading,body}, brandKit }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

const abs = (u: string, base: string) => { try { return new URL(u, base).href } catch { return null } }
const JUNK = /sprite|icon|logo|favicon|pixel|1x1|placeholder|loading|spinner|badge|payment|trustbadge|\.svg(\?|$)/i

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { url } = await req.json().catch(() => ({} as any))
  if (!url || typeof url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  let origin = ''
  try { origin = new URL(url).origin } catch { return NextResponse.json({ error: 'invalid url' }, { status: 400 }) }

  const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' }
  let html = ''
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' })
    if (!r.ok) return NextResponse.json({ error: `site returned ${r.status}` }, { status: 502 })
    html = (await r.text()).slice(0, 800_000)
  } catch (e: any) { return NextResponse.json({ error: `could not load site: ${String(e?.message || e)}` }, { status: 502 }) }

  const meta = (prop: string) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))
    return m?.[1] || null
  }

  const brandName = meta('og:site_name')
    || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').split(/[|\-–—·]/)[0].trim() || null

  // ── Images ──────────────────────────────────────────────────────────────
  const imgs = new Set<string>()
  const push = (u?: string | null) => { const a = u && abs(u, url); if (a && !JUNK.test(a)) imgs.add(a.split('?')[0]) }
  push(meta('og:image'))
  Array.from(html.matchAll(/"image"\s*:\s*"([^"]+)"/gi)).forEach((m) => push(m[1]))                    // JSON-LD
  Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).forEach((m) => push(m[1]))              // <img src>
  Array.from(html.matchAll(/<img[^>]+data-src=["']([^"']+)["']/gi)).forEach((m) => push(m[1]))         // lazy
  Array.from(html.matchAll(/srcset=["']([^"']+)["']/gi)).forEach((m) => push(m[1].split(',')[0].trim().split(' ')[0])) // first srcset
  Array.from(html.matchAll(/(https?:)?\/\/cdn\.shopify\.com\/[^\s"'<>)]+\.(?:jpg|jpeg|png|webp)/gi)).forEach((m) => push(m[0])) // shopify CDN

  // Shopify /products.json → EVERY product's images (the big win for stores like shopauranow).
  let shopify = false
  try {
    const pr = await fetch(`${origin}/products.json?limit=50`, { headers: UA })
    if (pr.ok) {
      const j = await pr.json().catch(() => null) as any
      const products = j?.products || []
      if (Array.isArray(products) && products.length) {
        shopify = true
        for (const p of products) for (const im of (p.images || [])) push(im?.src)
      }
    }
  } catch { /* not shopify or blocked — fine */ }

  const images = Array.from(imgs).slice(0, 24)

  // ── Logo ────────────────────────────────────────────────────────────────
  // The real brand mark, so ads use it instead of an invented wordmark. Prefer JSON-LD org logo,
  // then <img> tagged "logo", then apple-touch-icon.
  const logos: string[] = []
  const pushLogo = (u?: string | null) => { const a = u && abs(u, url); if (a && !/pixel|1x1/i.test(a)) logos.push(a.split('?')[0]) }
  Array.from(html.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*"url"\s*:\s*"([^"]+)")/gi)).forEach((m) => pushLogo(m[1] || m[2]))
  Array.from(html.matchAll(/<img[^>]*(?:class|id|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/gi)).forEach((tag) => pushLogo(tag[0].match(/\bsrc=["']([^"']+)["']/i)?.[1]))
  pushLogo(html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i)?.[1])
  const logo = logos.find(Boolean) || null

  // ── Colors ──────────────────────────────────────────────────────────────
  // Shopify/modern sites keep brand colors in EXTERNAL CSS, so scan the linked stylesheets (+ inline
  // <style>) not just the HTML, and parse rgb()/#hex/#rgb. Frequency ranks the real brand palette.
  let css = ''
  const cssLinks = Array.from(html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi))
    .map((t) => t[0].match(/href=["']([^"']+)["']/i)?.[1]).filter(Boolean).slice(0, 4) as string[]
  await Promise.all(cssLinks.map(async (href) => {
    const a = abs(href, url); if (!a) return
    try { const r = await fetch(a, { headers: UA }); if (r.ok) css += (await r.text()).slice(0, 300_000) } catch { /* ignore */ }
  }))
  const styleText = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join(' ')
  const colorText = html + ' ' + styleText + ' ' + css

  const h2 = (n: number) => n.toString(16).padStart(2, '0')
  const norm = (hex: string) => hex.length === 4 ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex.toLowerCase()
  const colorCount = new Map<string, number>()
  const bump = (hex: string) => { const c = norm(hex); if (/^#[0-9a-f]{6}$/.test(c)) colorCount.set(c, (colorCount.get(c) || 0) + 1) }
  const tc = meta('theme-color'); if (tc && /^#?[0-9a-f]{3,8}$/i.test(tc)) bump(tc.startsWith('#') ? tc : '#' + tc)
  for (const m of Array.from(colorText.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g))) bump('#' + m[1])
  for (const m of Array.from(colorText.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi))) {
    bump('#' + h2(+m[1]) + h2(+m[2]) + h2(+m[3]))
  }
  const colors = new Set<string>()
  // Most-used colors = the brand palette (keep white/near-black too — they're real roles).
  Array.from(colorCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([h]) => colors.add(h))

  // ── Fonts ───────────────────────────────────────────────────────────────
  const fontSet: string[] = []
  const addFont = (f?: string | null) => {
    const name = (f || '').replace(/["']/g, '').split(',')[0].trim()
    if (name && !/inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system/i.test(name) && !fontSet.includes(name)) fontSet.push(name)
  }
  Array.from(html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&:]+)/gi)).forEach((m) => addFont(decodeURIComponent(m[1]).replace(/\+/g, ' ')))
  Array.from(html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)).forEach((m) => addFont(m[1]))
  const fonts = { heading: fontSet[0] || null, body: fontSet[1] || fontSet[0] || null }

  const colorList = Array.from(colors).slice(0, 6)

  // ── Named palette ─────────────────────────────────────────────────────────
  // Assign detected colors to brand roles by luminance + saturation (best-effort; editable after).
  const rgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } }
  const lum = (h: string) => { const c = rgb(h); if (!c) return 0; return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 }
  const sat = (h: string) => { const c = rgb(h); if (!c) return 0; const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx === 0 ? 0 : (mx - mn) / mx }
  const valid = colorList.filter((c) => rgb(c))
  const byLumAsc = [...valid].sort((a, b) => lum(a) - lum(b))
  const bySat = [...valid].sort((a, b) => sat(b) - sat(a))
  const accent = bySat[0] || '#1a3a1a'
  const cta = bySat.find((c) => c !== accent) || accent
  const palette = {
    background: byLumAsc[byLumAsc.length - 1] && lum(byLumAsc[byLumAsc.length - 1]) > 0.6 ? byLumAsc[byLumAsc.length - 1] : '#ffffff',
    heading: byLumAsc[0] || '#111111',
    body: byLumAsc[1] || byLumAsc[0] || '#333333',
    accent,
    cta,
    ctaText: lum(cta) < 0.5 ? '#ffffff' : '#111111',
    icon: accent,
  }

  return NextResponse.json({
    brandName, images, colors: colorList, fonts, logo, palette, shopify,
    brandKit: { colors: colorList, fonts, logo, palette },
    source: url,
  })
}
