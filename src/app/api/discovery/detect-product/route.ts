/**
 * Product auto-detect from a website URL — the "paste your site, we figure out your product" input
 * for the ad-clone flow (Atria-style). Fetches the page, extracts the brand name, likely product
 * images (og:image, product schema, large <img>s), and brand colors (theme-color, logo hints).
 * POST { url } → { brandName, images: [url], colors: [hex] }. Best-effort; the user can still upload.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

const abs = (u: string, base: string) => { try { return new URL(u, base).href } catch { return null } }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { url } = await req.json().catch(() => ({} as any))
  if (!url || typeof url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url

  let html = ''
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' }, redirect: 'follow' })
    if (!r.ok) return NextResponse.json({ error: `site returned ${r.status}` }, { status: 502 })
    html = (await r.text()).slice(0, 500_000)
  } catch (e: any) { return NextResponse.json({ error: `could not load site: ${String(e?.message || e)}` }, { status: 502 }) }

  const meta = (prop: string) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))
    return m?.[1] || null
  }

  const brandName = meta('og:site_name')
    || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').split(/[|\-–—·]/)[0].trim() || null

  // Images: og:image + product schema image + big content images. Dedup, absolutize, cap.
  const imgs = new Set<string>()
  const push = (u?: string | null) => { const a = u && abs(u, url); if (a && !/sprite|icon|logo|favicon|pixel|1x1/i.test(a)) imgs.add(a) }
  push(meta('og:image'))
  for (const m of html.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) push(m[1])                 // JSON-LD product image
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1])
  const images = Array.from(imgs).slice(0, 12)

  // Colors: theme-color + any hex colors in inline styles/CSS vars (rough brand palette).
  const colors = new Set<string>()
  const tc = meta('theme-color'); if (tc && /^#?[0-9a-f]{3,8}$/i.test(tc)) colors.add(tc.startsWith('#') ? tc : '#' + tc)
  for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) { colors.add('#' + m[1].toLowerCase()); if (colors.size >= 8) break }

  return NextResponse.json({ brandName, images, colors: Array.from(colors).slice(0, 6), source: url })
}
