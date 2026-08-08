/**
 * GET /api/brain/onboard?department=creative → the first-day brief a NEW department reads to get up to
 * speed from the Company Brain (identity + rules + what it knows + what it's learned + how you work).
 * The tangible "you don't train new employees, you hire them into a company that already knows how to work."
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { onboardDepartment } from '@/lib/brain/onboard'

export const dynamic = 'force-dynamic'

const DEPTS = ['research', 'creative', 'media', 'growth', 'customer', 'store', 'finance']

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const department = String(req.nextUrl.searchParams.get('department') || '').toLowerCase()
  if (!DEPTS.includes(department)) return NextResponse.json({ error: 'unknown department' }, { status: 400 })
  const out = await onboardDepartment(createAdminClient(), user.id, department)
  return NextResponse.json(out)
}
