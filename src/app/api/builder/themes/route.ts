/**
 * GET /api/builder/themes — the connected store's themes (detected live from Shopify), so the publish
 * step can ask "which theme?" like Atlas. Returns [{ id, name, role, live }] with the published theme
 * marked live. Gracefully degrades: no store → { noStore: true }; missing theme scope → { themes: [] }.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveStore } from '@/lib/shopify/client'
import { shopifyRest, tokenFor } from '@/lib/shopify/client'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return NextResponse.json({ noStore: true, themes: [] })

  try {
    const res = await shopifyRest(store.shop_domain, tokenFor(store), 'themes.json')
    const themes = ((res?.themes || []) as any[])
      .map((t) => ({ id: t.id, name: t.name as string, role: t.role as string, live: t.role === 'main' }))
      // live theme first, then the rest by name
      .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
    return NextResponse.json({ themes })
  } catch {
    // Most likely the connection lacks read_themes — let the client fall back to a plain publish.
    return NextResponse.json({ themes: [], themeScopeMissing: true })
  }
}
