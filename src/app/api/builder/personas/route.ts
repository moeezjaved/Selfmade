/** POST /api/builder/personas { productId, research? } — AI personas + angles for the wizard's step 4. */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { generatePersonas } from '@/lib/builder/personas'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const productId = String(b?.productId || '')
  const research = b?.research ? String(b.research) : undefined
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  try {
    const res = await generatePersonas(user.id, { productId, brandId, research })
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not generate personas' }, { status: 502 })
  }
}
