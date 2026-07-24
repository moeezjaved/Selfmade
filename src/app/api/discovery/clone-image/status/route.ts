/**
 * Poll an image-clone job. GET ?id=<jobId> → { status, done, url?, error? }.
 * The client fires N of these (one per variation) after enqueuing via POST /api/discovery/clone-image.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const FRIENDLY: Record<string, string> = {
  'ad not found': 'That reference ad could not be loaded — try another.',
  'reference ad has no image': 'That ad has no usable image yet — try another.',
  'could not load reference image': 'Could not load the reference image — try again.',
  'could not load product image(s)': 'Could not read your product image — re-upload it.',
  'generation failed': 'The image service is busy right now — your credits were refunded. Try again.',
  'could not save the generated image (storage)': 'We made the image but couldn’t save it — credits refunded, please retry.',
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta')
    .eq('id', id)
    .maybeSingle()
  if (!row || (row as any).user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const status = (row as any).status
  const meta = (row as any).clone_meta || {}
  const rawErr = meta.error as string | undefined
  return NextResponse.json({
    status,
    done: status === 'done',
    failed: status === 'failed',
    url: (row as any).image_url || null,
    generationId: (row as any).id,
    error: status === 'failed' ? (FRIENDLY[rawErr || ''] || rawErr || 'Generation failed — your credits are refunded automatically (may take a couple of minutes). Try again.') : null,
  })
}
