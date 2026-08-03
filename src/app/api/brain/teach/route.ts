/**
 * POST   /api/brain/teach { rule, department?, priority?, brandId? }  → teach a belief (L2 DNA)
 * GET    /api/brain/teach                                             → list the founder's beliefs
 * DELETE /api/brain/teach { id }                                      → retire a belief (deactivate, never delete)
 *
 * This is the "Teach Mello" write path. A belief taught by the founder is active immediately; the
 * Phase-2 reflection loop will insert created_by='mello' PROPOSALS that stay inactive until approved.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { teachRule, getDna } from '@/lib/brain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dna = await getDna(createAdminClient(), user.id, { includeProposed: true })
  return NextResponse.json({ dna })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rule, department, priority, brandId } = await req.json().catch(() => ({}))
  if (!rule || !String(rule).trim()) return NextResponse.json({ error: 'rule required' }, { status: 400 })
  const row = await teachRule(createAdminClient(), {
    userId: user.id, rule: String(rule), department: department || null,
    priority: priority === 'high' || priority === 'low' ? priority : 'normal',
    brandId: brandId || null, createdBy: 'founder', source: 'teach',
  })
  return NextResponse.json({ ok: true, rule: row })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await createAdminClient().from('company_dna').update({ active: false, updated_at: new Date().toISOString() }).eq('id', String(id)).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
