/**
 * GET /api/brain?department=&brand=  → the recall() bundle for a department: its notebook (L3),
 * company DNA (L2), recent learnings (L4), and CEO prefs (L5), in the fixed order of authority.
 * Powers the future Company Brain UI and lets us verify the memory spine is filling.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { recall } from '@/lib/brain'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const department = searchParams.get('department') || 'media'
  const brandId = searchParams.get('brand') || null
  const bundle = await recall(createAdminClient(), { userId: user.id, department, brandId })
  return NextResponse.json(bundle)
}
