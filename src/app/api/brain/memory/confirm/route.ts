/**
 * #5 · Fact confirmation. A fact Mello extracted from an observed/customer source lands as PROPOSED and
 * is NOT reasoned over as truth until the founder confirms it here. GET lists what's pending; POST
 * confirms (→ trusted) or rejects (→ retired). Owner-scoped via the admin client + the user's id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { proposedMemories, confirmMemory } from '@/lib/brain'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brandId = req.nextUrl.searchParams.get('brand') || req.cookies.get(BRAND_COOKIE)?.value || null
  const proposed = await proposedMemories(createAdminClient(), user.id, brandId)
  return NextResponse.json({ proposed })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, action } = await req.json().catch(() => ({}))
  if (!id || (action !== 'confirm' && action !== 'reject')) return NextResponse.json({ error: 'id + action (confirm|reject) required' }, { status: 400 })
  const ok = await confirmMemory(createAdminClient(), user.id, String(id), action)
  return NextResponse.json({ ok })
}
