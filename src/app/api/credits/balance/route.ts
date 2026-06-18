/**
 * GET /api/credits/balance → { balance, plan, reset_at, pricing }
 * Powers the credit counter + pre-action confirms. Also returns the live pricing
 * map so the UI can show "this costs N credits" without a second request.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getBalance } from '@/lib/credits'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [bal, { data: pricing }] = await Promise.all([
    getBalance(admin, user.id),
    admin.from('credit_pricing').select('action_type, label, credits').eq('is_active', true),
  ])

  const pricingMap: Record<string, { label: string; credits: number }> = {}
  for (const p of (pricing || []) as any[]) {
    pricingMap[p.action_type] = { label: p.label, credits: p.credits }
  }

  return NextResponse.json({ ...bal, pricing: pricingMap })
}
