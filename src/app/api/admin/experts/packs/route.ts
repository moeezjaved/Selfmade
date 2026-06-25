/**
 * Admin → Expert packs. CRUD a curator's sellable packs.
 * POST   { id?, expert_id, title, description?, cover_url?, price_cents?, original_price_cents?,
 *          is_early_bird?, gate?, sort_order?, is_published? } → upsert.
 * DELETE ?id=<pack> → remove (cascades to pack ads + purchases).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user || (await isAdminToken())
}

const GATES = new Set(['free', 'core', 'paid'])

export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const b = await req.json()
  const expert_id = String(b.expert_id || '').trim()
  const title = String(b.title || '').trim()
  if (!expert_id) return NextResponse.json({ error: 'expert_id required' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const gate = GATES.has(b.gate) ? b.gate : 'free'
  const row: Record<string, any> = {
    expert_id,
    title,
    description: b.description != null ? String(b.description) : null,
    cover_url: b.cover_url != null ? String(b.cover_url).trim() || null : null,
    price_cents: b.price_cents != null ? Math.max(0, Math.round(Number(b.price_cents))) : 0,
    original_price_cents: b.original_price_cents != null && b.original_price_cents !== ''
      ? Math.max(0, Math.round(Number(b.original_price_cents))) : null,
    is_early_bird: !!b.is_early_bird,
    gate,
    sort_order: b.sort_order != null ? Math.round(Number(b.sort_order)) : 0,
    is_published: !!b.is_published,
  }
  if (b.id) row.id = b.id

  const { data, error } = await admin.from('expert_packs').upsert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ pack: data })
}

export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient().from('expert_packs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
