/**
 * Admin Countries API — manage the list of countries to crawl, plus the on/off
 * switch for multi-country crawling. Stored as a single config row in
 * discovery_crawl_terms (term='__crawl_countries__', term_type='config') so no
 * schema migration is needed. `countries` = the list, `is_active` = crawling on.
 *
 * GET   — { countries: string[], enabled: boolean }
 * PATCH — body { countries?: string[], enabled?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const CONFIG_TERM = '__crawl_countries__'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function readConfig(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from('discovery_crawl_terms')
    .select('id, countries, is_active')
    .eq('term', CONFIG_TERM)
    .eq('term_type', 'config')
    .maybeSingle()
  return data
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const cfg = await readConfig(admin)
  return NextResponse.json({
    countries: (cfg?.countries as string[]) || [],
    enabled: !!cfg?.is_active,
  })
}

export async function PATCH(request: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await request.json().catch(() => ({}))

  const patch: Record<string, unknown> = {}
  if (Array.isArray(body.countries)) {
    // normalize to upper-case 2-letter codes, dedup
    patch.countries = Array.from(new Set(
      body.countries
        .map((c: unknown) => String(c).trim().toUpperCase())
        .filter((c: string) => /^[A-Z]{2}$/.test(c))
    ))
  }
  if (typeof body.enabled === 'boolean') patch.is_active = body.enabled
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const existing = await readConfig(admin)
  if (existing) {
    const { error } = await admin.from('discovery_crawl_terms').update(patch).eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    const { error } = await admin.from('discovery_crawl_terms').insert({
      term: CONFIG_TERM, term_type: 'config', is_active: false, ...patch,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const cfg = await readConfig(admin)
  return NextResponse.json({
    countries: (cfg?.countries as string[]) || [],
    enabled: !!cfg?.is_active,
  })
}
