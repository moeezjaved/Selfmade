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

  // ── Colors ──────────────────────────────────────────────────────────────
  const colors = new Set<string>()
  const tc = meta('theme-color'); if (tc && /^#?[0-9a-f]{3,8}$/i.test(tc)) colors.add((tc.startsWith('#') ? tc : '#' + tc).toLowerCase())
  const colorCount = new Map<string, number>()
  for (const m of Array.from(html.matchAll(/#([0-9a-fA-F]{6})\b/g))) {
    const hex = '#' + m[1].toLowerCase()
    if (/^#(fff|000)/.test(hex) && hex !== '#ffffff' && hex !== '#000000') { /* keep */ }
    colorCount.set(hex, (colorCount.get(hex) || 0) + 1)
  }
  // Most-used hex colors = likely the brand palette.
  Array.from(colorCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([h]) => colors.add(h))

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
  return NextResponse.json({
    brandName, images, colors: colorList, fonts, shopify,
    brandKit: { colors: colorList, fonts },
    source: url,
  })
}
