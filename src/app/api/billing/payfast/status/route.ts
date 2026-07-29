/** GET /api/billing/payfast/status?basket= → { status } for the success page to poll (own orders only). */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const basket = req.nextUrl.searchParams.get('basket')
  if (!basket) return NextResponse.json({ error: 'missing_basket' }, { status: 400 })
  const admin = createAdminClient()
  const { data } = await admin.from('payfast_orders').select('status').eq('basket_id', basket).eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ status: data?.status || 'unknown' })
}
