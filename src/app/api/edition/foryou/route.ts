/**
 * GET /api/edition/foryou — the personal ribbon inside the public Edition.
 * "Today · For {brand}": what moved among THE READER'S watched competitors in the
 * last 48h, grounded in the same corpus the global edition reads. 401 when logged
 * out (the ForYou island simply doesn't render).
 */
import { NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

export const dynamic = 'force-dynamic'

const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }
const tally = (rows: any[], key: string) => {
  const m = new Map<string, number>()
  for (const r of rows) { const v = r?.[key]; if (v) m.set(String(v), (m.get(String(v)) || 0) + 1) }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createReadClient() as any

  const [{ data: brand }, { data: follows }] = await Promise.all([
    admin.from('brands').select('name').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    admin.from('followed_brands').select('page_id, brand_name').eq('user_id', user.id),
  ])
  const pageIds = (follows || []).map((f: any) => String(f.page_id))
  if (!pageIds.length) {
    return NextResponse.json({ brandName: brand?.name || null, lines: [], empty: true })
  }

  const since = new Date(Date.now() - 48 * 3600e3).toISOString()
  const { data: recent } = await admin
    .from('discovery_ads_index')
    .select('ad_id, page_id, page_name, hook_type, format_style, created_at')
    .in('page_id', pageIds)
    .gte('created_at', since)
    .limit(400)
  const rows: any[] = recent || []

  // Resolve display names once (never show a bare page id)
  const names = new Map<string, string>()
  for (const f of follows as any[]) if (!isBlankName(f.brand_name)) names.set(String(f.page_id), f.brand_name)
  const need = pageIds.filter((id: string) => !names.has(id))
  if (need.length) {
    const r = await resolveBrandNames(admin, need)
    for (const [id, nm] of Array.from(r.entries())) names.set(String(id), nm)
  }

  const lines: { text: string; href: string }[] = []
  const perBrand = tally(rows, 'page_id')
  for (const [pid, n] of perBrand.slice(0, 3)) {
    let nm = names.get(pid)
    if (isBlankName(nm)) nm = rows.find((r) => String(r.page_id) === pid && !isBlankName(r.page_name))?.page_name
    if (isBlankName(nm)) continue
    lines.push({ text: `${nm} launched ${n} new ad${n === 1 ? '' : 's'} in the last 48 hours`, href: `/knowledge/brand/${pid}` })
  }
  const topHook = tally(rows, 'hook_type')[0]
  if (topHook && topHook[1] >= 3) {
    lines.push({
      text: `Your competitors' most-used hook right now: ${topHook[0]} (${topHook[1]} of their new ads)`,
      href: `/discovery?hook=${encodeURIComponent(topHook[0])}&days=7&sort=recommended`,
    })
  }
  if (!lines.length) {
    lines.push({ text: 'Your watched brands were quiet in the last 48 hours — that itself is a signal.', href: '/discovery/following' })
  }
  return NextResponse.json({ brandName: brand?.name || null, lines, empty: false })
}
