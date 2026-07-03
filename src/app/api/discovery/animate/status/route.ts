/**
 * Poll an Animate job. GET ?id=<creative_generations.id> → { done, url?, error? }.
 * The droplet animate-worker renders the MP4, updates the row, and commits/refunds the credits — so
 * this endpoint just reports the current row state.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations')
    .select('status, image_url').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const r = row as any
  if (r.status === 'done') return NextResponse.json({ done: true, url: r.image_url })
  if (r.status === 'failed') return NextResponse.json({ done: true, error: 'animation failed' })
  return NextResponse.json({ done: false })
}
