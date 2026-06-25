/**
 * Admin → Experts. CRUD the curators behind Top Picks.
 * GET    → all experts, each with their packs (and per-pack ad counts).
 * POST   { id?, name, handle?, avatar_url?, bio?, revenue_share_pct?, sort_order?, is_published? } → upsert.
 * DELETE ?id=<expert> → remove (cascades to packs + pack ads).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/supabase/missing-table'

export const dynamic = 'force-dynamic'

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user || (await isAdminToken())
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('experts')
    .select('*, expert_packs(*, ad_count:expert_pack_ads(count))')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ experts: [] })   // migration 048 pending
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  // Normalize the embedded count ([{count:N}] → N) and sort packs.
  const experts = (data || []).map((e: any) => ({
    ...e,
    expert_packs: (e.expert_packs || [])
      .map((p: any) => ({ ...p, ad_count: p.ad_count?.[0]?.count ?? 0 }))
      .sort((a: any, b: any) => (a.sort_order - b.sort_order) || (a.created_at < b.created_at ? -1 : 1)),
  }))
  return NextResponse.json({ experts })
}

export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const b = await req.json()
  const name = String(b.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const row: Record<string, any> = {
    name,
    handle: b.handle != null ? String(b.handle).trim() || null : null,
    avatar_url: b.avatar_url != null ? String(b.avatar_url).trim() || null : null,
    bio: b.bio != null ? String(b.bio) : null,
    revenue_share_pct: b.revenue_share_pct != null ? Number(b.revenue_share_pct) : 50,
    sort_order: b.sort_order != null ? Math.round(Number(b.sort_order)) : 0,
    is_published: !!b.is_published,
  }
  if (b.id) row.id = b.id

  const { data, error } = await admin.from('experts').upsert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ expert: data })
}

export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient().from('experts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
