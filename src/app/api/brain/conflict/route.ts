/**
 * GET  /api/brain/conflict                          → pending conflicts (a new rule vs an existing belief)
 * POST /api/brain/conflict { id, action }           → resolve one
 *   action = 'temporary' → keep the old rule, add the new one as an expiring exception (brain_context, 3 days)
 *   action = 'replace'   → deactivate the old belief (kept, never deleted), activate the new one
 *   action = 'keep'      → keep the old rule, drop the new one
 *
 * The Brain never silently overwrites — the founder decides. Powers the Review tab.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { teachRule, recordContext, writeTimeline } from '@/lib/brain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await createAdminClient()
    .from('brain_conflicts').select('id, existing_id, existing_rule, incoming_rule, department, source, created_at')
    .eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false })
  return NextResponse.json({ conflicts: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, action } = await req.json().catch(() => ({}))
  if (!id || !['temporary', 'replace', 'keep'].includes(action)) return NextResponse.json({ error: 'id + valid action required' }, { status: 400 })
  const admin = createAdminClient()

  const { data: c } = await admin.from('brain_conflicts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (c.status === 'resolved') return NextResponse.json({ ok: true, already: true })

  if (action === 'temporary') {
    await recordContext(admin, { userId: user.id, brandId: c.brand_id, kind: 'priority', body: `Exception: ${c.incoming_rule}`, expiresDays: 3 })
    await writeTimeline(admin, { userId: user.id, brandId: c.brand_id, actor: 'founder', event: `Set a temporary exception: “${c.incoming_rule}” (expires in 3 days)` })
  } else if (action === 'replace') {
    if (c.existing_id) await admin.from('company_dna').update({ active: false, updated_at: new Date().toISOString() }).eq('id', c.existing_id).eq('user_id', user.id)
    await teachRule(admin, { userId: user.id, brandId: c.brand_id, rule: c.incoming_rule, department: c.department || null, createdBy: 'founder', source: 'conflict:replace' })
    await writeTimeline(admin, { userId: user.id, brandId: c.brand_id, actor: 'founder', event: `Replaced a rule: “${c.existing_rule}” → “${c.incoming_rule}”` })
  } else {
    await writeTimeline(admin, { userId: user.id, brandId: c.brand_id, actor: 'founder', event: `Kept the existing rule: “${c.existing_rule}”` })
  }

  await admin.from('brain_conflicts').update({ status: 'resolved', resolution: action, resolved_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true })
}
