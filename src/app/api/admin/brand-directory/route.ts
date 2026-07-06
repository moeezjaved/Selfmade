/**
 * Admin → Brand Directory import. Bulk-load the brand catalog (e.g. the ~611K Foreplay list).
 * GET             → { count } rows currently in the directory.
 * POST { rows }   → upsert one batch (≤2000) on page_id. Client sends batches with a throttle so the
 *                   maxed DB isn't hammered. Each row: { page_id, name, industry?, source_ad_count?,
 *                   avatar_url?, country?, website? }.
 * DELETE          → clear the whole directory (?confirm=1).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/supabase/missing-table'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user || (await isAdminToken())
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { count, error } = await createAdminClient()
    .from('brand_directory').select('*', { count: 'planned', head: true })
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ count: 0 })   // migration 049 pending
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ count: count || 0 })
}

export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const rows = Array.isArray(body.rows) ? body.rows : null
  if (!rows) return NextResponse.json({ error: 'rows[] required' }, { status: 400 })
  if (rows.length > 2000) return NextResponse.json({ error: 'max 2000 rows per batch' }, { status: 400 })

  // Normalize + drop rows without a usable page_id (the natural key).
  const now = new Date().toISOString()
  const clean = rows.map((r: any) => {
    const page_id = String(r.page_id ?? '').trim()
    const name = String(r.name ?? '').trim()
    if (!page_id || !name) return null
    const adc = Number(r.source_ad_count)
    return {
      page_id,
      name,
      industry: r.industry != null ? String(r.industry).trim() || null : null,
      source_ad_count: Number.isFinite(adc) ? Math.max(0, Math.round(adc)) : 0,
      avatar_url: r.avatar_url != null ? String(r.avatar_url).trim() || null : null,
      country: r.country != null ? String(r.country).trim() || null : null,
      website: r.website != null ? String(r.website).trim() || null : null,
      source: r.source ? String(r.source) : 'foreplay',
      updated_at: now,
    }
  }).filter(Boolean)

  if (!clean.length) return NextResponse.json({ inserted: 0, skipped: rows.length })

  // De-dupe by page_id WITHIN the batch (last row wins). Postgres' ON CONFLICT DO UPDATE
  // aborts the whole statement — "cannot affect row a second time" — if one upsert touches
  // the same conflict target twice. The Foreplay export has repeated page_ids (e.g. the same
  // brand scraped twice), so collapse them here before the upsert.
  const byId = new Map<string, any>()
  for (const r of clean as any[]) byId.set(r.page_id, r)
  const deduped = Array.from(byId.values())

  const { error } = await createAdminClient()
    .from('brand_directory').upsert(deduped, { onConflict: 'page_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ inserted: deduped.length, skipped: rows.length - deduped.length })
}

export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.nextUrl.searchParams.get('confirm') !== '1') return NextResponse.json({ error: 'confirm=1 required' }, { status: 400 })
  const { error } = await createAdminClient().from('brand_directory').delete().neq('page_id', '')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
