/**
 * POST /api/brain/proposal { id, action: 'approve' | 'dismiss' }
 * Act on a Mello-proposed belief (from the reflection loop). Approve activates it (it becomes a real
 * company belief); dismiss retires it so it won't be shown or re-proposed. Beliefs are never
 * self-activated — this founder decision is the gate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, action } = await req.json().catch(() => ({}))
  if (!id || (action !== 'approve' && action !== 'dismiss')) return NextResponse.json({ error: 'id + action(approve|dismiss) required' }, { status: 400 })
  const admin = createAdminClient()
  const patch = action === 'approve'
    ? { active: true, updated_at: new Date().toISOString() }               // becomes a real belief
    : { active: false, source: 'dismissed', updated_at: new Date().toISOString() }  // retired, won't re-show/re-propose
  await admin.from('company_dna').update(patch).eq('id', String(id)).eq('user_id', user.id).eq('created_by', 'mello')
  return NextResponse.json({ ok: true })
}
