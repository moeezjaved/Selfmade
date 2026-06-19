/**
 * Admin credit pricing — tune action costs without a deploy (model prices move).
 * GET  → list all pricing rows.
 * POST { action_type, credits, est_cost_usd?, label?, is_active? } → upsert one.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('credit_pricing').select('*').order('credits', { ascending: true })
  return NextResponse.json({ pricing: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json()
  const action_type = String(body.action_type || '').trim()
  if (!action_type) return NextResponse.json({ error: 'action_type required' }, { status: 400 })
  if (body.credits == null || body.credits < 0) return NextResponse.json({ error: 'credits required' }, { status: 400 })

  const update: Record<string, any> = { action_type, credits: Math.round(body.credits), updated_at: new Date().toISOString() }
  if (body.label != null) update.label = String(body.label)
  if (body.est_cost_usd != null) update.est_cost_usd = Number(body.est_cost_usd)
  if (body.is_active != null) update.is_active = !!body.is_active

  const { error } = await admin.from('credit_pricing').upsert(update, { onConflict: 'action_type' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
